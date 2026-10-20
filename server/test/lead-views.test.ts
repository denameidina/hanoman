import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, zLeadStatusView } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { buildLeadStatus } from "../src/services/lead/views";
import { openEvent, __resetInbox } from "../src/services/lead/inbox";
import { createApproval } from "../src/services/lead/approvals";

// ADR-0228 · status lead membawa inbox, izin, dan pane lead — sumber topik siar `lead`.

vi.mock("../src/services/pty", async (orig) => ({
  ...(await orig<typeof import("../src/services/pty")>()),
  listSessionsAsync: vi.fn(async () => []),
  getSessionAsync: vi.fn(async () => undefined),
}));

const payload = { prompt: "p", gate: "pulse" as const, leadKind: "quality" as const, options: [], select: null };
beforeEach(async () => {
  for (const m of [prisma.leadApproval, prisma.leadEvent, prisma.project, prisma.setting] as { deleteMany: () => Promise<unknown> }[]) await m.deleteMany();
  __resetInbox();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
  await setLead({ ...LEAD_DEFAULTS, enabled: true });
});

describe("buildLeadStatus · sesi lead (ADR-0228)", () => {
  it("memuat event terbuka & izin menunggu, bukan yang sudah selesai", async () => {
    const open = await openEvent({ projectId: "demo", kind: "ask", question: "terbuka", payload });
    const done = await openEvent({ projectId: "demo", kind: "ask", question: "selesai", payload });
    await prisma.leadEvent.update({ where: { id: done.id }, data: { status: "done", closedAt: new Date() } });
    await createApproval({ eventId: open.id, projectId: "demo", target: null, report: ["r"],
      act: { eventId: open.id, evidence: [], verdict: { decision: "d", reason: "r", refs: [], confidence: "tinggi", action: "none", choice: "", choices: [], missing: [], reply: "" } } },
      { notice: async () => {}, push: async () => 0 });
    const s = await buildLeadStatus();
    expect(s.inbox.map((e) => e.question)).toEqual(["terbuka"]);
    expect(s.approvals).toHaveLength(1);
    expect(s.sessions).toEqual([expect.objectContaining({ projectId: "demo", sessionId: "lead-demo", alive: false })]);
    expect(zLeadStatusView.safeParse(s).success).toBe(true);
  });
  it("menampilkan event yang terlambat 24 jam terakhir", async () => {
    const late = await openEvent({ projectId: "demo", kind: "ask", question: "telat", payload });
    await prisma.leadEvent.update({ where: { id: late.id }, data: { status: "late", closedAt: new Date() } });
    expect((await buildLeadStatus()).inbox.map((e) => e.status)).toEqual(["late"]);
  });
  it("klien lama tanpa field baru tetap ter-parse (default [])", () => {
    const parsed = zLeadStatusView.parse({ config: LEAD_DEFAULTS, projects: [], queue: [], deciding: [], waiting: [], lastPulseAt: null });
    expect(parsed).toMatchObject({ inbox: [], approvals: [], sessions: [] });
  });
});
