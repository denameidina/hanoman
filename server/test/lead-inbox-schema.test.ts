import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/db";

// ADR-0228 · skema inbox & antrean izin sesi lead.

afterAll(async () => {
  await prisma.leadApproval.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.leadDecision.deleteMany();
});

describe("skema inbox lead (ADR-0228)", () => {
  it("menyimpan event, approval, dan tautan keputusan → event", async () => {
    const e = await prisma.leadEvent.create({ data: {
      projectId: "p", kind: "ask", priority: 0, question: "q", payload: { prompt: "x" },
    } });
    expect(e).toMatchObject({ status: "open", attempts: 0, deliveredAt: null });
    const a = await prisma.leadApproval.create({ data: {
      eventId: e.id, projectId: "p", action: "integrate-main", reason: "r",
      evidence: [], gateReport: [], verdict: {},
    } });
    expect(a.status).toBe("pending");
    const d = await prisma.leadDecision.create({ data: {
      projectId: "p", gate: "pulse", kind: "quality", question: "q", answer: "a", reason: "r",
      refs: [], confidence: "tinggi", eventId: e.id,
    } });
    expect(d.eventId).toBe(e.id);
  });
});
