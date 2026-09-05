import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import {
  trashDirOf, releaseWorktree, releaseWorktreeToTrash, listCleanups, sweepRepo, __resetReaper,
  type ReaperDeps,
} from "../src/services/worktree-reaper";
import { resetDb } from "./factory";

// SPEC-742 · ADR-0116 · penyapu latar. Domainnya `<repoDir>/.worktrees/.trash/**` dan HANYA itu:
// path hidup lepas dari jangkauannya secara konstruksi, dan itulah yang membuat penutupan sesi
// yang tumpang tindih (dan sesi baru yang lahir selagi penyapuan jalan) aman tanpa penguncian.

function repoWithTrash(...entries: string[]): string {
  const repo = mkdtempSync(join(tmpdir(), "hanoman-reaper-"));
  for (const e of entries) {
    const dir = join(trashDirOf(repo), e);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "berkas.txt"), "sampah");
  }
  return repo;
}

const trashNames = (repo: string): string[] => {
  try { return readdirSync(trashDirOf(repo)); } catch { return []; }
};

// Deps produksi dipakai apa adanya kecuali yang sedang diuji; `prune` di-stub supaya test tak
// menuntut repo git sungguhan (yang bukan bagian dari kontrak penyapu).
const deps = (over: Partial<ReaperDeps> = {}): ReaperDeps => ({
  rm: async (p) => { const { rm } = await import("node:fs/promises"); await rm(p, { recursive: true, force: true }); },
  prune: async () => {},
  repos: async () => [],
  ...over,
});

beforeEach(async () => { await resetDb(); __resetReaper(); });

it("pelepasan ketat mempertahankan worktree bila rename gagal", () => {
  const repo = repoWithTrash();
  const cwd = join(repo, ".worktrees", "spec-1");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "kerja.txt"), "belum disimpan");
  expect(() => releaseWorktreeToTrash(repo, cwd, "p1", deps({
    trash: () => { throw new Error("EXDEV"); },
  }))).toThrow("EXDEV");
  expect(existsSync(join(cwd, "kerja.txt"))).toBe(true);
});

describe("sweepRepo", () => {
  it("mengosongkan .trash dan melaporkan jumlah yang terhapus", async () => {
    const repo = repoWithTrash("spec-1.a", "spec-2.b");
    expect(await sweepRepo(repo, "p1", deps())).toBe(2);
    expect(trashNames(repo)).toEqual([]);
  });

  it("repo tanpa .trash = no-op, tak melempar", async () => {
    const repo = mkdtempSync(join(tmpdir(), "hanoman-reaper-kosong-"));
    expect(await sweepRepo(repo, "p1", deps())).toBe(0);
  });

  // Inti gerbang keselamatannya: apa pun di luar .trash tak boleh tersentuh.
  it("tak pernah menyentuh apa pun di luar .trash", async () => {
    const repo = repoWithTrash("spec-1.a");
    const hidup = join(repo, ".worktrees", "spec-hidup");
    mkdirSync(hidup, { recursive: true });
    writeFileSync(join(hidup, "PENANDA.txt"), "sedang dipakai");
    const fase = join(repo, ".worktrees", ".phases");
    mkdirSync(fase, { recursive: true });
    writeFileSync(join(fase, "spec-hidup"), "Brainstorm done\n");

    await sweepRepo(repo, "p1", deps());

    expect(existsSync(join(hidup, "PENANDA.txt"))).toBe(true);
    expect(existsSync(join(fase, "spec-hidup"))).toBe(true);
  });

  it("prune dijalankan sekali per repo, bukan per entri", async () => {
    const repo = repoWithTrash("a.1", "b.2", "c.3");
    let pruned = 0;
    await sweepRepo(repo, "p1", deps({ prune: async () => { pruned++; } }));
    expect(pruned).toBe(1);
  });
});

describe("kegagalan pembersihan tidak hilang senyap", () => {
  const gagal = () => deps({ rm: async () => { throw new Error("EACCES disk"); } });

  it("melahirkan notifikasi, MEMPERTAHANKAN entri, dan mencoba lagi di sapuan berikutnya", async () => {
    const repo = repoWithTrash("spec-742.zz");
    expect(await sweepRepo(repo, "p1", gagal())).toBe(0);

    const notif = await prisma.notification.findMany({ where: { type: "cleanup" } });
    expect(notif).toHaveLength(1);
    expect(notif[0]).toMatchObject({
      key: "cleanup:spec-742.zz",
      title: expect.stringContaining("spec-742"),
    });
    expect(trashNames(repo)).toEqual(["spec-742.zz"]);          // tetap ada → bisa disapu ulang

    expect(await sweepRepo(repo, "p1", deps())).toBe(1);        // percobaan kedua berhasil
    expect(trashNames(repo)).toEqual([]);
  });

  it("tak melipatgandakan notifikasi untuk entri yang sama", async () => {
    const repo = repoWithTrash("spec-742.zz");
    await sweepRepo(repo, "p1", gagal());
    await sweepRepo(repo, "p1", gagal());
    expect(await prisma.notification.count({ where: { type: "cleanup" } })).toBe(1);
  });

  it("entri yang gagal muncul sebagai `failed` di daftar pembersihan", async () => {
    const repo = repoWithTrash("spec-742.zz");
    await sweepRepo(repo, "p1", gagal());
    expect(listCleanups()).toEqual([expect.objectContaining({
      sessionId: "spec-742", projectId: "p1", state: "failed",
      error: expect.stringContaining("EACCES"),
    })]);
  });
});

describe("listCleanups", () => {
  it("mencatat entri yang baru dilepas sebagai `closing`", () => {
    const repo = repoWithTrash();
    const wt = join(repo, ".worktrees", "spec-9");
    mkdirSync(wt, { recursive: true });
    const entry = releaseWorktree(repo, wt, "p1", deps({ rm: async () => { throw new Error("tahan"); } }));
    expect(entry).toMatch(/^spec-9\./);
    expect(listCleanups()).toEqual([
      expect.objectContaining({ sessionId: "spec-9", projectId: "p1", entry, state: "closing" }),
    ]);
  });

  // Jalur pasca-restart: peta memori kosong, dan satu-satunya yang tahu adalah disk. Id sesinya
  // dipulihkan dari nama entri (gotcha 5 ADR-0116).
  it("memulihkan entri dari disk tanpa noteTrashed, id sesi dari nama entri", async () => {
    const repo = repoWithTrash("merge-spec-7.bb");
    await sweepRepo(repo, "p2", deps({ rm: async () => { throw new Error("sibuk"); } }));
    expect(listCleanups()).toEqual([
      expect.objectContaining({ sessionId: "merge-spec-7", projectId: "p2", state: "failed" }),
    ]);
  });

  it("kosong sesudah entri benar-benar terhapus", async () => {
    const repo = repoWithTrash("spec-9.aa");
    await sweepRepo(repo, "p1", deps());
    expect(listCleanups()).toEqual([]);
  });

  // Constraint SPEC-742: penutupan dua sesi BERBEDA yang tumpang tindih harus aman berbarengan.
  // Amannya struktural — tiap pelepasan mendapat entri sendiri, dan penyapu tak pernah menyentuh
  // path hidup — jadi yang diuji di sini bahwa kedua entri hidup berdampingan lalu keduanya hilang.
  it("dua sesi yang ditutup berbarengan tak saling menimpa", async () => {
    const repo = repoWithTrash();
    const tahan = deps({ rm: async () => { throw new Error("tahan"); } });
    for (const id of ["spec-1", "spec-2"]) {
      const wt = join(repo, ".worktrees", id);
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, `${id}.txt`), id);
      releaseWorktree(repo, wt, "p1", tahan);
    }
    expect(listCleanups().map((c) => c.sessionId).sort()).toEqual(["spec-1", "spec-2"]);
    expect(trashNames(repo)).toHaveLength(2);

    expect(await sweepRepo(repo, "p1", deps())).toBe(2);
    expect(listCleanups()).toEqual([]);
  });
});
