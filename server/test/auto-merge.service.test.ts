import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import { sweepAutoMerge, AUTO_MERGE_GRACE_MS, AUTO_MERGE_WINDOW_MS, type AutoMergeDeps } from "../src/services/auto-merge";
import type { IntegrateResult } from "../src/services/integrate";

const clean = async () => {
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const NOW = new Date("2026-08-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const POLICY = { mode: "default-branch", dest: "local", branch: null, deleteBranch: false };

async function seed(opts: {
  projectPolicy?: unknown; specPolicy?: unknown; headSha?: string | null; doneAt?: Date;
  manualDone?: unknown;   // SPEC-804 · ADR-0120
} = {}) {
  await prisma.project.create({
    data: { id: "p", name: "P", desc: "", kind: "existing", repoDir: "/repo",
      ...(opts.projectPolicy !== undefined ? { autoMerge: opts.projectPolicy as object } : {}) },
  });
  await prisma.spec.create({
    data: { id: "SPEC-1", projectId: "p", title: "Fitur", source: "brief", stage: "done",
      // `??` haram di sini: `headSha: null` adalah kasus yang SEDANG diuji, dan `?? "aaa"`
      // akan diam-diam mengembalikannya ke "aaa" sehingga test-nya lulus tanpa menguji apa pun.
      priority: "sedang", author: "a", objective: "",
      headSha: opts.headSha === undefined ? "aaa" : opts.headSha,
      ...(opts.specPolicy !== undefined ? { autoMerge: opts.specPolicy as object } : {}),
      ...(opts.manualDone !== undefined ? { manualDone: opts.manualDone as object } : {}) },
  });
  await prisma.notification.create({
    data: { type: "done", key: "done:SPEC-1", specId: "SPEC-1", projectId: "p",
      title: "Fitur", createdAt: opts.doneAt ?? ago(60_000) },
  });
}

function deps(over: Partial<AutoMergeDeps> = {}): AutoMergeDeps {
  return {
    repoDir: async () => "/repo",
    defaultBranch: async () => "main",
    sourceTip: async () => "tip1",
    contains: async () => true,
    integrate: (async () => ({ status: "clean", detail: "lokal main → tip1" })) as AutoMergeDeps["integrate"],
    discardWorktree: async () => { },
    deleteBranch: async () => { },
    ...over,
  };
}
const marker = () => prisma.notification.findUnique({ where: { key: "automerge:SPEC-1" } });

describe("sweepAutoMerge — gerbang kandidat", () => {
  it("tanpa kebijakan: nol panggilan integrate, nol penanda (perilaku lama utuh)", async () => {
    await seed();
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
    expect(await marker()).toBeNull();
  });

  it("spec bisa MEMATIKAN kebijakan project untuk dirinya sendiri", async () => {
    await seed({ projectPolicy: POLICY, specPolicy: { mode: "off" } });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
  });

  // SPEC-804 · ADR-0120 · kandidat sweep = notifikasi `done:`, yang kini juga ditulis jalur
  // penandaan manual. Tanpa gerbang ini item yang ditandai manual memicu merge branch sesi lama
  // yang ditinggalkan — dan untuk item tanpa sesi, notifikasi "belum ter-push" yang salah.
  it("penyelesaian MANUAL tak pernah di-auto-merge (SPEC-804)", async () => {
    await seed({ projectPolicy: POLICY, manualDone: { at: NOW.toISOString(), by: "dena@x" } });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
    expect(await marker()).toBeNull();
  });

  it("spec bisa MENYALAKAN auto-merge di project tanpa kebijakan", async () => {
    await seed({ specPolicy: { mode: "branch", dest: "origin", branch: "rilis" } });
    const integrate = vi.fn(async () => ({ status: "clean", detail: "push origin rilis" } as IntegrateResult));
    await sweepAutoMerge(deps({ integrate: integrate as never }), NOW);
    expect(integrate).toHaveBeenCalledWith("/repo", "SPEC-1", "merge", "origin:rilis");
  });

  // Menyalakan setting TIDAK boleh menggabungkan seluruh sejarah project.
  it("spec yang selesai lebih dari 24 jam lalu bukan kandidat sama sekali", async () => {
    await seed({ projectPolicy: POLICY, doneAt: ago(AUTO_MERGE_WINDOW_MS + 60_000) });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
    expect(await marker()).toBeNull();
  });

  it("stage yang belum done bukan kandidat", async () => {
    await seed({ projectPolicy: POLICY });
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { stage: "executing" } });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
  });

  it("penanda mencegah percobaan kedua (idempoten lintas restart)", async () => {
    await seed({ projectPolicy: POLICY });
    await sweepAutoMerge(deps(), NOW);
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
  });
});

describe("sweepAutoMerge — kesiapan branch", () => {
  it("branch belum ada & masih dalam grace → diam, tak menandai, dicoba lagi nanti", async () => {
    await seed({ projectPolicy: POLICY, doneAt: ago(60_000) });
    const integrate = vi.fn();
    expect(await sweepAutoMerge(deps({ sourceTip: async () => null, integrate: integrate as never }), NOW)).toBe(0);
    expect(integrate).not.toHaveBeenCalled();
    expect(await marker()).toBeNull();
  });

  it("headSha belum jadi leluhur tip (push belum mendarat) → tunggu", async () => {
    await seed({ projectPolicy: POLICY, doneAt: ago(60_000) });
    const integrate = vi.fn();
    await sweepAutoMerge(deps({ contains: async () => false, integrate: integrate as never }), NOW);
    expect(integrate).not.toHaveBeenCalled();
  });

  it("lewat grace tanpa branch → MENYERAH DENGAN SUARA (notifikasi + penanda)", async () => {
    await seed({ projectPolicy: POLICY, doneAt: ago(AUTO_MERGE_GRACE_MS + 60_000) });
    expect(await sweepAutoMerge(deps({ sourceTip: async () => null }), NOW)).toBe(1);
    const n = await marker();
    expect(n!.type).toBe("automerge");
    expect(n!.title).toMatch(/belum ter-push/);
  });

  it("headSha null → branch apa adanya sudah cukup", async () => {
    await seed({ projectPolicy: POLICY, headSha: null });
    const integrate = vi.fn(async () => ({ status: "clean", detail: "ok" } as IntegrateResult));
    await sweepAutoMerge(deps({ contains: async () => false, integrate: integrate as never }), NOW);
    expect(integrate).toHaveBeenCalled();
  });
});

describe("sweepAutoMerge — hasil", () => {
  it("clean → notifikasi sukses menyebut tujuan", async () => {
    await seed({ projectPolicy: POLICY });
    expect(await sweepAutoMerge(deps(), NOW)).toBe(1);
    const n = await marker();
    expect(n!.title).toMatch(/SPEC-1/);
    expect(n!.title).toMatch(/local:main/);
    expect(n!.specId).toBe("SPEC-1");
  });

  it("clean + deleteBranch mati → branch kerja TIDAK dihapus", async () => {
    await seed({ projectPolicy: POLICY });
    const deleteBranch = vi.fn(async () => { });
    await sweepAutoMerge(deps({ deleteBranch }), NOW);
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it("clean + deleteBranch nyala → branch kerja dihapus SESUDAH merge bersih", async () => {
    await seed({ projectPolicy: { ...POLICY, deleteBranch: true } });
    const deleteBranch = vi.fn(async () => { });
    await sweepAutoMerge(deps({ deleteBranch }), NOW);
    expect(deleteBranch).toHaveBeenCalledWith("/repo", "hanoman/spec-1");
  });

  it("conflict → worktree merge dibersihkan, branch kerja TIDAK dihapus, notifikasi berisi alasan", async () => {
    await seed({ projectPolicy: { ...POLICY, deleteBranch: true } });
    const discardWorktree = vi.fn(async () => { });
    const deleteBranch = vi.fn(async () => { });
    const integrate = (async () => ({
      status: "conflict", worktree: "/repo/.worktrees/merge-spec-1", op: "merge",
      source: "refs/remotes/origin/hanoman/spec-1", target: "local:main", finalize: "…",
    })) as AutoMergeDeps["integrate"];
    expect(await sweepAutoMerge(deps({ integrate, discardWorktree, deleteBranch }), NOW)).toBe(1);
    expect(discardWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/merge-spec-1");
    expect(deleteBranch).not.toHaveBeenCalled();
    const n = await marker();
    expect(n!.title).toMatch(/konflik/i);
    expect(n!.title).toMatch(/branch kerja/i);
  });

  it("error → notifikasi memuat pesan galat apa adanya", async () => {
    await seed({ projectPolicy: POLICY });
    const integrate = (async () => ({
      status: "error", code: 409, error: "push origin main ditolak — target maju di origin, fetch dulu",
    })) as AutoMergeDeps["integrate"];
    await sweepAutoMerge(deps({ integrate }), NOW);
    expect((await marker())!.title).toMatch(/target maju di origin/);
  });

  it("project tanpa repoDir → dilewati dengan suara, tanpa menyentuh git", async () => {
    await seed({ projectPolicy: POLICY });
    const integrate = vi.fn();
    await sweepAutoMerge(deps({ repoDir: async () => null, integrate: integrate as never }), NOW);
    expect(integrate).not.toHaveBeenCalled();
    expect((await marker())!.title).toMatch(/checkout lokal/);
  });

  it("default branch tak terbaca → dilewati dengan suara, bukan menebak main", async () => {
    await seed({ projectPolicy: POLICY });
    const integrate = vi.fn();
    await sweepAutoMerge(deps({ defaultBranch: async () => null, integrate: integrate as never }), NOW);
    expect(integrate).not.toHaveBeenCalled();
    expect((await marker())!.title).toMatch(/default branch/i);
  });

  it("satu spec yang meledak tak menghentikan sisanya", async () => {
    await seed({ projectPolicy: POLICY });
    await prisma.spec.create({
      data: { id: "SPEC-2", projectId: "p", title: "Kedua", source: "brief", stage: "done",
        priority: "sedang", author: "a", objective: "", headSha: "bbb" },
    });
    await prisma.notification.create({
      data: { type: "done", key: "done:SPEC-2", specId: "SPEC-2", projectId: "p",
        title: "Kedua", createdAt: ago(60_000) },
    });
    const integrate = (async (_r: string, specId: string) => {
      if (specId === "SPEC-1") throw new Error("git meledak");
      return { status: "clean", detail: "ok" };
    }) as AutoMergeDeps["integrate"];
    await sweepAutoMerge(deps({ integrate }), NOW);
    expect(await prisma.notification.findUnique({ where: { key: "automerge:SPEC-2" } })).not.toBeNull();
  });
});
