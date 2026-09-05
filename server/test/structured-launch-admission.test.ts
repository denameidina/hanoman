import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import * as pty from "../src/services/pty";
import * as codexTrust from "../src/services/codex-trust";
import { DEFAULT_SETTING } from "../src/services/settings";
import { startCronSession } from "../src/services/scheduler/cron-session";
import { makeProject, makeRepoWithBranches, makeSetting, makeSpec, makeVps, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const authenticatedApp = buildApp();
let repoDir = "";
let panes: pty.Pane[] = [];
let spawned: pty.SessionInfo[] = [];
const pane = (id: string, over: Partial<pty.Pane> = {}): pty.Pane => ({
  id, projectId: "other", cwd: "/tmp/other/.worktrees/job", exited: false,
  agent: "claude", decision: false, code: 0, altScreen: false, activityAt: 0,
  startedAt: 0, eventHook: false, ...over,
});
const projectFlows = [
  { flow: "reverse", id: "reverse-p1", input: {} },
  { flow: "scaffold", id: "scaffold-p1", input: {} },
  { flow: "prd", id: "prd-guard", input: { brief: { title: "Guard", context: "A useful workflow", outcome: "Written PRD" } } },
  { flow: "breakdown", id: "breakdown-guard", input: { prdPath: "docs/prd/guard.md" } },
] as const;
const start = (payload: object) => app.inject({ method: "POST", url: "/api/terminal/sessions", payload });

beforeAll(async () => { await app.ready(); await authenticatedApp.ready(); });
beforeEach(async () => {
  await resetDb();
  repoDir = makeRepoWithBranches();
  mkdirSync(join(repoDir, "docs/prd"), { recursive: true });
  writeFileSync(join(repoDir, "docs/prd/guard.md"), "# Guard\n\nA useful workflow.\n");
  await makeProject({ repoDir });
  await makeSetting({ agent: "codex", agentAccessEnabled: true, scheduler: {
    ...DEFAULT_SETTING.scheduler, enabled: false, maxConcurrent: 1,
  } });
  panes = [pane("occupied")];
  spawned = [];
  // External boundaries only: real admission, routes, settings, prompts and worktree preparation.
  vi.spyOn(pty, "listPanesAsync").mockImplementation(async () => panes);
  vi.spyOn(pty, "listSessionsAsync").mockImplementation(async () => panes);
  vi.spyOn(pty, "listSessions").mockImplementation(() => panes);
  vi.spyOn(pty, "getSession").mockImplementation((id) => panes.find((p) => p.id === id));
  vi.spyOn(pty, "createSession").mockImplementation((projectId, cwd, opts = {}) => {
    const born = pane(opts.id ?? `new-${spawned.length}`, { projectId, cwd, flow: opts.flow });
    spawned.push(born);
    panes.push(born);
    return born;
  });
  vi.spyOn(codexTrust, "ensureCodexTrust").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  rmSync(repoDir, { recursive: true, force: true });
  await resetDb();
  await prisma.agentToken.deleteMany();
});
afterAll(async () => { await app.close(); await authenticatedApp.close(); });

const agentStart = async (payload: object) => {
  const { token } = await issueAgentToken({ name: "launch-caller", capabilities: ["sessions:spawn", "sessions:write"] });
  return authenticatedApp.inject({ method: "POST", url: "/api/terminal/sessions", payload,
    headers: { authorization: `Bearer ${token}` },
  });
};

describe("structured launch callers (SPEC-1108)", () => {
  it.each(projectFlows)("rejects $flow before worktree or trust even with scheduler off", async ({ flow, input }) => {
    const response = await start({ project: "p1", flow, ...input });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ kind: "capacity", admission: {
      enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 1,
    } });
    expect(existsSync(join(repoDir, ".worktrees"))).toBe(false);
    expect(codexTrust.ensureCodexTrust).not.toHaveBeenCalled();
    expect(spawned).toEqual([]);
  });

  it.each(projectFlows)("reattaches $flow asynchronously before admission and preparation", async ({ flow, id, input }) => {
    panes.push(pane(id, { projectId: "p1", cwd: join(repoDir, ".worktrees", id) }));
    vi.mocked(pty.getSession).mockImplementation(() => { throw new Error("sync session lookup"); });
    const response = await start({ project: "p1", flow, ...input });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id });
    expect(existsSync(join(repoDir, ".worktrees"))).toBe(false);
    expect(spawned).toEqual([]);
  });

  it.each(projectFlows)("honors explicit human force for $flow", async ({ flow, id, input }) => {
    const response = await start({ project: "p1", flow, ...input, force: true });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id });
    expect(spawned.map((p) => p.id)).toEqual([id]);
  });

  it.each(projectFlows)("rejects authenticated agent force for $flow before preparation", async ({ flow, input }) => {
    const response = await agentStart({ project: "p1", flow, ...input, force: true });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/force.*manusia/i);
    expect(existsSync(join(repoDir, ".worktrees"))).toBe(false);
    expect(codexTrust.ensureCodexTrust).not.toHaveBeenCalled();
    expect(spawned).toEqual([]);
  });

  it("rejects authenticated agent backlog force before recording launch approval", async () => {
    await makeSpec({ launchApprovedAt: null, launchApprovedBy: null });
    const response = await agentStart({ spec: "SPEC-1", flow: "feature", force: true });
    expect((await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-1" } })).launchApprovedAt).toBeNull();
    expect(response.statusCode).toBe(403);
    expect(existsSync(join(repoDir, ".worktrees"))).toBe(false);
    expect(spawned).toEqual([]);
  });

  it.each([{}, { force: false }])("keeps authenticated agent launches subject to normal admission: %j", async (over) => {
    const response = await agentStart({ project: "p1", flow: "reverse", ...over });
    expect(response.statusCode).toBe(409);
    expect(response.json().kind).toBe("capacity");
    expect(spawned).toEqual([]);
  });

  it.each([{ project: "p1" }, { project: "p1", shell: true }])("keeps operator terminal available at cap: %j", async (payload) => {
    expect((await start(payload)).statusCode).toBe(201);
    expect(spawned).toHaveLength(1);
  });

  it("rejects cron before creating worktree or granting trust, with no automatic force", async () => {
    await expect(startCronSession({ id: "morning", projectId: "p1", name: "Morning",
      prompt: "Review current work", agent: null, model: null, effort: null,
    })).rejects.toMatchObject({ kind: "capacity" });
    expect(existsSync(join(repoDir, ".worktrees"))).toBe(false);
    expect(codexTrust.ensureCodexTrust).not.toHaveBeenCalled();
    expect(spawned).toEqual([]);
  });

  it("reattaches cron before reading a now-missing project binding", async () => {
    panes.push(pane("cron-morning"));
    expect(await startCronSession({ id: "morning", projectId: "missing", name: "Morning",
      prompt: "Review current work", agent: null, model: null, effort: null,
    })).toEqual({ id: "cron-morning" });
    expect(spawned).toEqual([]);
  });

  it("rejects VPS hardening agent but keeps its SSH console available", async () => {
    const v = await makeVps();
    const agent = await app.inject({ method: "POST", url: `/api/vps/${v.id}/session` });
    expect(agent.statusCode).toBe(409);
    expect(agent.json().kind).toBe("capacity");
    expect(spawned).toEqual([]);
    expect((await app.inject({ method: "POST", url: `/api/vps/${v.id}/console` })).statusCode).toBe(201);
    expect(spawned).toHaveLength(1);
  });

  it.each(["backlog", "project", "graph"])("preserves a real Git conflict when %s recovery agent is denied", async (kind) => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
    const branch = kind === "backlog" ? "hanoman/spec-1" : "prd/conflict";
    git("checkout", "-qb", branch);
    writeFileSync(join(repoDir, "README.md"), "source\n");
    git("commit", "-qam", "source");
    git("checkout", "-q", "main");
    writeFileSync(join(repoDir, "README.md"), "target\n");
    git("commit", "-qam", "target");
    if (kind === "backlog") await makeSpec({ stage: "done" });
    if (kind === "project") panes.push(pane("prd-conflict", { projectId: "p1", branch }));
    const url = kind === "backlog" ? "/api/specs/SPEC-1/integrate"
      : kind === "project" ? "/api/terminal/sessions/prd-conflict/integrate" : "/api/projects/p1/git/merge";
    const response = await app.inject({ method: "POST", url,
      payload: kind === "graph" ? { source: branch } : { op: "merge", target: "local:main" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().kind).toBe("capacity");
    expect(spawned).toEqual([]);
    const suffix = kind === "backlog" ? "spec-1" : kind === "project" ? "prd-conflict" : "main";
    const conflictDir = join(repoDir, ".worktrees", `merge-${suffix}`);
    expect(readFileSync(join(conflictDir, "README.md"), "utf8")).toContain("<<<<<<<");
    expect(execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: conflictDir, encoding: "utf8" }).trim()).toBe("README.md");
    expect(readFileSync(join(repoDir, "README.md"), "utf8")).toBe("target\n");
  });
});
