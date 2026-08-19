import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, existsSync, chmodSync, writeFileSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import {
  beginSession, finishSession, listHistory, getHistory, transcriptOf, purgeHistory, reconcileHistory,
  reconcileTranscripts,
} from "../src/services/session-history";
import { transcriptDir } from "../src/services/transcript-store";

const clean = () => prisma.sessionHistory.deleteMany();
beforeEach(async () => {
  process.env.HANOMAN_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), "hanoman-th-"));
  await clean();
});
afterAll(async () => { await clean(); delete process.env.HANOMAN_TRANSCRIPT_DIR; });

const birth = (over: Partial<Parameters<typeof beginSession>[0]> = {}) => ({
  sessionId: "spec-362", projectId: "p1", specId: "SPEC-362", flow: "feature",
  kind: "spec" as const, agent: "claude" as const, model: "claude-opus-5", effort: "xhigh",
  branch: undefined, cwd: "/repo/.worktrees/spec-362", ...over,
});

describe("session-history service (SPEC-362)", () => {
  it("beginSession menulis baris yang langsung terbaca sebagai 'berjalan'", async () => {
    await beginSession(birth());
    const { items, total } = await listHistory({});
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ sessionId: "spec-362", specId: "SPEC-362", kind: "spec", endedAt: null });
  });

  it("sessionId yang sama dua kali menghasilkan DUA baris — reopen tak menimpa riwayat", async () => {
    await beginSession(birth());
    await finishSession({ sessionId: "spec-362", exitCode: 0, transcript: "sesi pertama" });
    await beginSession(birth());
    const { total } = await listHistory({});
    expect(total).toBe(2);
  });

  it("finishSession mengisi baris BERJALAN terbaru, bukan yang sudah selesai", async () => {
    await beginSession(birth());
    await finishSession({ sessionId: "spec-362", exitCode: 0, transcript: "pertama" });
    await beginSession(birth());
    await finishSession({ sessionId: "spec-362", exitCode: 2, transcript: "kedua" });
    const { items } = await listHistory({});
    expect(items.map((r) => r.exitCode)).toEqual([2, 0]); // urut startedAt desc
    expect(items.every((r) => r.endedAt !== null)).toBe(true);
  });

  it("transkrip tersimpan sebagai berkas & terbaca lewat transcriptOf", async () => {
    await beginSession(birth());
    await finishSession({ sessionId: "spec-362", exitCode: 0, transcript: "isi transkrip" });
    const { items } = await listHistory({});
    const row = await getHistory(items[0]!.id);
    expect(row?.hasTranscript).toBe(true);
    expect((await transcriptOf(items[0]!.id))?.text).toBe("isi transkrip");
  });

  it("tanpa transkrip → hasTranscript false, transcriptOf null", async () => {
    await beginSession(birth({ sessionId: "kosong" }));
    await finishSession({ sessionId: "kosong", exitCode: 0, transcript: null });
    const { items } = await listHistory({});
    expect((await getHistory(items[0]!.id))?.hasTranscript).toBe(false);
    expect(await transcriptOf(items[0]!.id)).toBeNull();
  });

  it("finishSession untuk sessionId tanpa baris berjalan = no-op (tak melempar)", async () => {
    await finishSession({ sessionId: "hantu", exitCode: 0, transcript: "x" });
    expect((await listHistory({})).total).toBe(0);
  });

  it("paginasi memotong respons & melaporkan total penuh", async () => {
    for (let i = 0; i < 5; i++) await beginSession(birth({ sessionId: `s${i}`, specId: `SPEC-${i}` }));
    const p1 = await listHistory({ page: "1", limit: "2" });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.pageSize).toBe(2);
    const p3 = await listHistory({ page: "3", limit: "2" });
    expect(p3.items).toHaveLength(1);
  });

  it("filter projectId/specId/kind/q", async () => {
    await beginSession(birth({ sessionId: "a", projectId: "p1", specId: "SPEC-1", kind: "spec" }));
    await beginSession(birth({ sessionId: "b", projectId: "p2", specId: undefined, kind: "shell" }));
    expect((await listHistory({ projectId: "p2" })).total).toBe(1);
    expect((await listHistory({ specId: "SPEC-1" })).total).toBe(1);
    expect((await listHistory({ kind: "shell" })).total).toBe(1);
    expect((await listHistory({ q: "SPEC-1" })).total).toBe(1);
    expect((await listHistory({ q: "tidak-ada" })).total).toBe(0);
  });

  it("reconcileHistory menutup baris berjalan yang panenya sudah lenyap, membiarkan yang hidup", async () => {
    await beginSession(birth({ sessionId: "hidup" }));
    await beginSession(birth({ sessionId: "mati" }));
    const closed = await reconcileHistory(["hidup"]);
    expect(closed).toBe(1);
    const { items } = await listHistory({});
    const byId = Object.fromEntries(items.map((r) => [r.sessionId, r]));
    expect(byId["mati"]!.endedAt).not.toBeNull();
    expect(byId["hidup"]!.endedAt).toBeNull();
  });

  // SPEC-844 · ADR-0125 · dua jalur tutup yang dulu tak terbedakan.
  it("finishSession menandai baris `closed` dan TIDAK menyentuh reconciledAt", async () => {
    await beginSession(birth({ sessionId: "tutup" }));
    await finishSession({ sessionId: "tutup", exitCode: null, transcript: null });
    const { items } = await listHistory({ q: "tutup" });
    expect(items[0]).toMatchObject({ endedReason: "closed", reconciledAt: null });
  });

  it("reconcileHistory menandai `reconciled`, menstempel reconciledAt, dan endedAt tetap batas BAWAH", async () => {
    await beginSession(birth({ sessionId: "zombie" }));
    const born = await prisma.sessionHistory.findFirstOrThrow({ where: { sessionId: "zombie" } });
    const before = Date.now();
    expect(await reconcileHistory([])).toBe(1);
    const row = await prisma.sessionHistory.findUniqueOrThrow({ where: { id: born.id } });
    expect(row.endedReason).toBe("reconciled");
    // endedAt = updatedAt SEBELUM update ini — batas bawah "terakhir diketahui hidup", bukan waktu
    // boot. Memindahkannya ke waktu boot mengarang klaim bahwa sesinya hidup selama downtime.
    expect(row.endedAt?.getTime()).toBe(born.updatedAt.getTime());
    expect(row.reconciledAt).not.toBeNull();
    expect(row.reconciledAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("satu sapuan boot memberi SATU stempel reconciledAt untuk semua barisnya", async () => {
    await beginSession(birth({ sessionId: "z1" }));
    await beginSession(birth({ sessionId: "z2" }));
    expect(await reconcileHistory([])).toBe(2);
    const rows = await prisma.sessionHistory.findMany({ where: { sessionId: { in: ["z1", "z2"] } } });
    expect(new Set(rows.map((r) => r.reconciledAt!.getTime())).size).toBe(1);
  });

  it("purge menghapus baris ber-scope dan berkas transkripnya", async () => {
    await beginSession(birth({ sessionId: "x", projectId: "p9" }));
    await finishSession({ sessionId: "x", exitCode: 0, transcript: "akan dihapus" });
    const { items } = await listHistory({ projectId: "p9" });
    const id = items[0]!.id;
    expect(await purgeHistory({ projectId: "p9" }))
      .toMatchObject({ purged: 1, transcriptsDeleted: 1, transcriptsFailed: 0 });
    expect((await listHistory({ projectId: "p9" })).total).toBe(0);
    expect(await transcriptOf(id)).toBeNull();
  });
});

// SPEC-845 · ADR-0126 · urutan penghapusan purge. Bukti transkrip tak boleh hancur untuk baris yang
// SELAMAT; sisa yang boleh ada hanyalah berkas yatim, karena hanya ia yang bisa dipulihkan.
describe("durabilitas purge (SPEC-845)", () => {
  const seed = async (sessionId: string, transcript: string) => {
    await beginSession({ sessionId, projectId: "p9", kind: "shell", agent: "claude", cwd: "/r" });
    await finishSession({ sessionId, exitCode: 0, transcript });
  };

  it("deleteMany yang melempar tak menghancurkan transkrip baris yang selamat", async () => {
    await seed("x", "BUKTI-INSIDEN");
    const id = (await listHistory({ projectId: "p9" })).items[0]!.id;

    const asli = prisma.sessionHistory.deleteMany;
    (prisma.sessionHistory as unknown as Record<string, unknown>).deleteMany = async () => {
      throw new Error("SQLITE_BUSY");
    };
    try {
      await expect(purgeHistory({ projectId: "p9" })).rejects.toThrow("SQLITE_BUSY");
    } finally {
      (prisma.sessionHistory as unknown as Record<string, unknown>).deleteMany = asli;
    }

    expect((await listHistory({ projectId: "p9" })).total).toBe(1);
    expect((await getHistory(id))?.hasTranscript).toBe(true);
    expect((await transcriptOf(id))?.text).toBe("BUKTI-INSIDEN");
  });

  it("berkas yang gagal dihapus dilaporkan, tanpa menahan penghapusan barisnya", async () => {
    await seed("y", "isi");
    chmodSync(transcriptDir(), 0o500);  // direktori read-only → unlink EACCES
    try {
      expect(await purgeHistory({ projectId: "p9" }))
        .toMatchObject({ purged: 1, transcriptsDeleted: 0, transcriptsFailed: 1 });
    } finally {
      chmodSync(transcriptDir(), 0o700);
    }
    expect((await listHistory({ projectId: "p9" })).total).toBe(0);
    expect(readdirSync(transcriptDir())).toHaveLength(1);  // yatim — dipungut reconcileTranscripts
  });

  it("purge idempoten: pengulangan mengembalikan nol tanpa melempar", async () => {
    await seed("z", "isi");
    expect((await purgeHistory({ projectId: "p9" })).purged).toBe(1);
    expect(await purgeHistory({ projectId: "p9" }))
      .toMatchObject({ purged: 0, transcriptsDeleted: 0, transcriptsFailed: 0 });
  });

  it("baris yang selesai SESUDAH snapshot tak ikut terhapus — himpunan id eksplisit", async () => {
    await beginSession({ sessionId: "berjalan", projectId: "p9", kind: "shell", agent: "claude", cwd: "/r" });
    const asli = prisma.sessionHistory.deleteMany;
    (prisma.sessionHistory as unknown as Record<string, unknown>).deleteMany = async (args: unknown) => {
      (prisma.sessionHistory as unknown as Record<string, unknown>).deleteMany = asli;
      // Persis yang dilakukan hook onDeath saat sebuah sesi ditutup di jendela ini (ADR-0079 §3).
      await beginSession({ sessionId: "menyusul", projectId: "p9", kind: "shell", agent: "claude", cwd: "/r" });
      await finishSession({ sessionId: "menyusul", exitCode: 0, transcript: "LAHIR-BELAKANGAN" });
      return asli.call(prisma.sessionHistory, args as never);
    };
    await purgeHistory({ projectId: "p9" });

    const { items } = await listHistory({ projectId: "p9" });
    expect(items.map((r) => r.sessionId)).toEqual(["menyusul"]);
    expect((await transcriptOf(items[0]!.id))?.text).toBe("LAHIR-BELAKANGAN");
  });
});

describe("reconcileTranscripts (SPEC-845)", () => {
  const berkasLama = (nama: string) => {
    const path = join(transcriptDir(), nama);
    writeFileSync(path, "sampah");
    const dulu = Date.now() / 1000 - 7200;
    utimesSync(path, dulu, dulu);
    return path;
  };

  it("menyapu berkas yatim yang sudah lewat tenggang", async () => {
    const yatim = berkasLama("yatim.log");
    expect(await reconcileTranscripts()).toMatchObject({ orphans: 1, dangling: 0, failed: 0 });
    expect(existsSync(yatim)).toBe(false);
  });

  it("membiarkan berkas yang masih dirujuk sebuah baris, setua apa pun", async () => {
    await beginSession({ sessionId: "hidup", projectId: "p1", kind: "shell", agent: "claude", cwd: "/r" });
    await finishSession({ sessionId: "hidup", exitCode: 0, transcript: "masih dipakai" });
    const id = (await listHistory({})).items[0]!.id;
    const key = (await prisma.sessionHistory.findUnique({ where: { id } }))!.transcriptKey!;
    const dulu = Date.now() / 1000 - 7200;
    utimesSync(join(transcriptDir(), key), dulu, dulu);

    expect(await reconcileTranscripts()).toMatchObject({ orphans: 0 });
    expect((await transcriptOf(id))?.text).toBe("masih dipakai");
  });

  // saveTranscript menulis berkas SEBELUM finishSession menulis transcriptKey-nya: di antara
  // keduanya ada berkas hidup yang belum dirujuk siapa pun. Menyapu tanpa tenggang = melahirkan
  // kembali cacat yang sedang diperbaiki.
  it("membiarkan berkas yatim yang masih SEGAR — jendela tulis belum ditutup", async () => {
    writeFileSync(join(transcriptDir(), "baru-saja.log"), "baru ditulis");
    expect(await reconcileTranscripts()).toMatchObject({ orphans: 0 });
    expect(existsSync(join(transcriptDir(), "baru-saja.log"))).toBe(true);
  });

  it("mengosongkan transcriptKey yang menunjuk berkas hilang, jadi hasTranscript berhenti berbohong", async () => {
    await beginSession({ sessionId: "menggantung", projectId: "p1", kind: "shell", agent: "claude", cwd: "/r" });
    await finishSession({ sessionId: "menggantung", exitCode: 0, transcript: "akan lenyap" });
    const id = (await listHistory({})).items[0]!.id;
    const key = (await prisma.sessionHistory.findUnique({ where: { id } }))!.transcriptKey!;
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(transcriptDir(), key));
    expect((await getHistory(id))?.hasTranscript).toBe(true);  // berbohong sebelum rekonsiliasi

    expect(await reconcileTranscripts()).toMatchObject({ dangling: 1, orphans: 0 });
    const row = await getHistory(id);
    expect(row?.hasTranscript).toBe(false);
    expect(row?.transcriptBytes).toBeNull();
  });

  it("dryRun melaporkan tanpa menyentuh disk maupun baris", async () => {
    const yatim = berkasLama("yatim.log");
    expect(await reconcileTranscripts({ dryRun: true })).toMatchObject({ orphans: 1 });
    expect(existsSync(yatim)).toBe(true);
  });
});
