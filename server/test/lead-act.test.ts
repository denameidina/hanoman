import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { processAct, type ActDeps } from "../src/services/lead/act";
import { openEvent, awaitEvent, __resetInbox } from "../src/services/lead/inbox";

// ADR-0228 · satu-satunya pintu tindakan pane lead.

const payload = { prompt: "p", gate: "detected" as const, leadKind: "answer" as const, options: ["A", "B"], select: null };
const verdict = (over: Record<string, unknown> = {}) => ({
  decision: "A", reason: "r", refs: [], confidence: "tinggi" as const, action: "answer-session",
  choice: "A", choices: [] as string[], missing: [], reply: "", ...over,
});
beforeEach(async () => { await prisma.leadApproval.deleteMany(); await prisma.leadEvent.deleteMany(); __resetInbox(); });

type Rec = { executed: string[]; guarded: (string | null)[]; approvals: number };
const deps = (outcome: "lolos" | "butuh-izin" | "ditolak", over: Partial<ActDeps> = {}): ActDeps & Rec => {
  const rec: Rec = { executed: [], guarded: [], approvals: 0 };
  return {
    ...rec,
    guard: async (i) => { rec.guarded.push(i.specId); return { outcome, report: ["r"], ...(outcome === "ditolak" ? { code: "not-waiting" as const } : {}) }; },
    budget: async () => ({ n: 1, reasons: [] }),
    createApproval: async () => { rec.approvals++; return { id: "ap1" }; },
    execute: async (id) => { rec.executed.push(id); return { applied: { ok: true, detail: "dijalankan" } }; },
    ...over,
  };
};

describe("processAct", () => {
  it("lolos → event selesai dan penunggu menerima verdict", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload, sessionId: "spec-1" });
    const w = awaitEvent(e.id, 2000);
    const r = await processAct("p", { eventId: e.id, verdict: verdict(), evidence: ["x"] }, deps("lolos"));
    expect(r.outcome).toBe("lolos");
    expect(await w).toMatchObject({ status: "answered", evidence: ["x"] });
  });
  it("butuh-izin → izin dibuat, event tetap terbuka", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    const d = deps("butuh-izin");
    const r = await processAct("p", { eventId: e.id, verdict: verdict(), evidence: [] }, d);
    expect(r).toMatchObject({ outcome: "butuh-izin", approvalId: "ap1" });
    expect((await prisma.leadEvent.findUnique({ where: { id: e.id } }))?.status).toBe("open");
  });
  it("ditolak → kode dikembalikan, event tetap terbuka", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    const r = await processAct("p", { eventId: e.id, verdict: verdict(), evidence: [] }, deps("ditolak"));
    expect(r).toMatchObject({ outcome: "ditolak", code: "not-waiting" });
    expect((await prisma.leadEvent.findUnique({ where: { id: e.id } }))?.status).toBe("open");
  });
  it("event proyek lain → ditolak event-closed", async () => {
    const e = await openEvent({ projectId: "q", kind: "ask", question: "q", payload });
    expect((await processAct("p", { eventId: e.id, verdict: verdict(), evidence: [] }, deps("lolos"))).code).toBe("event-closed");
  });
  it("event mode post (dengan request) dieksekusi langsung oleh act", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload: { ...payload, mode: "post", request: { req: {} } } });
    const d = deps("lolos");
    const r = await processAct("p", { eventId: e.id, verdict: verdict({ action: "none" }), evidence: [] }, d);
    expect(r).toMatchObject({ outcome: "lolos", detail: "dijalankan" });
    expect(d.executed).toEqual([e.id]);
  });
  it("event `rejected` (post tanpa request) cukup ditutup, tak dieksekusi", async () => {
    const e = await openEvent({ projectId: "p", kind: "rejected", question: "q", payload: { ...payload, mode: "post" } });
    const d = deps("lolos");
    expect((await processAct("p", { eventId: e.id, verdict: verdict({ action: "none" }), evidence: [] }, d)).outcome).toBe("lolos");
    expect(d.executed).toEqual([]);
  });

  describe("ambil backlog", () => {
    const pulse = () => openEvent({ projectId: "p", kind: "pulse", question: "Jatah 1", payload: { ...payload, gate: "pulse", leadKind: "order", mode: "post", request: {} } });
    it("memilih melebihi jatah → budget-zero tanpa memanggil guard", async () => {
      const e = await pulse();
      const d = deps("lolos");
      const r = await processAct("p", { eventId: e.id, verdict: verdict({ action: "start-session", choices: ["SPEC-1 · a", "SPEC-2 · b"] }), evidence: ["SPEC-1", "SPEC-2"] }, d);
      expect(r).toMatchObject({ outcome: "ditolak", code: "budget-zero" });
      expect(r.detail).toContain("melebihi jatah 1");
      expect(d.guarded).toEqual([]);
    });
    it("tiap pilihan digerbangi sendiri — satu ditolak, semuanya ditolak", async () => {
      const e = await pulse();
      const d = deps("lolos", {
        budget: async () => ({ n: 2, reasons: [] }),
        guard: async (i) => (i.specId === "SPEC-2" ? { outcome: "ditolak", code: "blocked", report: ["SPEC-2 menunggu SPEC-0"] } : { outcome: "lolos", report: [] }),
      });
      const r = await processAct("p", { eventId: e.id, verdict: verdict({ action: "start-session", choices: ["SPEC-1 · a", "SPEC-2 · b"] }), evidence: ["SPEC-1", "SPEC-2"] }, d);
      expect(r).toMatchObject({ outcome: "ditolak", code: "blocked" });
      expect(d.executed).toEqual([]);
    });
    it("tanpa pilihan → spec-empty", async () => {
      const e = await pulse();
      expect((await processAct("p", { eventId: e.id, verdict: verdict({ action: "start-session", choice: "" }), evidence: [] }, deps("lolos"))).code).toBe("spec-empty");
    });
  });
});
