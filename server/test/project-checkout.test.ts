import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prisma } from "../src/db";
import { makeRepoWithBranches } from "./factory";
import { resolveRepoDir } from "../src/services/local-binding";
import {
  CheckoutError, checkoutRoot, cloneProjectCheckout, fetchRefIfMissing,
} from "../src/services/project-checkout";

const clean = async () => { await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
let home: string;
const oldHome = process.env.HANOMAN_HOME;
beforeEach(async () => { await clean(); home = mkdtempSync(join(tmpdir(), "hn-home-")); process.env.HANOMAN_HOME = home; });
afterEach(() => { if (oldHome === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = oldHome; });
afterAll(clean);

const project = (gitRemote: string | null, id = "p1") =>
  prisma.project.create({ data: { id, name: id, desc: "d", kind: "existing", repoDir: null, gitRemote } });
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });

describe("cloneProjectCheckout", () => {
  it("clone ke <HANOMAN_HOME>/projects/<id> dan memasang binding", async () => {
    await project(makeRepoWithBranches("main"));
    const dir = await cloneProjectCheckout("p1", { token: null });
    expect(dir).toBe(join(checkoutRoot(), "p1"));
    expect(checkoutRoot()).toBe(join(home, "projects"));
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(await resolveRepoDir("p1")).toBe(dir);
  });

  it("memakai dir eksplisit", async () => {
    await project(makeRepoWithBranches("main"));
    const dest = join(mkdtempSync(join(tmpdir(), "hn-dest-")), "repo");
    expect(await cloneProjectCheckout("p1", { dir: dest, token: null })).toBe(dest);
    expect(await resolveRepoDir("p1")).toBe(dest);
  });

  it("project tak ada → not-found; tanpa gitRemote → no-remote", async () => {
    await expect(cloneProjectCheckout("nope", { token: null })).rejects.toMatchObject({ kind: "not-found" });
    await project(null);
    await expect(cloneProjectCheckout("p1", { token: null })).rejects.toMatchObject({ kind: "no-remote" });
  });

  it("folder tujuan berisi repo dengan remote yang sama dipakai ulang tanpa clone", async () => {
    const remote = makeRepoWithBranches("main");
    await project(remote);
    const first = await cloneProjectCheckout("p1", { token: null });
    writeFileSync(join(first, "lokal.txt"), "jangan hilang");
    await prisma.localBinding.deleteMany();
    expect(await cloneProjectCheckout("p1", { token: null })).toBe(first);
    expect(readFileSync(join(first, "lokal.txt"), "utf8")).toBe("jangan hilang");
    expect(await resolveRepoDir("p1")).toBe(first);
  });

  it("folder tujuan terisi hal lain → occupied, isi tidak ditimpa", async () => {
    await project(makeRepoWithBranches("main"));
    const dest = join(home, "projects", "p1");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "milik-orang.txt"), "x");
    await expect(cloneProjectCheckout("p1", { token: null })).rejects.toMatchObject({ kind: "occupied" });
    expect(existsSync(join(dest, "milik-orang.txt"))).toBe(true);
    expect(await resolveRepoDir("p1")).toBeNull();
  });

  it("clone gagal → kind clone, folder sisa dihapus, tanpa binding", async () => {
    await project(join(tmpdir(), "tidak-ada-repo-ini"));
    const err = await cloneProjectCheckout("p1", { token: null }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckoutError);
    expect(["clone", "auth"]).toContain(err.kind);
    expect(existsSync(join(home, "projects", "p1"))).toBe(false);
    expect(await resolveRepoDir("p1")).toBeNull();
  });

  it("dua panggilan bersamaan untuk project yang sama menghasilkan satu clone", async () => {
    await project(makeRepoWithBranches("main"));
    const [a, b] = await Promise.all([
      cloneProjectCheckout("p1", { token: null }), cloneProjectCheckout("p1", { token: null }),
    ]);
    expect(a).toBe(b);
  });

  it("pesan galat tidak memuat token", async () => {
    await project("https://github.com/tidak-ada-org-ini-xyz/tidak-ada-repo.git");
    const err = await cloneProjectCheckout("p1", { token: "ghp_RAHASIA123" }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckoutError);
    expect(`${err.message} ${err.detail ?? ""}`).not.toContain("ghp_RAHASIA123");
  }, 30_000);
});

describe("fetchRefIfMissing", () => {
  it("mengambil branch yang baru ada di remote", async () => {
    const remote = makeRepoWithBranches("main");
    await project(remote);
    const dir = await cloneProjectCheckout("p1", { token: null });
    git(remote, "branch", "fitur-baru");
    expect(git(dir, "rev-parse", "--verify", "origin/fitur-baru").status).not.toBe(0);
    await fetchRefIfMissing(dir, "fitur-baru", null);
    expect(git(dir, "rev-parse", "--verify", "origin/fitur-baru").status).toBe(0);
  });

  it("tidak melakukan apa pun untuk rev kosong, dan tidak melempar bila fetch gagal", async () => {
    const dir = makeRepoWithBranches("main"); // tanpa remote origin
    await expect(fetchRefIfMissing(dir, null, null)).resolves.toBeUndefined();
    await expect(fetchRefIfMissing(dir, "tidak-ada", null)).resolves.toBeUndefined();
  });
});
