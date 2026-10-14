import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { killAll, createSession, getSession } from "../src/services/pty";
import { DEFAULT_SETTING } from "../src/services/settings";
import { resetDb, makeProject, makeSpec, makeSetting, makeRepoWithSpecBranch } from "./factory";

// SPEC-377 · sesi penyelesai konflik rebase/merge harus lahir dengan AGEN + model + effort dari
// Setting — bukan default claude. Buktinya diambil dari argv pane tmux (pola session-launch.test),
// karena di situlah pilihan agen benar-benar mewujud: `claude --model …` vs `codex -m …`.
vi.mock("../src/services/antigravity-trust", () => ({ ensureAntigravityTrust: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());
const app = buildApp({ requireAuth: false });

const argvOf = async (id: string): Promise<string> => {
  const read = () => execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman",
    "-f", "/dev/null", "capture-pane", "-p", "-J", "-S", "-2000", "-t", `hanoman-${id}`],
    { encoding: "utf8" }).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 100 && !read(); i++) await new Promise((r) => setTimeout(r, 20));
  return read();
};

// Repo yang PASTI konflik: base → branch spec mengubah f.txt, main ikut mengubahnya.
const conflictRepo = (specId: string) => makeRepoWithSpecBranch(specId, {
  base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
}).repoDir;

let codexHome: string;
beforeAll(async () => { await resetDb(); });
beforeEach(() => {
  killAll();
  // Kedua binari di-echo: apa pun agen yang dipilih route, argv-nya tercetak di pane.
  process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
  process.env.HANOMAN_CODEX_BIN = "/bin/echo";
  codexHome = mkdtempSync(join(tmpdir(), "hanoman-codexhome-"));
  process.env.CODEX_HOME = codexHome;
});
afterAll(async () => { killAll(); await resetDb(); delete process.env.CODEX_HOME; });

describe("SPEC-377 · agen/model/effort sesi konflik integrasi", () => {
  it("POST /specs/:id/integrate konflik → sesi codex saat Setting.agent codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    const repoDir = conflictRepo("SPEC-C1");
    await makeProject({ id: "pc1", repoDir });
    await makeSpec({ id: "SPEC-C1", projectId: "pc1", stage: "done" });

    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-C1/integrate",
      payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("conflict");

    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("-m gpt-5.6-terra");
    expect(argv).toContain('model_reasoning_effort="high"');
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    // Gerbang trust codex dibuka untuk ROOT REPO — tanpa ini sesi mentok di layar trust.
    expect(readFileSync(`${codexHome}/config.toml`, "utf8")).toContain("trust_level");
  });

  it("POST /specs/:id/integrate konflik → model/effort claude dari Setting, bukan hardcode", async () => {
    await makeSetting({ agent: "claude", model: "claude-sonnet-5", effort: "medium" });
    const repoDir = conflictRepo("SPEC-C2");
    await makeProject({ id: "pc2", repoDir });
    await makeSpec({ id: "SPEC-C2", projectId: "pc2", stage: "done" });

    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-C2/integrate",
      payload: { op: "merge", target: "origin:main" } });
    expect(res.json().status).toBe("conflict");
    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("--model claude-sonnet-5");
    expect(argv).toContain("--effort medium");
    expect(argv).toContain("--dangerously-skip-permissions");
  });

  it("POST /projects/:id/git/merge konflik → sesi codex saat Setting.agent codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    await makeProject({ id: "pc3", repoDir: conflictRepo("SPEC-C3") });

    const res = await app.inject({ method: "POST", url: "/api/projects/pc3/git/merge",
      payload: { source: "hanoman/spec-c3" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("conflict");

    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("-m gpt-5.6-terra");
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(readFileSync(`${codexHome}/config.toml`, "utf8")).toContain("trust_level");
  });

  it("POST /projects/:id/git/rebase konflik → sesi codex saat Setting.agent codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    await makeProject({ id: "pc4", repoDir: conflictRepo("SPEC-C4") });

    const res = await app.inject({ method: "POST", url: "/api/projects/pc4/git/rebase",
      payload: { onto: "hanoman/spec-c4" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("conflict");
    expect(await argvOf(res.json().sessionId as string)).toContain("-m gpt-5.6-terra");
  });
});

// SPEC-383 · ADR-0081 · blok `Setting.conflict` opt-in: saat hidup ia MENGGANTIKAN default global
// hanya untuk sesi penyelesai konflik. Dibuktikan dari argv pane tmux di ketiga pintu, dengan
// default global sengaja disetel BERBEDA supaya tak ada yang lolos karena kebetulan sama.
describe("SPEC-383 · default sesi konflik yang bisa disetel sendiri", () => {
  it("POST /specs/:id/integrate → blok conflict menang atas default global", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh",
      conflict: { enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "low" } });
    const repoDir = conflictRepo("SPEC-C5");
    await makeProject({ id: "pc5", repoDir });
    await makeSpec({ id: "SPEC-C5", projectId: "pc5", stage: "done" });

    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-C5/integrate",
      payload: { op: "merge", target: "origin:main" } });
    expect(res.json().status).toBe("conflict");
    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("--model claude-haiku-4-5");
    expect(argv).toContain("--effort low");
    expect(argv).not.toContain("claude-opus-5");
  });

  it("POST /specs/:id/integrate → override codex membuka trust codex walau default global claude", async () => {
    // Regresi SPEC-377 dalam bentuk baru: `ensureCodexTrust` harus diturunkan dari agen HASIL
    // helper, bukan dari `Setting.agent` — kalau tidak, sesi codex mentok di layar trust.
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh",
      conflict: { enabled: true, agent: "codex", model: "gpt-5.6-terra", effort: "high" } });
    const repoDir = conflictRepo("SPEC-C6");
    await makeProject({ id: "pc6", repoDir });
    await makeSpec({ id: "SPEC-C6", projectId: "pc6", stage: "done" });

    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-C6/integrate",
      payload: { op: "merge", target: "origin:main" } });
    expect(res.json().status).toBe("conflict");
    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("-m gpt-5.6-terra");
    expect(argv).toContain('model_reasoning_effort="high"');
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(readFileSync(`${codexHome}/config.toml`, "utf8")).toContain("trust_level");
  });

  it("POST /projects/:id/git/merge → blok conflict menang atas default global", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" },
      conflict: { enabled: true, agent: "claude", model: "claude-sonnet-5", effort: "medium" } });
    await makeProject({ id: "pc7", repoDir: conflictRepo("SPEC-C7") });

    const res = await app.inject({ method: "POST", url: "/api/projects/pc7/git/merge",
      payload: { source: "hanoman/spec-c7" } });
    expect(res.json().status).toBe("conflict");
    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("--model claude-sonnet-5");
    expect(argv).toContain("--effort medium");
    expect(argv).not.toContain("gpt-5.6-terra");
  });

  it("POST /terminal/sessions/:id/integrate (PRD) → blok conflict menang atas default global", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh",
      conflict: { enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "low" } });
    const repoDir = conflictRepo("SPEC-C9");
    await makeProject({ id: "pc9", repoDir });
    // Sesi project-level ber-branch (pola mkPrd di terminal.route.test): worktree + branch, command
    // sleep supaya sesinya hidup saat route dipanggil. Branch-nya yang PASTI konflik dengan main.
    const wt = join(repoDir, ".worktrees", "prd-c9");
    execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "HEAD"], { cwd: repoDir });
    createSession("pc9", wt, { id: "prd-c9", branch: "hanoman/spec-c9", command: ["/bin/sleep", "30"] });

    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions/prd-c9/integrate",
      payload: { op: "merge", target: "origin:main" } });
    expect(res.json().status).toBe("conflict");
    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("--model claude-haiku-4-5");
    expect(argv).toContain("--effort low");
    expect(argv).not.toContain("claude-opus-5");
  });

  it("blok conflict MATI → sesi konflik tetap mewarisi default global (perilaku pra-SPEC-383)", async () => {
    await makeSetting({ agent: "claude", model: "claude-sonnet-5", effort: "medium",
      conflict: { enabled: false, agent: "codex", model: "gpt-5.6-terra", effort: "low" } });
    await makeProject({ id: "pc8", repoDir: conflictRepo("SPEC-C8") });

    const res = await app.inject({ method: "POST", url: "/api/projects/pc8/git/merge",
      payload: { source: "hanoman/spec-c8" } });
    expect(res.json().status).toBe("conflict");
    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("--model claude-sonnet-5");
    expect(argv).not.toContain("gpt-5.6-terra");
  });
});


it.each(["backlog", "ide", "terminal"])("Antigravity conflict %s uses runtime defaults and conflicted worktree", async (entry) => {
  await makeSetting({ agent: "antigravity", antigravity: { model: "gemini-3.8-flash-high", effort: "high" }, scheduler: { ...DEFAULT_SETTING.scheduler, maxConcurrent: 50 } });
  vi.stubEnv("HANOMAN_ANTIGRAVITY_BIN", "/bin/echo");
  const specId = `SPEC-AGY-${entry}`; const projectId = `p-agy-${entry}`; const repoDir = conflictRepo(specId);
  await makeProject({ id: projectId, repoDir }); await makeSpec({ id: specId, projectId, stage: "done" });
  let url = `/api/specs/${specId}/integrate`; let payload: Record<string, unknown> = { op: "merge", target: "origin:main" };
  if (entry === "ide") { url = `/api/projects/${projectId}/git/merge`; payload = { source: `hanoman/${specId.toLowerCase()}` }; }
  if (entry === "terminal") {
    createSession(projectId, repoDir, { id: `existing-${entry}`, specId, branch: `hanoman/${specId.toLowerCase()}`, command: ["/bin/echo"] });
    url = `/api/terminal/sessions/existing-${entry}/integrate`;
  }
  const res = await app.inject({ method: "POST", url, payload }); expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe("conflict"); const id = res.json().sessionId;
  const argv = await argvOf(id); expect(argv).toContain("--model gemini-3.8-flash-high"); expect(argv).toContain("--prompt-interactive");
  expect(getSession(id)).toMatchObject({ agent: "antigravity", cwd: expect.stringContaining("/.worktrees/") });
  const { ensureAntigravityTrust } = await import("../src/services/antigravity-trust");
  expect(ensureAntigravityTrust).toHaveBeenCalledWith(getSession(id)!.cwd);
});
