import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, writeFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeRepoWithWorktree } from "./factory";
import { createSession, getSession, killAll } from "../src/services/pty";
import { __resetReaper, trashDirOf } from "../src/services/worktree-reaper";

// SPEC-861 · ADR-0132 · tiga route worktree. Daftar & stats read-only turunan git; hapus adalah
// operasi destruktif yang diperlakukan seperti /branches/delete (selalu 200 bila body sah).
const app = buildApp({ requireAuth: false });
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });

beforeEach(async () => {
  await resetDb();
  __resetReaper();
  process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
});
afterAll(() => { killAll(); });

// Repo: main + worktree detached `.worktrees/spec-w1` + worktree ber-branch `.worktrees/wt-b`
// (branch `topik`, sudah ter-merge ke main → boleh dihapus tab Branches).
async function project(id: string): Promise<string> {
  const repoDir = makeRepoWithWorktree("spec-w1", { "a.txt": "a" }, {});
  g(repoDir, "branch", "topik");
  g(repoDir, "worktree", "add", "-q", join(repoDir, ".worktrees", "wt-b"), "topik");
  // Branch sesi (ADR-0032 `hanoman/<spec>`) supaya kunci `spec-open` ADR-0077 benar-benar menyala
  // saat spec-nya belum `done` — `sourceBranch(id)` = `hanoman/<id>`, bukan id telanjang.
  g(repoDir, "branch", "hanoman/spec-lock");
  g(repoDir, "worktree", "add", "-q", join(repoDir, ".worktrees", "wt-lock"), "hanoman/spec-lock");
  await makeProject({ id, repoDir });
  return repoDir;
}

describe("GET /projects/:id/worktrees", () => {
  it("mendaftar worktree hidup + memetakan backlog & stage-nya", async () => {
    const repoDir = await project("wp1");
    await makeSpec({ id: "SPEC-W1", projectId: "wp1", stage: "executing" });
    const r = await app.inject({ method: "GET", url: "/api/projects/wp1/worktrees" });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { repoDir: string; worktrees: any[] };
    expect(body.repoDir).toBe(repoDir);
    const w = body.worktrees.find((x) => x.name === "spec-w1")!;
    expect(w.spec).toEqual({ id: "SPEC-W1", stage: "executing" });
    expect(w.deletable).toBe(true);
    // git menjawab path FISIK; /var/folders di macOS adalah symlink ke /private/**.
    expect(body.worktrees.find((x) => x.path === realpathSync(repoDir))!.deletable).toBe(false);
  });

  it("project tanpa repoDir → daftar kosong, bukan 500", async () => {
    await makeProject({ id: "wnodir", repoDir: null });
    const r = await app.inject({ method: "GET", url: "/api/projects/wnodir/worktrees" });
    expect(r.statusCode).toBe(200);
    expect(r.json().worktrees).toEqual([]);
  });

  it("project tak ada → 404", async () => {
    const r = await app.inject({ method: "GET", url: "/api/projects/hantu/worktrees" });
    expect(r.statusCode).toBe(404);
  });
});

describe("GET /projects/:id/worktrees/stats", () => {
  it("menjawab ukuran, berkas kotor, dan commit yatim", async () => {
    const repoDir = await project("wp2");
    writeFileSync(join(repoDir, ".worktrees", "spec-w1", "belum.txt"), "kerja");
    const r = await app.inject({ method: "GET", url: "/api/projects/wp2/worktrees/stats?name=spec-w1" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ name: "spec-w1", dirtyFiles: 1 });
    expect(r.json().sizeBytes).toBeGreaterThan(0);
  });

  // Klien tak pernah mengirim path: `name` divalidasi terhadap daftar TURUNAN.
  it("nama di luar daftar turunan → 404", async () => {
    await project("wp3");
    const r = await app.inject({ method: "GET", url: "/api/projects/wp3/worktrees/stats?name=../../etc" });
    expect(r.statusCode).toBe(404);
  });
});

describe("POST /projects/:id/worktrees/delete", () => {
  it("melepas worktree ke .trash lalu mem-prune registrasinya", async () => {
    const repoDir = await project("wp4");
    const wt = join(repoDir, ".worktrees", "spec-w1");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp4/worktrees/delete",
      payload: { names: ["spec-w1"] } });
    expect(r.statusCode).toBe(200);
    const [res] = r.json().results;
    expect(res).toMatchObject({ name: "spec-w1", ok: true });
    expect(existsSync(wt)).toBe(false);
    // Entri `.trash` ber-nama `<sesi>.<stempel>` (SPEC-742) — buktinya ia DIPINDAH, bukan dihapus
    // sinkron. Keberadaan berkasnya sendiri tak bisa di-assert: penyapu latar memang langsung
    // ditendang `releaseWorktree` dan memakannya.
    expect(res.cleanup).toMatch(/^spec-w1\./);
    expect(res.cleanup.startsWith(`${trashDirOf(repoDir)}/`)).toBe(false);
    const list = g(repoDir, "worktree", "list", "--porcelain").stdout;
    expect(list).not.toContain("/spec-w1");
  });

  it("menutup sesi tmux hidup lebih dulu, bukan mencabut direktori dari bawahnya", async () => {
    const repoDir = await project("wp5");
    createSession("wp5", join(repoDir, ".worktrees", "spec-w1"), { id: "spec-w1" });
    const r = await app.inject({ method: "POST", url: "/api/projects/wp5/worktrees/delete",
      payload: { names: ["spec-w1"] } });
    expect(r.json().results[0]).toMatchObject({ ok: true, closedSession: "spec-w1" });
    expect(getSession("spec-w1")?.exited ?? true).toBe(true);
  });

  it("hapus branch juga: worktree lepas DAN branch-nya terhapus", async () => {
    const repoDir = await project("wp6");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp6/worktrees/delete",
      payload: { names: ["wt-b"], deleteBranch: true } });
    const [res] = r.json().results;
    expect(res).toMatchObject({ ok: true, branch: { name: "topik", ok: true } });
    expect(g(repoDir, "branch", "--format=%(refname:short)").stdout).not.toContain("topik");
  });

  // Pagar ADR-0077 tetap berdiri untuk BRANCH; baris worktree-nya tetap terhapus.
  it("branch terkunci melapor alasannya tanpa membatalkan penghapusan worktree", async () => {
    const repoDir = await project("wp7");
    await makeSpec({ id: "spec-lock", projectId: "wp7", stage: "executing" });
    const r = await app.inject({ method: "POST", url: "/api/projects/wp7/worktrees/delete",
      payload: { names: ["wt-lock"], deleteBranch: true } });
    const [res] = r.json().results;
    expect(res.ok).toBe(true);
    expect(res.branch).toMatchObject({ name: "hanoman/spec-lock", ok: false });
    expect(res.branch.error).toMatch(/belum selesai/);
    expect(existsSync(join(repoDir, ".worktrees", "wt-lock"))).toBe(false);
    // Kunci `worktree` sudah lepas: branch-nya kini bisa dibersihkan dari tab Branches.
    expect(g(repoDir, "branch", "--format=%(refname:short)").stdout).toContain("hanoman/spec-lock");
  });

  it("checkout project sendiri TAK PERNAH bisa dihapus", async () => {
    const repoDir = await project("wp8");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp8/worktrees/delete",
      payload: { names: [basename(repoDir)] } });
    expect(r.json().results[0].ok).toBe(false);
    expect(existsSync(join(repoDir, "a.txt"))).toBe(true);
  });

  it("nama di luar daftar turunan ditolak per baris", async () => {
    await project("wp9");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp9/worktrees/delete",
      payload: { names: ["/etc"] } });
    expect(r.json().results[0]).toMatchObject({ ok: false });
  });

  it("body tanpa names → 400", async () => {
    await project("wp10");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp10/worktrees/delete", payload: {} });
    expect(r.statusCode).toBe(400);
  });
});
