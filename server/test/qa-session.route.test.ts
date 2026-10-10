import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { DEFAULT_SETTING } from "../src/services/settings";
import { makeProject, makeRepoWithBranches, resetDb } from "./factory";

const launched = vi.hoisted(() => ({ panes: [] as any[], opts: [] as any[] }));
vi.mock("../src/services/pty", async (original) => ({
  ...await original<typeof import("../src/services/pty")>(),
  createSession: (projectId: string, cwd: string, opts: any) => {
    const pane = { id: opts.id, projectId, cwd, exited: false };
    launched.opts.push(opts); launched.panes.push(pane); return pane;
  },
}));
// Use the real admission queue and reuse logic, with a deterministic host and pane inventory.
vi.mock("../src/services/session-launch-gate", async (original) => {
  const { createLaunchGate } = await import("../src/services/session-admission");
  const { DEFAULT_SETTING } = await import("../src/services/settings");
  const gate = createLaunchGate({
    listPanes: async () => launched.panes,
    config: async () => DEFAULT_SETTING.scheduler,
    host: () => ({ platform: "darwin", loadAverage: 0, cores: 8, memAvailablePct: 100 }),
  });
  return { ...await original<typeof import("../src/services/session-launch-gate")>(), withSessionAdmission: gate.run };
});
const app = buildApp();
let repo = ""; let headers: { authorization: string }; let url = "";
beforeEach(async () => {
  await resetDb(); await prisma.agentToken.deleteMany();
  launched.panes.length = 0; launched.opts.length = 0;
  repo = makeRepoWithBranches();
  await makeProject({ id: "p1", repoDir: repo });
  await prisma.setting.upsert({ where: { id: 1 }, create: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } as any }, update: { data: { ...DEFAULT_SETTING, agentAccessEnabled: true } as any } });
  const { token } = await issueAgentToken({ name: "qa", capabilities: ["qa:write", "sessions:write"] });
  headers = { authorization: `Bearer ${token}` };
  await prisma.qaReport.create({ data: { id: "r1", projectId: "p1", title: "Smoke", buildVersion: "v1", environment: { os: "macOS" } } });
  await prisma.qaCase.create({ data: { id: "c1", reportId: "r1", title: "Login", steps: "Buka login lalu masuk" } });
  await prisma.qaFinding.create({ data: { id: "f1", reportId: "r1", caseId: "c1", title: "Tombol mati", steps: ["klik tombol"], expected: "masuk", actual: "diam" } });
  url = "/api/projects/p1/qa/reports/r1/findings/f1/session";
});
afterEach(async () => { await rm(repo, { recursive: true, force: true }); });
const start = (over: Record<string, unknown> = {}) => app.inject({ method: "POST", url, headers, payload: {}, ...over });

describe("QA direct session", () => {
  it("creates isolated QA branch with full case context, no Spec or status mutation; concurrent retry reuses pane", async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.statusCode).toBe(201); expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual({ id: a.json().id, reused: true });
    expect(launched.opts).toHaveLength(1);
    const opts = launched.opts[0]; const cwd = launched.panes[0].cwd;
    expect(cwd).toBe(join(repo, ".worktrees", a.json().id));
    expect(execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8" }).trim()).toBe(opts.branch);
    expect(opts.prompt).toContain("Buka login lalu masuk"); expect(opts.prompt).toContain("klik tombol");
    expect(opts.prompt).toContain("macOS"); expect(opts.prompt).toContain("Expected:\nmasuk");
    expect(await prisma.spec.count()).toBe(0);
    expect((await prisma.qaFinding.findUniqueOrThrow({ where: { id: "f1" } })).status).toBe("open");
    launched.panes.length = 0;
    await writeFile(join(cwd, "fix.txt"), "uncommitted fix");
    expect((await start()).statusCode).toBe(201);
    expect(await readFile(join(cwd, "fix.txt"), "utf8")).toBe("uncommitted fix");
  });
  it("rejects missing launch capability before worktree creation", async () => {
    const { token } = await issueAgentToken({ name: "read", capabilities: ["qa:write"] });
    expect((await start({ headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    expect(launched.opts).toHaveLength(0);
  });
  it("checks project/report/finding scope, rejects input overrides and missing repo", async () => {
    expect((await start({ url: url.replace("/p1/", "/p2/") })).statusCode).toBe(404);
    expect((await start({ url: url.replace("/f1/", "/unknown/") })).statusCode).toBe(404);
    expect((await start({ payload: { prompt: "override" } })).statusCode).toBe(400);
    await prisma.project.update({ where: { id: "p1" }, data: { repoDir: null } });
    const r = await start(); expect(r.statusCode).toBe(400); expect(r.json().needsBind).toBe(true);
  });
  it("allows closed report, rejects wontfix and an existing backlog", async () => {
    await prisma.qaReport.update({ where: { id: "r1" }, data: { status: "closed", verdict: "no-go" } });
    expect((await start()).statusCode).toBe(201);
    await prisma.qaFinding.update({ where: { id: "f1" }, data: { status: "wontfix" } });
    expect((await start()).statusCode).toBe(409);
    await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "Fix", source: "qa", stage: "brainstorming", priority: "sedang", author: "qa", objective: "Fix", payload: {} } });
    await prisma.qaFinding.update({ where: { id: "f1" }, data: { status: "sent", backlogId: "SPEC-1" } });
    expect((await start()).statusCode).toBe(409);
  });
  it("copies report/case/finding attachments to a narrow sandbox mount and rejects missing bytes", async () => {
    const { storeQaBytes } = await import("../src/services/qa-attachment-sync");
    const { createHash } = await import("node:crypto");
    const { deleteUpload } = await import("../src/services/uploads");
    const bytes = Buffer.from("QA evidence");
    for (const ownerType of ["report", "case", "finding"]) {
      const key = `direct-${ownerType}.txt`;
      await storeQaBytes(key, bytes);
      await prisma.qaAttachment.create({ data: { id: `a-${ownerType}`, reportId: "r1", projectId: "p1", ownerType, ownerId: ownerType === "report" ? "r1" : ownerType === "case" ? "c1" : "f1", filename: "../../evidence.txt", mimeType: "text/plain", storageKey: key, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length } });
    }
    expect((await start()).statusCode).toBe(201);
    expect(launched.opts[0].attachmentsDir).toBeTruthy();
    const paths = launched.opts[0].prompt.split("\n").filter((l: string) => l.startsWith('"../../evidence.txt"')).map((l: string) => l.split(": ")[1]);
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(await readFile(path, "utf8")).toBe("QA evidence");
    launched.panes.length = 0;
    await deleteUpload("direct-case.txt");
    expect((await start()).statusCode).toBe(409);
    for (const owner of ["report", "finding"]) await deleteUpload(`direct-${owner}.txt`);
  });
});
