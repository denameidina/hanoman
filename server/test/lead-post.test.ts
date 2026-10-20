import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { postDecision, executeEventVerdict, hasOpenPosted, specIdOfOption } from "../src/services/lead/post";
import { __resetInbox } from "../src/services/lead/inbox";

// ADR-0228 · event denyut tanpa penunggu — dieksekusi saat act/izin.

const v = (over: Record<string, unknown> = {}) => ({
  decision: "d", reason: "r", refs: [], confidence: "tinggi" as const, action: "none",
  choice: "", choices: [] as string[], missing: [], reply: "", ...over,
});
beforeEach(async () => {
  await prisma.leadEvent.deleteMany(); await prisma.leadDecision.deleteMany(); await prisma.leadFlow.deleteMany();
  await prisma.schedulerQueueItem.deleteMany(); await prisma.notification.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.setting.deleteMany();
  __resetInbox();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
  for (const id of ["SPEC-2", "SPEC-3"]) {
    await prisma.spec.create({ data: { id, projectId: "demo", title: "t", source: "brief", stage: "spec-ready", priority: "tinggi", author: "t", objective: "o" } });
  }
  await setLead({ ...LEAD_DEFAULTS, enabled: true });
});

const order = () => postDecision({
  projectId: "demo", gate: "pulse", kind: "order", question: "Jatah 1. Pilih backlog",
  options: ["SPEC-2 · [tinggi] t", "SPEC-3 · [tinggi] t"], select: { mode: "multi", min: 0, max: 1 },
});

describe("event tanpa penunggu", () => {
  it("postDecision langsung kembali dengan event mode post", async () => {
    const e = await order();
    expect(e?.kind).toBe("pulse");
    expect((e?.payload as { mode: string }).mode).toBe("post");
    expect(await hasOpenPosted("demo", "Jatah 1")).toBe(true);
    expect(await hasOpenPosted("demo", "Lain")).toBe(false);
  });
  it("lead tak aktif → null", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: false });
    expect(await order()).toBeNull();
  });
  it("eksekusi start-session mengantrekan HANYA pilihan lead", async () => {
    const e = (await order())!;
    const r = await executeEventVerdict(e.id, v({ action: "start-session", choices: ["SPEC-2 · [tinggi] t"] }));
    expect(r.row.status).toBe("berlaku");
    expect(r.row.eventId).toBe(e.id);
    expect((await prisma.schedulerQueueItem.findMany()).map((q) => q.specId)).toEqual(["SPEC-2"]);
    expect((await prisma.leadEvent.findUnique({ where: { id: e.id } }))).toMatchObject({ status: "done", decisionId: r.row.id });
  });
  it("tak mengeksekusi dua kali", async () => {
    const e = (await order())!;
    await executeEventVerdict(e.id, v());
    await expect(executeEventVerdict(e.id, v())).rejects.toThrow("sudah ditutup");
  });
  it("integrasi gagal membuka event integrate-failed", async () => {
    const e = (await postDecision({ projectId: "demo", specId: "SPEC-2", sessionId: "spec-2", gate: "pulse", kind: "quality",
      question: "Backlog SPEC-2 sudah selesai", options: ["integrate-main — merge"] }))!;
    const r = await executeEventVerdict(e.id, v({ action: "integrate-main", choice: "integrate-main — merge" }), {
      apply: async () => ({ ok: false, detail: "verify-failed: `pnpm test` keluar 1" }),
    });
    expect(r.applied?.ok).toBe(false);
    const f = await prisma.leadEvent.findFirst({ where: { kind: "integrate-failed" } });
    expect(f?.question).toContain("verify-failed");
    expect(f?.specId).toBe("SPEC-2");
  });
  it("membaca id spec dari label opsi", () => {
    expect(specIdOfOption("SPEC-12 · [tinggi] judul")).toBe("SPEC-12");
  });
});
