import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  openEvent, awaitEvent, resolveEvent, closeEvent, pendingBatch, markDelivered, sweepInbox,
  isEventOpen, setEventOpenedHook, listInboxPage, __resetInbox,
} from "../src/services/lead/inbox";

// ADR-0228 · inbox sesi lead.

const payload = { prompt: "p", gate: "detected" as const, leadKind: "answer" as const, options: [], select: null };
const verdict = { decision: "d", reason: "r", refs: [], confidence: "tinggi" as const, action: "none", choice: "", choices: [], missing: [], reply: "" };
beforeEach(async () => { await prisma.leadEvent.deleteMany(); __resetInbox(); });
afterAll(async () => { await prisma.leadEvent.deleteMany(); });

describe("inbox lead", () => {
  it("batch diurutkan prioritas kelas lalu umur, per proyek", async () => {
    await openEvent({ projectId: "p", kind: "pulse", question: "denyut", payload });
    await openEvent({ projectId: "p", kind: "ask", question: "tanya", payload });
    await openEvent({ projectId: "q", kind: "ask", question: "lain", payload });
    expect((await pendingBatch("p")).map((e) => e.question)).toEqual(["tanya", "denyut"]);
  });
  it("penunggu selesai saat event dijawab", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    const w = awaitEvent(e.id, 5000);
    expect(await resolveEvent(e.id, { verdict, evidence: ["a"] })).toBe(true);
    expect(await w).toMatchObject({ status: "answered", evidence: ["a"] });
    expect(await isEventOpen(e.id)).toBe(false);
  });
  it("jawaban ganda kalah; event yang diambil manusia tertutup untuk lead", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    expect(await closeEvent(e.id, "human")).toBe(true);
    expect(await resolveEvent(e.id, { verdict, evidence: [] })).toBe(false);
    expect((await prisma.leadEvent.findUnique({ where: { id: e.id } }))?.status).toBe("human");
  });
  it("penunggu kembali late saat batas waktu, dan barisnya ikut late", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    expect(await awaitEvent(e.id, 50)).toEqual({ status: "late" });
    await new Promise((r) => setTimeout(r, 30));
    expect((await prisma.leadEvent.findUnique({ where: { id: e.id } }))?.status).toBe("late");
  });
  it("penolakan menutup event sebagai done dan memberi tahu penunggu", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    const w = awaitEvent(e.id, 5000);
    await closeEvent(e.id, "rejected");
    expect(await w).toEqual({ status: "rejected" });
    expect((await prisma.leadEvent.findUnique({ where: { id: e.id } }))?.status).toBe("done");
  });
  it("sapuan: tenggat lewat → late; terkirim kelamaan → open lagi dengan attempts naik", async () => {
    const a = await openEvent({ projectId: "p", kind: "ask", question: "a", payload, deadlineMs: Date.now() - 1 });
    const b = await openEvent({ projectId: "p", kind: "pulse", question: "b", payload });
    await markDelivered([b.id]);
    await prisma.leadEvent.update({ where: { id: b.id }, data: { deliveredAt: new Date(Date.now() - 700_000) } });
    expect(await sweepInbox(Date.now(), 600_000)).toEqual({ late: 1, requeued: 1 });
    expect((await prisma.leadEvent.findUnique({ where: { id: a.id } }))?.status).toBe("late");
    expect(await prisma.leadEvent.findUnique({ where: { id: b.id } })).toMatchObject({ status: "open", attempts: 1 });
  });
  it("event terkirim tak ikut batch berikutnya", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    await markDelivered([e.id]);
    expect(await pendingBatch("p")).toEqual([]);
  });
  it("membangunkan kurir saat event dibuka", async () => {
    const seen: string[] = [];
    setEventOpenedHook((p) => seen.push(p));
    await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    expect(seen).toEqual(["p"]);
  });
  it("halaman inbox berpaginasi dan tersaring", async () => {
    for (let i = 0; i < 3; i++) await openEvent({ projectId: "p", kind: "ask", question: `q${i}`, payload });
    await openEvent({ projectId: "q", kind: "ask", question: "lain", payload });
    const page = await listInboxPage({ projectId: "p", limit: "2" });
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(page.items).toHaveLength(2);
  });
});
