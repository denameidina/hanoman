import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeRepoWithBranches, makeRepoWithSpecBranch, makeRepoWithChanges } from "./factory";
import { createSession, killAll } from "../src/services/pty";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const app = buildApp({ requireAuth: false });

// Repo dgn dev MAJU 1 commit di depan main → merge dev bisa fast-forward (uji ff opsional).
function ffRepo(): string {
  const dir = makeRepoWithBranches("dev");
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("checkout", "-q", "dev"); writeFileSync(`${dir}/x.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev ahead");
  g("checkout", "-q", "main");
  return dir;
}

// SPEC-360 · repo dgn hanoman/<id> SUDAH ter-merge ke main (local + origin).
function mergedRepo(specId: string): string {
  const { repoDir } = makeRepoWithSpecBranch(specId);
  const gg = (...a: string[]) => spawnSync("git", a, { cwd: repoDir, encoding: "utf8" });
  gg("merge", "--no-ff", "--no-edit", `hanoman/${specId}`);
  gg("push", "-q", "origin", "main");
  return repoDir;
}

// Repo main dengan 2 commit → uji reset (SPEC-233).
function twoCommitRepo(): string {
  const dir = makeRepoWithBranches();
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  writeFileSync(`${dir}/second.txt`, "s"); g("add", "-A"); g("commit", "-qm", "second");
  return dir;
}

beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "ide", repoDir: makeRepoWithBranches("dev") });
  await makeProject({ id: "ffrepo", repoDir: ffRepo() });
  await makeProject({ id: "delrepo", repoDir: makeRepoWithSpecBranch("del").repoDir }); // branch hanoman/del local+origin
  await makeProject({ id: "delrepo2", repoDir: makeRepoWithSpecBranch("del2").repoDir }); // idem, untuk hapus mandiri (SPEC-206)
  await makeProject({ id: "delrepo3", repoDir: makeRepoWithSpecBranch("del3").repoDir });
  await makeProject({ id: "resetrepo", repoDir: twoCommitRepo() });
  await makeProject({ id: "nodir", repoDir: null });
  await makeProject({ id: "chg", repoDir: makeRepoWithChanges() });
  // ADR-0121 · operasi berkas Explorer (entry + upload)
  await makeProject({ id: "entryrepo", repoDir: makeRepoWithBranches() });
  // SPEC-360 · branch cleanup
  await makeProject({ id: "cleanrepo", repoDir: mergedRepo("clean") });
  await makeProject({ id: "lockrepo", repoDir: mergedRepo("locked") });
  await makeSpec({ id: "locked", projectId: "lockrepo", stage: "executing" }); // → hanoman/locked terkunci
}, 30_000); // fixtures git+DB banyak — beri ruang di mesin ber-load tinggi

describe("ide routes", () => {
  it("GET /tree lists files; project tak ada → 404", async () => {
    const r = await app.inject({ url: "/api/projects/ide/tree" });
    expect(r.statusCode).toBe(200);
    expect(r.json().files).toContain("README.md");
    expect((await app.inject({ url: "/api/projects/ghost/tree" })).statusCode).toBe(404);
  });
  it("GET /file membaca isi; path keluar-repo → 400; hilang → 404", async () => {
    const ok = await app.inject({ url: "/api/projects/ide/file?path=README.md" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().content).toBe("x");
    expect((await app.inject({ url: "/api/projects/ide/file?path=../evil" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/projects/ide/file?path=ghost" })).statusCode).toBe(404);
  });
  it("PUT /file menulis, TIDAK digerbang sesi aktif", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("ide", process.cwd());
    const r = await app.inject({ method: "PUT", url: "/api/projects/ide/file", payload: { path: "n.txt", content: "hi" } });
    expect(r.statusCode).toBe(200);
    killAll();
  });
  it("GET /graph mengembalikan commits + current", async () => {
    const r = await app.inject({ url: "/api/projects/ide/graph" });
    expect(r.statusCode).toBe(200);
    expect(["main", "dev"]).toContain(r.json().current); // worktree factory checkout main
    expect(Array.isArray(r.json().commits)).toBe(true);
  });
  // SPEC-351 · penjaga kontrak, bukan perbaikan: jendela commit berhalaman di client bersandar pada
  // `?limit=` dihormati untuk nilai SELAIN default. Sebelumnya tak ada test yang pernah mengirimnya,
  // jadi paginasi bisa patah tanpa satu pun test server memerah.
  it("GET /graph menghormati ?limit= non-default (SPEC-351)", async () => {
    const one = await app.inject({ url: "/api/projects/resetrepo/graph?limit=1" });
    expect(one.json().commits).toHaveLength(1);
    const many = await app.inject({ url: "/api/projects/resetrepo/graph?limit=50" });
    expect(many.json().commits.length).toBeGreaterThan(1);
  });
  it("POST /git checkout: sesi aktif → 409; force → 200", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("ide", process.cwd());
    const blocked = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "dev" } });
    expect(blocked.statusCode).toBe(409);
    const forced = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "dev", force: true } });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().current).toBe("dev");
    killAll();
  });
  it("POST /git op buruk → 400; ref tak ada → 409 + stderr", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "nuke" } })).statusCode).toBe(400);
    const bad = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "checkout", ref: "ghost" } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error).toBeTruthy();
  });
  it("POST /git: project tanpa repoDir → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/nodir/git", payload: { op: "checkout", ref: "main" } });
    expect(r.statusCode).toBe(400);
  });
  it("POST /git merge: ff buruk → 400; --no-ff → 200 merge commit (SPEC-193)", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/projects/ffrepo/git", payload: { op: "merge", ref: "dev", ff: "bogus" } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/projects/ffrepo/git", payload: { op: "merge", ref: "dev", ff: "no-ff" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true); // merge-commit vs ff dibuktikan di git-ide.test.ts (unit)
  });
  it("POST /git merge deleteBranch: hapus branch local+origin (SPEC-193); deleteBranch kosong → 400", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/projects/delrepo/git", payload: { op: "merge", ref: "hanoman/del", deleteBranch: "" } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/projects/delrepo/git", payload: { op: "merge", ref: "hanoman/del", deleteBranch: "hanoman/del" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    // branch tak lagi muncul di daftar branch project
    expect((await app.inject({ url: "/api/projects/delrepo/branches" })).json().branches).not.toContain("hanoman/del");
  });
  it("POST /git delete-branch origin saja: local tetap, origin lenyap (SPEC-206)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/delrepo2/git",
      payload: { op: "delete-branch", name: "hanoman/del2", local: false, remote: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    const b = (await app.inject({ url: "/api/projects/delrepo2/branches" })).json();
    expect(b.branches).toContain("hanoman/del2");     // local tetap
    expect(b.remotes).not.toContain("hanoman/del2");  // origin lenyap
  });
  it("POST /git delete-branch local+origin (force): keduanya lenyap (SPEC-206)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/delrepo3/git",
      payload: { op: "delete-branch", name: "hanoman/del3", remote: true, force: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    const b = (await app.inject({ url: "/api/projects/delrepo3/branches" })).json();
    expect(b.branches).not.toContain("hanoman/del3");
    expect(b.remotes).not.toContain("hanoman/del3");
  });

  it("POST /git/merge clean: merge branch spec ke current → 200 {status:clean} (SPEC-229)", async () => {
    await makeProject({ id: "gm1", repoDir: makeRepoWithSpecBranch("gm").repoDir }); // current main + hanoman/gm
    const r = await app.inject({ method: "POST", url: "/api/projects/gm1/git/merge", payload: { source: "hanoman/gm" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("clean");
  });
  it("POST /git/merge conflict: spawn sesi claude → 200 {status:conflict, sessionId} (SPEC-229)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeProject({ id: "gm2", repoDir: makeRepoWithSpecBranch("gm", {
      base: { "f.txt": "b\n" }, work: { "f.txt": "w\n" }, mainAdvance: { "f.txt": "m\n" } }).repoDir });
    const r = await app.inject({ method: "POST", url: "/api/projects/gm2/git/merge", payload: { source: "hanoman/gm" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("conflict");
    expect(typeof r.json().sessionId).toBe("string");
    killAll();
  });
  it("POST /git/merge source kosong → 400; project tanpa repoDir → 400 (SPEC-229)", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/gm1/git/merge", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/projects/nodir/git/merge", payload: { source: "main" } })).statusCode).toBe(400);
  });

  it("GET /working-status memisah staged & unstaged; project tak ada → 404 (SPEC-234)", async () => {
    const r = await app.inject({ url: "/api/projects/chg/working-status" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.branch).toBe("main");
    expect(b.staged.map((c: { path: string }) => c.path)).toEqual(["staged.txt"]);
    expect(b.unstaged.map((c: { path: string }) => c.path)).toEqual(["new.txt", "tracked.txt"]);
    expect((await app.inject({ url: "/api/projects/ghost/working-status" })).statusCode).toBe(404);
  });
  it("GET /working-status project tanpa repoDir → kosong 200 (SPEC-234)", async () => {
    const r = await app.inject({ url: "/api/projects/nodir/working-status" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ branch: "", staged: [], unstaged: [] });
  });
  it("GET /file-diff staged/unstaged; path buruk → 400; tak berubah → 404 (SPEC-234)", async () => {
    const st = await app.inject({ url: "/api/projects/chg/file-diff?path=staged.txt&staged=1" });
    expect(st.statusCode).toBe(200);
    expect(st.json().diff).toMatch(/\+two/);
    const un = await app.inject({ url: "/api/projects/chg/file-diff?path=new.txt" });
    expect(un.statusCode).toBe(200);
    expect(un.json().status).toBe("A");
    expect((await app.inject({ url: "/api/projects/chg/file-diff?path=../evil&staged=1" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/projects/chg/file-diff?path=staged.txt" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/projects/chg/file-diff" })).statusCode).toBe(400);
  });
  it("POST /git reset: mode buruk → 400; force reset --soft → 200 (SPEC-233)", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/projects/resetrepo/git", payload: { op: "reset", sha: "HEAD~1", mode: "bogus" } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/projects/resetrepo/git", payload: { op: "reset", sha: "HEAD~1", mode: "soft", force: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(r.json().current).toBe("main");
  });

  it("GET /status melaporkan clean; POST /git tag (ref-only) TIDAK digerbang sesi (SPEC-233)", async () => {
    const s = await app.inject({ url: "/api/projects/ide/status" });
    expect(s.statusCode).toBe(200);
    expect(typeof s.json().clean).toBe("boolean");
    // tag = ref-only → walau ada sesi aktif, tak 409 (touchesTree=false, ADR-0055)
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("ide", process.cwd());
    const t = await app.inject({ method: "POST", url: "/api/projects/ide/git", payload: { op: "tag", name: "vtest" } });
    expect(t.statusCode).toBe(200);
    expect(t.json().ok).toBe(true);
    killAll();
  });

  it("GET /stashes daftar kosong; stash create → 1 entri (SPEC-233)", async () => {
    const sr = makeRepoWithBranches();
    spawnSync("git", ["config", "user.email", "t@t"], { cwd: sr });
    await makeProject({ id: "stashrepo", repoDir: sr });
    expect((await app.inject({ url: "/api/projects/stashrepo/stashes" })).json()).toEqual([]);
    writeFileSync(`${sr}/README.md`, "wip");
    const c = await app.inject({ method: "POST", url: "/api/projects/stashrepo/git", payload: { op: "stash", message: "m" } });
    expect(c.statusCode).toBe(200);
    const list = (await app.inject({ url: "/api/projects/stashrepo/stashes" })).json();
    expect(list.length).toBe(1);
    expect(list[0].ref).toBe("stash@{0}");
  });

  it("POST /git rename-branch (ref-only) tak digerbang sesi aktif; fetch valid (SPEC-233)", async () => {
    await makeProject({ id: "renrepo", repoDir: makeRepoWithBranches("dev") });
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("renrepo", process.cwd()); // sesi aktif — rename tetap 200 (touchesTree=false)
    const r = await app.inject({ method: "POST", url: "/api/projects/renrepo/git", payload: { op: "rename-branch", from: "dev", to: "develop" } });
    expect(r.statusCode).toBe(200);
    const b = (await app.inject({ url: "/api/projects/renrepo/branches" })).json();
    expect(b.branches).toContain("develop"); expect(b.branches).not.toContain("dev");
    killAll();
  });

  it("POST /git/rebase clean → 200 {status:clean}; onto kosong → 400 (SPEC-233)", async () => {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/d.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev1");
    g("checkout", "-q", "main"); writeFileSync(`${dir}/m.txt`, "m"); g("add", "-A"); g("commit", "-qm", "main1");
    g("checkout", "-q", "dev");
    await makeProject({ id: "rebaserepo", repoDir: dir });
    expect((await app.inject({ method: "POST", url: "/api/projects/rebaserepo/git/rebase", payload: {} })).statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/projects/rebaserepo/git/rebase", payload: { onto: "main" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("clean");
  });
  it("remotes CRUD + archive + pr-url (SPEC-233)", async () => {
    const { repoDir } = makeRepoWithSpecBranch("intg"); // origin ada
    await makeProject({ id: "intgrepo", repoDir });
    const list = (await app.inject({ url: "/api/projects/intgrepo/remotes" })).json();
    expect(list.map((r: { name: string }) => r.name)).toContain("origin");
    // add + delete
    const added = await app.inject({ method: "POST", url: "/api/projects/intgrepo/remotes", payload: { name: "up", url: "https://example.com/x/y.git" } });
    expect(added.statusCode).toBe(200);
    expect(added.json().map((r: { name: string }) => r.name)).toContain("up");
    expect((await app.inject({ method: "POST", url: "/api/projects/intgrepo/remotes", payload: { name: "" } })).statusCode).toBe(400);
    const del = await app.inject({ method: "DELETE", url: "/api/projects/intgrepo/remotes/up" });
    expect(del.json().map((r: { name: string }) => r.name)).not.toContain("up");
    // archive
    const arc = await app.inject({ url: "/api/projects/intgrepo/archive?ref=main&format=zip" });
    expect(arc.statusCode).toBe(200);
    expect(arc.headers["content-disposition"]).toMatch(/\.zip/);
    // pr-url (origin adalah path lokal bare → bukan provider → url null, tapi 200)
    const pr = await app.inject({ url: "/api/projects/intgrepo/pr-url?branch=hanoman/intg" });
    expect(pr.statusCode).toBe(200);
    expect("url" in pr.json()).toBe(true);
  });
  it("GET /graph?branches=main membatasi walk (SPEC-233)", async () => {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/d.txt`, "d"); g("add", "-A"); g("commit", "-qm", "hanya dev"); g("checkout", "-q", "main");
    await makeProject({ id: "filterrepo", repoDir: dir });
    const all = (await app.inject({ url: "/api/projects/filterrepo/graph" })).json();
    const onlyMain = (await app.inject({ url: "/api/projects/filterrepo/graph?branches=main" })).json();
    expect(all.commits.some((c: { subject: string }) => c.subject === "hanya dev")).toBe(true);
    expect(onlyMain.commits.some((c: { subject: string }) => c.subject === "hanya dev")).toBe(false);
  });
  it("GET /graph/search by message → shas (SPEC-233)", async () => {
    const dir = makeRepoWithBranches();
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    writeFileSync(`${dir}/f.txt`, "1"); g("add", "-A"); g("commit", "-qm", "tambah fitur unik");
    await makeProject({ id: "searchrepo", repoDir: dir });
    const r = await app.inject({ url: "/api/projects/searchrepo/graph/search?q=unik&by=message" });
    expect(r.statusCode).toBe(200);
    expect(r.json().shas.length).toBe(1);
  });
  it("GET /compare dua commit; from/to kosong → 400 (SPEC-233)", async () => {
    const dir = makeRepoWithBranches();
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    writeFileSync(`${dir}/x.txt`, "1"); g("add", "-A"); g("commit", "-qm", "c2");
    writeFileSync(`${dir}/y.txt`, "2"); g("add", "-A"); g("commit", "-qm", "c3");
    await makeProject({ id: "cmprepo", repoDir: dir });
    const shas = g("log", "--format=%H").stdout.trim().split("\n"); // c3, c2, base
    expect((await app.inject({ url: "/api/projects/cmprepo/compare" })).statusCode).toBe(400);
    const r = await app.inject({ url: `/api/projects/cmprepo/compare?from=${shas[2]}&to=${shas[0]}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().changed.map((c: { path: string }) => c.path).sort()).toEqual(["x.txt", "y.txt"]);
  });
  it("GET /commit/:sha/file diff satu file; path kosong → 400 (SPEC-233)", async () => {
    const dir = makeRepoWithBranches();
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    writeFileSync(`${dir}/README.md`, "berubah"); g("add", "-A"); g("commit", "-qm", "ubah");
    await makeProject({ id: "cfrepo", repoDir: dir });
    const sha = g("rev-parse", "HEAD").stdout.trim();
    expect((await app.inject({ url: `/api/projects/cfrepo/commit/${sha}/file` })).statusCode).toBe(400);
    const r = await app.inject({ url: `/api/projects/cfrepo/commit/${sha}/file?path=README.md` });
    expect(r.statusCode).toBe(200);
    expect(r.json().diff).toMatch(/berubah/);
  });
  it("POST /git/drop clean → 200 {status:clean}; sha kosong → 400 (SPEC-233)", async () => {
    const dir = makeRepoWithBranches();
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    writeFileSync(`${dir}/buang.txt`, "x"); g("add", "-A"); g("commit", "-qm", "buang");
    writeFileSync(`${dir}/simpan.txt`, "y"); g("add", "-A"); g("commit", "-qm", "simpan");
    const buang = g("log", "--format=%H").stdout.trim().split("\n")[1];
    await makeProject({ id: "droprepo", repoDir: dir });
    expect((await app.inject({ method: "POST", url: "/api/projects/droprepo/git/drop", payload: {} })).statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/projects/droprepo/git/drop", payload: { sha: buang } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("clean");
  });
});

describe("branch cleanup (SPEC-360)", () => {
  it("GET /branches/unused: project tak ada → 404", async () => {
    const r = await app.inject({ url: "/api/projects/ghost/branches/unused" });
    expect(r.statusCode).toBe(404);
  });

  it("GET /branches/unused: branch ter-merge tampil, base & current terkunci", async () => {
    const r = await app.inject({ url: "/api/projects/cleanrepo/branches/unused" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.base).toBe("main");
    expect(j.baseRemote).toBe("origin/main");
    expect(j.current).toBe("main");
    const b = j.branches.find((x: { name: string }) => x.name === "hanoman/clean");
    expect(b).toMatchObject({ local: true, remote: true, locks: [] });
    expect(j.branches.find((x: { name: string }) => x.name === "main").locks).toContain("base");
  });

  it("GET /branches/unused: Spec belum done mengunci branch-nya", async () => {
    const r = await app.inject({ url: "/api/projects/lockrepo/branches/unused" });
    const b = r.json().branches.find((x: { name: string }) => x.name === "hanoman/locked");
    expect(b.locks).toContain("spec-open");
  });

  it("GET /branches/unused: project tanpa repoDir → laporan kosong", async () => {
    const r = await app.inject({ url: "/api/projects/nodir/branches/unused" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ base: "", baseRemote: null, current: "", branches: [] });
  });

  it("POST /branches/delete: names wajib", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/cleanrepo/branches/delete", payload: {} });
    expect(r.statusCode).toBe(400);
  });

  it("POST /branches/delete: scope tak sah → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/cleanrepo/branches/delete",
      payload: { names: ["hanoman/clean"], scope: "semua" } });
    expect(r.statusCode).toBe(400);
  });

  it("POST /branches/delete: project tanpa repoDir → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/nodir/branches/delete",
      payload: { names: ["x"] } });
    expect(r.statusCode).toBe(400);
  });

  it("POST /branches/delete: branch terkunci → results ok:false, branch selamat", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/lockrepo/branches/delete",
      payload: { names: ["hanoman/locked"], scope: "both" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().results[0]).toMatchObject({ name: "hanoman/locked", ok: false });
    const after = await app.inject({ url: "/api/projects/lockrepo/branches/unused" });
    expect(after.json().branches.some((x: { name: string }) => x.name === "hanoman/locked")).toBe(true);
  });

  it("GET /branches/unused?include=all memuat flag merged di tiap baris (SPEC-859)", async () => {
    const r = await app.inject({ url: "/api/projects/cleanrepo/branches/unused?include=all" });
    expect(r.statusCode).toBe(200);
    expect(r.json().branches.length).toBeGreaterThan(0);
    for (const b of r.json().branches) expect(typeof b.merged).toBe("boolean");
    const plain = await app.inject({ url: "/api/projects/cleanrepo/branches/unused" });
    expect(plain.json().branches.every((x: { merged: boolean }) => x.merged)).toBe(true);
  });

  it("POST /branches/delete: allowUnmerged bukan boolean → 400 (SPEC-859)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/cleanrepo/branches/delete",
      payload: { names: ["hanoman/clean"], allowUnmerged: "ya" } });
    expect(r.statusCode).toBe(400);
  });

  it("POST /branches/delete: hapus local+origin benar-benar terjadi", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/cleanrepo/branches/delete",
      payload: { names: ["hanoman/clean"], scope: "both" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().results[0]).toMatchObject({ name: "hanoman/clean", ok: true, scope: "both" });
    const after = await app.inject({ url: "/api/projects/cleanrepo/branches/unused" });
    expect(after.json().branches.some((x: { name: string }) => x.name === "hanoman/clean")).toBe(false);
  });
});

// ADR-0121 · operasi berkas Explorer: buat, rename, hapus.
describe("operasi berkas IDE (entry)", () => {
  const post = (b: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/projects/entryrepo/entry", payload: b });

  it("POST membuat berkas kosong", async () => {
    const r = await post({ path: "src/ds/Baru.tsx", kind: "file" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ path: "src/ds/Baru.tsx" });
    const tree = await app.inject({ url: "/api/projects/entryrepo/tree" });
    expect(tree.json().files).toContain("src/ds/Baru.tsx");
  });

  it("POST kind=dir membuat folder ber-.gitkeep", async () => {
    expect((await post({ path: "kosong", kind: "dir" })).statusCode).toBe(201);
    const tree = await app.inject({ url: "/api/projects/entryrepo/tree" });
    expect(tree.json().files).toContain("kosong/.gitkeep");
  });

  it("POST path yang sudah ada → 409", async () => {
    await post({ path: "dobel.txt", kind: "file" });
    expect((await post({ path: "dobel.txt", kind: "file" })).statusCode).toBe(409);
  });

  it("POST body tak sah → 400", async () => {
    expect((await post({ kind: "file" })).statusCode).toBe(400);
    expect((await post({ path: "x.txt", kind: "symlink" })).statusCode).toBe(400);
  });

  it("PATCH me-rename berkas", async () => {
    await post({ path: "lama.txt", kind: "file" });
    const r = await app.inject({ method: "PATCH", url: "/api/projects/entryrepo/entry",
      payload: { from: "lama.txt", to: "baru/nama.txt" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ from: "lama.txt", to: "baru/nama.txt" });
  });

  it("PATCH sumber tak ada → 404; tujuan sudah ada → 409; tujuan di dalam sumber → 400", async () => {
    const patch = (b: Record<string, unknown>) => app.inject({ method: "PATCH", url: "/api/projects/entryrepo/entry", payload: b });
    expect((await patch({ from: "hantu.txt", to: "z.txt" })).statusCode).toBe(404);
    await post({ path: "ada1.txt", kind: "file" });
    await post({ path: "ada2.txt", kind: "file" });
    expect((await patch({ from: "ada1.txt", to: "ada2.txt" })).statusCode).toBe(409);
    await post({ path: "folder/isi.txt", kind: "file" });
    expect((await patch({ from: "folder", to: "folder/dalam" })).statusCode).toBe(400);
  });

  it("DELETE menghapus berkas & folder; yang tak ada → 404", async () => {
    await post({ path: "buang.txt", kind: "file" });
    const r = await app.inject({ method: "DELETE", url: "/api/projects/entryrepo/entry?path=buang.txt" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ path: "buang.txt", kind: "file" });
    await post({ path: "buangdir/isi.txt", kind: "file" });
    expect((await app.inject({ method: "DELETE", url: "/api/projects/entryrepo/entry?path=buangdir" })).json())
      .toEqual({ path: "buangdir", kind: "dir" });
    expect((await app.inject({ method: "DELETE", url: "/api/projects/entryrepo/entry?path=hantu.txt" })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/entryrepo/entry" })).statusCode).toBe(400);
  });

  it("path berbahaya ditolak 400 di ketiga method, .git utuh", async () => {
    for (const p of ["../keluar.txt", "/etc/passwd", ".git/hooks/pre-commit"]) {
      expect((await post({ path: p, kind: "file" })).statusCode).toBe(400);
      expect((await app.inject({ method: "PATCH", url: "/api/projects/entryrepo/entry",
        payload: { from: "README.md", to: p } })).statusCode).toBe(400);
      expect((await app.inject({ method: "DELETE",
        url: `/api/projects/entryrepo/entry?path=${encodeURIComponent(p)}` })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: "/api/projects/entryrepo/tree" })).json().files).toContain("README.md");
  });

  it("project tak ada → 404; project tanpa repoDir → 400", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/ghost/entry",
      payload: { path: "a.txt", kind: "file" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/projects/nodir/entry",
      payload: { path: "a.txt", kind: "file" } })).statusCode).toBe(400);
  });

  // AC-14 · sesi aktif TIDAK memblokir: ini bukan operasi git & tak memindahkan HEAD.
  // Pola persis test "PUT /file … TIDAK digerbang sesi aktif" di berkas yang sama.
  it("sesi aktif tak memblokir operasi berkas", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("entryrepo", process.cwd());
    expect((await post({ path: "saat-sesi.txt", kind: "file" })).statusCode).toBe(201);
    killAll();
  });
});

// Badan multipart minimal: field lebih dulu, lalu berkas — urutan itu bagian dari kontrak
// (manifest harus terbaca sebelum part berkas pertama).
function multipart(fields: Record<string, string>, files: { name: string; body: string }[]) {
  const B = "----hanomanTestBoundary";
  const chunks: string[] = [];
  for (const [k, v] of Object.entries(fields))
    chunks.push(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  for (const f of files)
    chunks.push(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n${f.body}\r\n`);
  chunks.push(`--${B}--\r\n`);
  return { payload: chunks.join(""), headers: { "content-type": `multipart/form-data; boundary=${B}` } };
}
const upload = (project: string, fields: Record<string, string>, files: { name: string; body: string }[]) =>
  app.inject({ method: "POST", url: `/api/projects/${project}/upload`, ...multipart(fields, files) });

// Catatan cakupan: `reason: "too-large"` (>100 MB) TIDAK diuji di lapis route — mengirim 100 MB
// lewat app.inject tak sepadan. Ia diuji di lapis service (`repo-fs.test.ts`, jalur `isTruncated`),
// dan yang tersisa di route hanya penyambungan `() => part.file.truncated === true`.
describe("unggah berkas IDE (upload)", () => {
  it("menulis berkas ke folder tujuan, struktur manifest ikut terbentuk", async () => {
    const r = await upload("entryrepo",
      { dir: "aset", manifest: JSON.stringify(["a.txt", "sub/b.txt"]) },
      [{ name: "a.txt", body: "AAA" }, { name: "b.txt", body: "BBB" }]);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ written: ["aset/a.txt", "aset/sub/b.txt"], skipped: [] });
    const tree = (await app.inject({ url: "/api/projects/entryrepo/tree" })).json().files;
    expect(tree).toContain("aset/sub/b.txt");
  });

  it("tanpa manifest, nama berkas multipart yang dipakai", async () => {
    const r = await upload("entryrepo", { dir: "" }, [{ name: "polos.txt", body: "P" }]);
    expect(r.json().written).toEqual(["polos.txt"]);
  });

  it("berkas yang sudah ada dilewati & dilaporkan, sisanya tetap ditulis", async () => {
    await upload("entryrepo", { dir: "dup" }, [{ name: "sama.txt", body: "asli" }]);
    const r = await upload("entryrepo", { dir: "dup", manifest: JSON.stringify(["sama.txt", "beda.txt"]) },
      [{ name: "sama.txt", body: "baru" }, { name: "beda.txt", body: "baru" }]);
    expect(r.json()).toEqual({ written: ["dup/beda.txt"], skipped: [{ path: "dup/sama.txt", reason: "exists" }] });
    const isi = await app.inject({ url: "/api/projects/entryrepo/file?path=dup%2Fsama.txt" });
    expect(isi.json().content).toBe("asli");
  });

  it("overwrite=1 menimpa", async () => {
    await upload("entryrepo", { dir: "ow" }, [{ name: "x.txt", body: "lama" }]);
    const r = await upload("entryrepo", { dir: "ow", overwrite: "1" }, [{ name: "x.txt", body: "baru" }]);
    expect(r.json().written).toEqual(["ow/x.txt"]);
    expect((await app.inject({ url: "/api/projects/entryrepo/file?path=ow%2Fx.txt" })).json().content).toBe("baru");
  });

  it("path berbahaya masuk skipped:denied, bukan menggagalkan unggahan", async () => {
    const r = await upload("entryrepo", { dir: "", manifest: JSON.stringify(["../keluar.txt", "aman.txt"]) },
      [{ name: "keluar.txt", body: "X" }, { name: "aman.txt", body: "Y" }]);
    expect(r.json().written).toEqual(["aman.txt"]);
    expect(r.json().skipped).toEqual([{ path: "../keluar.txt", reason: "denied" }]);
  });

  // AC-8 · anggaran total. Ceiling dibaca PER-REQUEST dari env supaya bisa diuji tanpa
  // mengirim 2 GB; default-nya tetap 2 GB dan tak ada UI/knob yang mengubahnya.
  it("total badan melewati anggaran → sisanya skipped:budget", async () => {
    process.env.HANOMAN_IDE_UPLOAD_MAX_BYTES = "3";
    try {
      const r = await upload("entryrepo", { dir: "bujet", manifest: JSON.stringify(["p.txt", "q.txt"]) },
        [{ name: "p.txt", body: "AAAA" }, { name: "q.txt", body: "B" }]);
      expect(r.json().written).toEqual(["bujet/p.txt"]);
      expect(r.json().skipped).toEqual([{ path: "bujet/q.txt", reason: "budget" }]);
    } finally { delete process.env.HANOMAN_IDE_UPLOAD_MAX_BYTES; }
  });

  it("manifest tak sepanjang daftar berkas → 400", async () => {
    const r = await upload("entryrepo", { dir: "", manifest: JSON.stringify(["satu.txt"]) },
      [{ name: "satu.txt", body: "1" }, { name: "dua.txt", body: "2" }]);
    expect(r.statusCode).toBe(400);
  });

  it("bukan multipart → 400; project tanpa repoDir → 400; project tak ada → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/entryrepo/upload", payload: { a: 1 } })).statusCode).toBe(400);
    expect((await upload("nodir", { dir: "" }, [{ name: "a.txt", body: "A" }])).statusCode).toBe(400);
    expect((await upload("ghost", { dir: "" }, [{ name: "a.txt", body: "A" }])).statusCode).toBe(404);
  });
});
