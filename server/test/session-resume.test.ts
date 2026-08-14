import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import { startSpecSession } from "../src/services/session-launch";
import { killAll, killSession, getSession, createSession, promptFilePath } from "../src/services/pty";
import { realGit } from "@hanoman/runner";

// SPEC-394 · ADR-0084 — "Lanjutkan" harus MELANJUTKAN. Alat ukur test ini adalah perbedaan dua
// binary palsu: fake-claude.sh TETAP HIDUP (`exec cat`), /bin/echo langsung keluar sehingga
// pane-nya `dead` (tmux `remain-on-exit on`). Pane mati tak bisa berubah jadi hidup tanpa spawn
// baru — itulah bukti yang tak bisa dipalsukan oleh bentuk respons.
const ALIVE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const DIES = "/bin/echo";

const clean = async () => {
  killAll();
  await prisma.setting.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany();
};
beforeEach(clean); afterAll(clean);

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: GIT_ENV });

/** Repo ber-origin bare + satu commit di `main`, ter-bind ke project `p`. */
async function seed(specId: string, stage = "planned") {
  const remote = mkdtempSync(join(tmpdir(), "hanoman394-remote-"));
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const dir = mkdtempSync(join(tmpdir(), "hanoman394-repo-"));
  execFileSync("git", ["init", "-q", dir]);
  g(dir, "commit", "-q", "--allow-empty", "-m", "root");
  g(dir, "branch", "-M", "main");
  g(dir, "remote", "add", "origin", remote);
  g(dir, "push", "-q", "origin", "main");
  await prisma.project.upsert({
    where: { id: "p" }, update: { repoDir: dir },
    create: { id: "p", name: "P", desc: "", kind: "existing", repoDir: dir },
  });
  const spec = await prisma.spec.create({ data: {
    id: specId, projectId: "p", title: "t", source: "qa", stage,
    author: "a", priority: "tinggi", objective: "o",
    launchApprovedAt: new Date(), launchApprovedBy: "test",
  } });
  return { dir, spec };
}

const waitExited = async (id: string) => {
  for (let i = 0; i < 200 && !getSession(id)?.exited; i++) await new Promise((r) => setTimeout(r, 20));
  return getSession(id)?.exited === true;
};

describe("SPEC-394 · pane mati bukan sesi hidup", () => {
  it("pane HIDUP tetap re-attach (ADR-0015), tanpa menyentuh apa pun", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { spec } = await seed("SPEC-L1");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const r2 = await startSpecSession(spec, { flow: "qa" });
    expect(r2).toEqual({ id: r1.id, reused: true });
    killSession(r1.id);
  });

  it("pane MATI dilahirkan ulang, bukan dikembalikan sebagai sesi", async () => {
    process.env.HANOMAN_CLAUDE_BIN = DIES;
    const { spec } = await seed("SPEC-L2");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    expect(await waitExited(r1.id)).toBe(true);

    process.env.HANOMAN_CLAUDE_BIN = ALIVE;   // sesi kedua hidup — pane mati tak bisa jadi hidup
    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L2" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.reused).toBeFalsy();
    expect(getSession(r2.id)?.exited).toBe(false);
    killSession(r2.id);
  });

  // SPEC-408 · ADR-0090 · melanjutkan bukan "mulai lagi": startedAt harus setua sesi PERTAMA,
  // cermin persis dari baseSha yang juga tak ditulis ulang saat resume (ADR-0084).
  it("resume tidak menulis ulang startedAt (SPEC-408)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = DIES;
    const { spec } = await seed("SPEC-408R");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    expect(await waitExited(r1.id)).toBe(true);
    const first = (await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-408R" } })).startedAt;
    expect(first).toBeInstanceOf(Date);

    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    await new Promise((r) => setTimeout(r, 25));
    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-408R" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    const after = (await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-408R" } })).startedAt;
    expect(after!.getTime()).toBe(first!.getTime());
    killSession(r2.id);
  });
});

describe("SPEC-394 · resume dengan worktree utuh", () => {
  it("tak menghapus worktree, tak menulis ulang baseSha, dan mengirim prompt lanjutan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L3");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const wt = join(dir, ".worktrees", r1.id);
    const baseAwal = (await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } })).baseSha;

    // kerja setengah jalan: plan berkotak + berkas belum di-commit + fase tercatat
    mkdirSync(join(wt, "docs", "superpowers", "plans"), { recursive: true });
    writeFileSync(join(wt, "docs", "superpowers", "plans", "spec-l3-plan.md"), "- [x] satu\n- [ ] dua\n");
    writeFileSync(join(wt, "belum-commit.txt"), "jangan hilang");
    writeFileSync(join(dir, ".worktrees", ".phases", r1.id), "Audit done\nSpec skipped\n");
    killSession(r1.id);   // pane hilang, worktree tetap (mis. mesin restart)

    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.resumed).toBe(true);
    expect(existsSync(join(wt, "belum-commit.txt"))).toBe(true);
    expect(existsSync(join(wt, "docs", "superpowers", "plans", "spec-l3-plan.md"))).toBe(true);

    const after = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } });
    expect(after.baseSha).toBe(baseAwal);

    const prompt = readFileSync(promptFilePath(r2.id), "utf8");
    expect(prompt).toContain("MELANJUTKAN");
    expect(prompt).toContain("Audit done");
    expect(prompt).toContain("Spec skipped");
    expect(prompt).toContain("Lanjutkan dari fase: Plan.");
    expect(prompt).toContain("belum di-commit");
    killSession(r2.id);
  });

  it("berkas fase tidak pernah ditulis server", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L4");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const phaseFile = join(dir, ".worktrees", ".phases", r1.id);
    writeFileSync(phaseFile, "Audit done\n");
    killSession(r1.id);
    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L4" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(readFileSync(phaseFile, "utf8")).toBe("Audit done\n");
    killSession(r2.id);
  });
});

describe("SPEC-394 · resume tanpa worktree, fresh, dan stage done", () => {
  it("worktree hilang tapi branch sesi ada → lahir di tip branch itu", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L5");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const wt = join(dir, ".worktrees", r1.id);
    const baseAwal = (await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L5" } })).baseSha;

    writeFileSync(join(wt, "hasil.txt"), "commit sesi 1");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "kerja sesi 1");
    const tip = g(wt, "rev-parse", "HEAD").trim();
    g(wt, "push", "-q", "origin", `HEAD:refs/heads/hanoman/${r1.id}`);
    killSession(r1.id);
    realGit.removeWorktree(dir, wt);            // operator menutup sesi (SPEC-362)
    expect(existsSync(wt)).toBe(false);

    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L5" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.resumed).toBe(true);
    expect(realGit.headSha(wt)).toBe(tip);       // bukan `main`
    expect(existsSync(join(wt, "hasil.txt"))).toBe(true);
    expect((await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L5" } })).baseSha).toBe(baseAwal);

    const prompt = readFileSync(promptFilePath(r2.id), "utf8");
    expect(prompt).toContain("DIBANGUN ULANG");
    expect(prompt).toContain("TIDAK ada");
    killSession(r2.id);
  });

  it("tanpa worktree & tanpa branch sesi → perilaku lama persis (startPrompt, baseSha ditulis)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { spec } = await seed("SPEC-L6");
    const r = await startSpecSession(spec, { flow: "qa" });
    expect(r.resumed).toBeUndefined();
    const row = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L6" } });
    expect(row.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(row.headSha).toBeNull();
    const prompt = readFileSync(promptFilePath(r.id), "utf8");
    expect(prompt).not.toContain("MELANJUTKAN");
    expect(prompt).toContain("Kerjakan fase berurutan: Audit → Spec → Plan → Execute.");
    killSession(r.id);
  });

  it("stage done tetap jalur SPEC-172: continuePrompt, worktree dari branchFrom", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L7", "done");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const wt = join(dir, ".worktrees", r1.id);
    writeFileSync(join(wt, "sisa.txt"), "artefak sesi lama");
    killSession(r1.id);

    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L7" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.resumed).toBeUndefined();
    expect(existsSync(join(wt, "sisa.txt"))).toBe(false);   // worktree memang dibangun ulang
    const prompt = readFileSync(promptFilePath(r2.id), "utf8");
    expect(prompt).toContain("sebelumnya ditandai selesai");
    expect(prompt).not.toContain("Sesi ini MELANJUTKAN pekerjaan sesi sebelumnya");
    killSession(r2.id);
  });
});

// SPEC-394 · ADR-0084 · titik cekik. `startSpecSession` sudah dijaga di atas, tapi `createSession`
// adalah pintu yang dilewati SEMUA kelahiran sesi — termasuk yang tak punya gerbang sendiri
// (sesi konflik `merge-<spec>` & `finishGraphOp`, konsol VPS `vpsc-<id>`). Satu gerbang di sini
// menutup semuanya.
describe("SPEC-394 · pane mati di titik cekik createSession", () => {
  it("pane HIDUP dikembalikan apa adanya; pane MATI dibunuh lalu di-spawn ulang", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const a = createSession("p-cekik", process.cwd(), { id: "cekik-1" });
    expect(createSession("p-cekik", process.cwd(), { id: "cekik-1" }).id).toBe(a.id);
    expect(getSession("cekik-1")?.exited).toBe(false);
    killSession("cekik-1");

    process.env.HANOMAN_CLAUDE_BIN = DIES;
    const b = createSession("p-cekik", process.cwd(), { id: "cekik-2" });
    for (let i = 0; i < 200 && !getSession(b.id)?.exited; i++) await new Promise((r) => setTimeout(r, 20));
    expect(getSession("cekik-2")?.exited).toBe(true);

    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const c = createSession("p-cekik", process.cwd(), { id: "cekik-2" });
    expect(c.id).toBe("cekik-2");
    expect(getSession("cekik-2")?.exited).toBe(false);   // pane mati tak bisa jadi hidup tanpa spawn
    killSession("cekik-2");
  });
});
