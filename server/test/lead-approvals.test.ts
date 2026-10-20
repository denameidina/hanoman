import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { createApproval, decideApproval, expireApprovals, listApprovalsPage } from "../src/services/lead/approvals";
import { openEvent, awaitEvent, __resetInbox } from "../src/services/lead/inbox";
import { postDecision } from "../src/services/lead/post";

// ADR-0228 · antrean izin tindakan lead.

const payload = { prompt: "p", gate: "pulse" as const, leadKind: "quality" as const, options: [], select: null };
const act = (eventId: string, action = "integrate-main") => ({
  eventId, evidence: ["SPEC-1"],
  verdict: { decision: "merge", reason: "hijau", refs: [], confidence: "tinggi" as const, action, choice: "", choices: [], missing: [], reply: "" },
});
const quiet = { notice: async () => {}, push: async () => 0 };
beforeEach(async () => {
  for (const m of [prisma.leadApproval, prisma.leadEvent, prisma.leadDecision, prisma.leadFlow, prisma.notification, prisma.spec, prisma.project, prisma.setting] as { deleteMany: () => Promise<unknown> }[]) await m.deleteMany();
  __resetInbox();
});

describe("izin lead", () => {
  it("disetujui → penunggu event menerima verdict yang ditahan", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload: { ...payload, gate: "detected", leadKind: "answer" }, sessionId: "spec-1" });
    const w = awaitEvent(e.id, 2000);
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id, "answer-session"), report: ["sensitif"], target: "spec-1" }, quiet);
    const v = await decideApproval(id, { approve: true, by: "operator" });
    expect(v).toMatchObject({ status: "approved", decidedBy: "operator", gateReport: ["sensitif"] });
    expect(await w).toMatchObject({ status: "answered" });
  });
  it("disetujui untuk event denyut → tindakannya dieksekusi tanpa penunggu", async () => {
    await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
    await setLead({ ...LEAD_DEFAULTS, enabled: true });
    const e = (await postDecision({ projectId: "demo", gate: "pulse", kind: "quality", question: "Backlog X sudah selesai", options: ["none — biarkan"] }))!;
    const { id } = await createApproval({ eventId: e.id, projectId: "demo", act: act(e.id, "none"), report: [], target: null }, quiet);
    await decideApproval(id, { approve: true, by: "operator" });
    expect((await prisma.leadDecision.findFirst({ where: { eventId: e.id } }))?.status).toBe("berlaku");
  });
  it("ditolak → event ditutup, penunggu diberi tahu, dan lead menerima event `rejected` berisi catatan", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    const w = awaitEvent(e.id, 2000);
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: "spec-1" }, quiet);
    await decideApproval(id, { approve: false, by: "operator", note: "tunggu review" });
    expect(await w).toEqual({ status: "rejected" });
    const rej = await prisma.leadEvent.findFirst({ where: { kind: "rejected" } });
    expect(rej?.question).toContain("menolak");
    expect(JSON.stringify(rej?.payload)).toContain("tunggu review");
  });
  it("keputusan kedua ditolak (idempoten)", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: null }, quiet);
    await decideApproval(id, { approve: true, by: "a" });
    expect(await decideApproval(id, { approve: false, by: "b" })).toBeNull();
  });
  it("disetujui saat event sudah tertutup → tercatat, tak ada yang dijalankan", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: null }, quiet);
    await prisma.leadEvent.update({ where: { id: e.id }, data: { status: "late" } });
    expect((await decideApproval(id, { approve: true, by: "a" }))?.note).toContain("tak ada yang dijalankan");
  });
  it("kedaluwarsa = ditolak, tindakannya tak pernah jalan", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: null }, quiet);
    await prisma.leadApproval.update({ where: { id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect(await expireApprovals(Date.now(), 86_400_000)).toBe(1);
    expect((await prisma.leadApproval.findUnique({ where: { id } }))?.status).toBe("expired");
    expect(await prisma.leadEvent.count({ where: { kind: "rejected" } })).toBe(1);
  });
  it("membuat notifikasi & push Telegram saat izin lahir", async () => {
    const seen: string[] = [];
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: "spec-1" }, {
      notice: async (title) => { seen.push(`notice:${title}`); },
      push: async (p) => { seen.push(`push:${p.id}`); return 1; },
    });
    expect(seen[0]).toContain("Lead minta izin · integrate-main spec-1");
    expect(seen[1]).toMatch(/^push:/);
  });
  it("halaman izin tersaring per status", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: null }, quiet);
    expect((await listApprovalsPage({ status: "pending" })).total).toBe(1);
    expect((await listApprovalsPage({ status: "approved" })).total).toBe(0);
  });
});
