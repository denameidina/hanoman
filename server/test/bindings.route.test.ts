import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { makeRepoWithBranches } from "./factory";
import { resolveRepoDir } from "../src/services/local-binding";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function pathlessProject(gitRemote?: string) {
  return prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null, gitRemote: gitRemote ?? null } });
}

describe("LocalBinding bind/clone (SPEC-213 AC-6/7)", () => {
  it("PUT binding then GET returns it; resolveRepoDir prefers binding", async () => {
    await pathlessProject();
    const put = await app.inject({ method: "PUT", url: "/api/projects/p1/binding", payload: { repoDir: "/tmp/x" } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/api/projects/p1/binding" });
    expect(get.json()).toMatchObject({ repoDir: "/tmp/x" });
    expect(await resolveRepoDir("p1")).toBe("/tmp/x");
  });

  it("resolveRepoDir falls back to Project.repoDir when no binding", async () => {
    await prisma.project.create({ data: { id: "p2", name: "p2", desc: "d", kind: "existing", repoDir: "/srv/checkout" } });
    expect(await resolveRepoDir("p2")).toBe("/srv/checkout");
  });

  it("clone from gitRemote sets binding + creates a .git checkout", async () => {
    const remote = makeRepoWithBranches("main");
    await pathlessProject(remote);
    const dest = join(mkdtempSync(join(tmpdir(), "hn-clone-")), "repo");
    const r = await app.inject({ method: "POST", url: "/api/projects/p1/clone", payload: { dir: dest } });
    expect(r.statusCode).toBe(201);
    expect(existsSync(join(dest, ".git"))).toBe(true);
    expect(await resolveRepoDir("p1")).toBe(dest);
    rmSync(dest, { recursive: true, force: true });
  });

  it("clone ke folder yang sudah berisi hal lain → 409 dan isinya tidak ditimpa", async () => {
    await pathlessProject(makeRepoWithBranches("main"));
    const dest = mkdtempSync(join(tmpdir(), "hn-clone-"));
    writeFileSync(join(dest, "milik-orang.txt"), "x");
    const r = await app.inject({ method: "POST", url: "/api/projects/p1/clone", payload: { dir: dest } });
    expect(r.statusCode).toBe(409);
    expect(existsSync(join(dest, "milik-orang.txt"))).toBe(true);
  });

  it("clone gagal → 409 dengan detail stderr git dan tanpa binding", async () => {
    await pathlessProject(join(tmpdir(), "tidak-ada-repo-ini"));
    const dest = join(mkdtempSync(join(tmpdir(), "hn-clone-")), "repo");
    const r = await app.inject({ method: "POST", url: "/api/projects/p1/clone", payload: { dir: dest } });
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toBeTruthy();
    expect(await resolveRepoDir("p1")).toBeNull();
  });

  it("clone without gitRemote → 409", async () => {
    await pathlessProject();
    const dest = join(mkdtempSync(join(tmpdir(), "hn-clone-")), "repo");
    const r = await app.inject({ method: "POST", url: "/api/projects/p1/clone", payload: { dir: dest } });
    expect(r.statusCode).toBe(409);
  });
});
