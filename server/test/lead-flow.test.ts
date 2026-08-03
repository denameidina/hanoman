import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import {
  openFlow, joinFlow, markFlowStep, closeFlow, expireFlows, listFlows, toFlowView,
  LeadFlowClosedError,
} from "../src/services/lead/flow";

// SPEC-485 · ADR-0102 · alur adalah entitas, bukan kebetulan. Yang diuji di sini adalah keempat
// keadaannya dan satu aturan yang jadi seluruh alasan model ini ada: rantai yang sudah ditutup
// TIDAK menerima langkah baru.

const base = { projectId: "p485", gate: "contract" as const, title: "Pertanyaan pertama", ttlMin: 60 };

beforeEach(async () => { await prisma.leadFlow.deleteMany({ where: { projectId: "p485" } }); });

describe("SPEC-485 · ADR-0102 · daur hidup rantai keputusan", () => {
  it("alur baru lahir `menunggu` dengan expiresAt di depan", async () => {
    const f = await openFlow(base);
    expect(f.status).toBe("menunggu");
    expect(f.steps).toBe(0);
    expect(f.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("langkah yang terjawab memindahkannya ke `sebagian`; yang gagal tidak", async () => {
    const f = await openFlow(base);
    await markFlowStep(f.id, false);
    expect((await prisma.leadFlow.findUnique({ where: { id: f.id } }))!.status).toBe("menunggu");
    await markFlowStep(f.id, true);
    const after = (await prisma.leadFlow.findUnique({ where: { id: f.id } }))!;
    expect(after.status).toBe("sebagian");
    expect(after.steps).toBe(2);
  });

  it("alur tertutup MENOLAK langkah baru (batasan: tak bisa menyisipkan ke rantai ter-submit)", async () => {
    const f = await openFlow(base);
    await closeFlow(f.id, "submit");
    await expect(joinFlow(f.id)).rejects.toBeInstanceOf(LeadFlowClosedError);
  });

  it("alur yang tak ada juga ditolak, bukan dibuatkan diam-diam", async () => {
    await expect(joinFlow("tak-ada")).rejects.toBeInstanceOf(LeadFlowClosedError);
  });

  it("menutup dua kali tak mengubah alasan penutupan pertama", async () => {
    const f = await openFlow(base);
    await closeFlow(f.id, "submit");
    expect(await closeFlow(f.id, "operator")).toBeNull();
    expect((await prisma.leadFlow.findUnique({ where: { id: f.id } }))!.closeReason).toBe("submit");
  });

  it("expireFlows menutup yang lewat batas & TIDAK menyentuh yang sudah tertutup", async () => {
    const stale = await openFlow({ ...base, ttlMin: 60 });
    await prisma.leadFlow.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const closed = await openFlow(base);
    await closeFlow(closed.id, "submit");
    await prisma.leadFlow.update({ where: { id: closed.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const out = await expireFlows(new Date());
    expect(out.map((f) => f.id)).toEqual([stale.id]);
    expect((await prisma.leadFlow.findUnique({ where: { id: stale.id } }))!.status).toBe("dibatalkan");
    expect((await prisma.leadFlow.findUnique({ where: { id: closed.id } }))!.closeReason).toBe("submit");
  });

  it("listFlows menyaring per project & status, terbaru dulu", async () => {
    const a = await openFlow(base);
    const b = await openFlow(base);
    await closeFlow(b.id, "submit");
    // SPEC-523 · listFlows kini beramplop: barisnya di `.rows`, `total` di sampingnya.
    expect((await listFlows({ projectId: "p485", status: "selesai" })).rows.map((f) => f.id)).toEqual([b.id]);
    expect((await listFlows({ projectId: "p485" })).rows.map((f) => f.id)).toContain(a.id);
  });

  it("toFlowView memancarkan tanggal sebagai string ISO", async () => {
    const v = toFlowView(await openFlow(base));
    expect(typeof v.openedAt).toBe("string");
    expect(v.closedAt).toBeNull();
    expect(v.status).toBe("menunggu");
  });
});
