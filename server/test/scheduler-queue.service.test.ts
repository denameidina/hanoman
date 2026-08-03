import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueue, listQueue, queued, markLaunched, markFailed, queueItemForSpec,
  markCanceled, markRequeued, isQueued } from "../src/services/scheduler/queue";

const clean = () => prisma.schedulerQueueItem.deleteMany();
beforeEach(clean); afterAll(clean);

describe("scheduler queue", () => {
  it("enqueue is idempotent on specId (no duplicate rows)", async () => {
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "sedang" });
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "sedang" });
    expect((await listQueue()).length).toBe(1);
  });
  it("is durable: rows persist and re-read from DB", async () => {
    await enqueue({ specId: "SPEC-2", projectId: "p1", source: "errors", priority: "tinggi" });
    const again = await prisma.schedulerQueueItem.findUnique({ where: { specId: "SPEC-2" } });
    expect(again!.status).toBe("queued");
  });
  it("queued() orders by priority tinggi→sedang→rendah then FIFO", async () => {
    await enqueue({ specId: "SPEC-lo", projectId: "p1", source: "backlog", priority: "rendah" });
    await enqueue({ specId: "SPEC-hi", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-md", projectId: "p1", source: "backlog", priority: "sedang" });
    expect((await queued()).map((q) => q.specId)).toEqual(["SPEC-hi", "SPEC-md", "SPEC-lo"]);
  });
  it("markLaunched / markFailed move the item out of queued()", async () => {
    await enqueue({ specId: "SPEC-3", projectId: "p1", source: "triase", priority: "sedang" });
    const it0 = (await listQueue())[0]!;
    await markLaunched(it0.id, "spec_3");
    expect((await queued()).length).toBe(0);
    expect((await queueItemForSpec("SPEC-3"))!.status).toBe("launched");
    expect((await queueItemForSpec("SPEC-3"))!.sessionId).toBe("spec_3");
    // failed juga keluar dari queued()
    await enqueue({ specId: "SPEC-4", projectId: "p1", source: "backlog", priority: "sedang" });
    const it1 = (await listQueue()).find((x) => x.specId === "SPEC-4")!;
    await markFailed(it1.id, "needs-bind");
    expect((await queueItemForSpec("SPEC-4"))!.status).toBe("failed");
    expect((await queueItemForSpec("SPEC-4"))!.note).toBe("needs-bind");
  });

  // SPEC-522 · pembatalan adalah CAS, bukan baca-lalu-tulis: antara membaca baris dan menulisnya
  // governor bisa meluncurkannya, dan janji "item bersesi aktif tak dibatalkan" akan jadi sekadar
  // niat baik. Buktinya = penolakan atas baris non-`queued`, bukan bentuk baris hasil.
  it("markCanceled hanya menerima baris queued", async () => {
    await enqueue({ specId: "SPEC-c1", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-c1"))!;
    expect(await markCanceled(row.id, "dibatalkan operator")).toBe(true);
    expect((await queueItemForSpec("SPEC-c1"))!.status).toBe("canceled");
    expect((await queueItemForSpec("SPEC-c1"))!.note).toBe("dibatalkan operator");
    // dua kali → CAS kedua gagal (idempotensi terbaca, bukan diam-diam menulis ulang)
    expect(await markCanceled(row.id, "lagi")).toBe(false);
    expect((await queueItemForSpec("SPEC-c1"))!.note).toBe("dibatalkan operator");
  });

  it("markCanceled MENOLAK baris launched — sesi hidup tak pernah tersentuh pembatalan", async () => {
    await enqueue({ specId: "SPEC-c2", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-c2"))!;
    await markLaunched(row.id, "spec_c2");
    expect(await markCanceled(row.id, "dibatalkan operator")).toBe(false);
    expect((await queueItemForSpec("SPEC-c2"))!.status).toBe("launched");
    expect((await queueItemForSpec("SPEC-c2"))!.sessionId).toBe("spec_c2");
  });

  it("markLaunched adalah CAS: baris yang dibatalkan tak bisa ditimpa jadi launched", async () => {
    await enqueue({ specId: "SPEC-c3", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-c3"))!;
    expect(await markCanceled(row.id, "dibatalkan operator")).toBe(true);
    expect(await markLaunched(row.id, "spec_c3")).toBe(false);
    expect((await queueItemForSpec("SPEC-c3"))!.status).toBe("canceled");
    expect((await queueItemForSpec("SPEC-c3"))!.sessionId).toBeNull();
  });

  it("baris canceled keluar dari queued() dan isQueued()", async () => {
    await enqueue({ specId: "SPEC-c4", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-c4"))!;
    expect(await isQueued(row.id)).toBe(true);
    await markCanceled(row.id, "dibatalkan operator");
    expect(await isQueued(row.id)).toBe(false);
    expect((await queued()).length).toBe(0);
    expect(await isQueued("tak-ada")).toBe(false);
  });

  // Inti janji "berhenti dijadwalkan": checker `backlog` memanggil `enqueue` lagi pada cadence
  // berikutnya untuk spec yang sama (ia masih cocok UNSTARTED_SPEC_WHERE). `upsert` ber-`update:{}`
  // yang membuat tombstone-nya menang — kalau baris ini dihapus alih-alih ditandai, pembatalan
  // akan membatalkan dirinya sendiri dalam ≤1 cadence.
  it("enqueue TIDAK menghidupkan kembali baris yang dibatalkan", async () => {
    await enqueue({ specId: "SPEC-c5", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-c5"))!;
    await markCanceled(row.id, "dibatalkan operator");
    await enqueue({ specId: "SPEC-c5", projectId: "p1", source: "backlog", priority: "tinggi" });
    expect((await queueItemForSpec("SPEC-c5"))!.status).toBe("canceled");
    expect((await listQueue()).length).toBe(1);
    expect((await queued()).length).toBe(0);
  });

  it("markRequeued mengembalikan baris canceled ke antrean dan mengosongkan note", async () => {
    await enqueue({ specId: "SPEC-c6", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-c6"))!;
    await markCanceled(row.id, "dibatalkan operator: salah project");
    expect(await markRequeued(row.id)).toBe(true);
    const back = (await queueItemForSpec("SPEC-c6"))!;
    expect(back.status).toBe("queued");
    expect(back.note).toBeNull();
    expect((await queued()).map((q) => q.specId)).toEqual(["SPEC-c6"]);
    // baris yang sudah queued tak bisa di-requeue lagi
    expect(await markRequeued(row.id)).toBe(false);
  });
});
