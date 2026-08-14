import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { setBinding } from "../src/services/local-binding";

// requireAuth:false — uji guard, bukan auth. Tak ada sesi claude yang di-spawn: kasus positif
// mem-bind ke dir NON-git sehingga addWorktree gagal (422) SEBELUM createSession.
const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const start = (spec: string) =>
  app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec, flow: "feature" } });

describe("spawn guard pakai binding lokal (SPEC-213 AC-8)", () => {
  it("project tanpa repoDir & tanpa binding → 400 + needsBind:true", async () => {
    await prisma.project.create({ data: { id: "p9", name: "p9", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-990", projectId: "p9", title: "t", source: "brief", stage: "planned", priority: "sedang", author: "x", objective: "o", launchApprovedAt: new Date(), launchApprovedBy: "test" } });
    const r = await start("SPEC-990");
    expect(r.statusCode).toBe(400);
    expect(r.json().needsBind).toBe(true);
  });

  it("dengan binding lokal, guard lewat (bukan needsBind); worktree gagal di dir non-git → 422", async () => {
    await prisma.project.create({ data: { id: "p9", name: "p9", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-991", projectId: "p9", title: "t", source: "brief", stage: "planned", priority: "sedang", author: "x", objective: "o", launchApprovedAt: new Date(), launchApprovedBy: "test" } });
    const nonGit = mkdtempSync(join(tmpdir(), "hn-nongit-"));
    await setBinding("p9", nonGit);
    const r = await start("SPEC-991");
    expect(r.statusCode).toBe(422); // addWorktree gagal — tapi guard needsBind sudah lewat
    expect(r.json().needsBind).toBeUndefined();
    rmSync(nonGit, { recursive: true, force: true });
  });
});
