import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { thinkViaSession, LeadLateError, LeadRejectedError, eventKindFor } from "../src/services/lead/session-think";
import { pendingBatch, resolveEvent, closeEvent, __resetInbox } from "../src/services/lead/inbox";

// ADR-0228 · otak lead = pane sesi lead.

beforeEach(async () => { await prisma.leadEvent.deleteMany(); __resetInbox(); });
const ctx = {
  projectId: "p", gate: "detected" as const, kind: "answer" as const, question: "Pilih A atau B?",
  options: ["A", "B"], select: null, sessionId: "spec-1", specId: "SPEC-1", timeoutMs: 2000,
};
const verdict = { decision: "A", reason: "r", refs: [], confidence: "tinggi" as const, action: "answer-session", choice: "A", choices: [], missing: [], reply: "" };
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("thinkViaSession", () => {
  it("menulis event ber-penunggu lalu mengembalikan verdict yang dijawab pane", async () => {
    const started: string[] = [];
    let eventId = "";
    const p = thinkViaSession("PROMPT", { ...ctx, onEvent: (id) => { eventId = id; } }, { ensure: async (id) => { started.push(id); } });
    await tick();
    const [e] = await pendingBatch("p");
    expect(e!.id).toBe(eventId);
    expect(e).toMatchObject({ kind: "ask", sessionId: "spec-1", specId: "SPEC-1" });
    expect(e!.deadlineAt).not.toBeNull();
    expect(e!.payload).toMatchObject({ prompt: "PROMPT", mode: "wait", options: ["A", "B"] });
    await resolveEvent(e!.id, { verdict, evidence: [] });
    expect(JSON.parse(await p).decision).toBe("A");
    expect(started).toEqual(["p"]);
  });
  it("melempar LeadLateError saat tenggat lewat", async () => {
    await expect(thinkViaSession("P", { ...ctx, timeoutMs: 30 }, { ensure: async () => {} })).rejects.toBeInstanceOf(LeadLateError);
  });
  it("melempar LeadRejectedError saat manusia menolak", async () => {
    const p = thinkViaSession("P", ctx, { ensure: async () => {} });
    await tick();
    const [e] = await pendingBatch("p");
    await closeEvent(e!.id, "rejected");
    await expect(p).rejects.toBeInstanceOf(LeadRejectedError);
  });
  it("pane yang gagal lahir tak menggagalkan pembukaan event", async () => {
    const p = thinkViaSession("P", { ...ctx, timeoutMs: 40 }, { ensure: async () => { throw new Error("tmux"); } });
    await tick();
    expect(await prisma.leadEvent.count()).toBe(1);
    await expect(p).rejects.toBeInstanceOf(LeadLateError);
  });
  it("memetakan pintu ke jenis event", () => {
    expect(eventKindFor("contract", "answer")).toBe("ask");
    expect(eventKindFor("detected", "answer")).toBe("ask");
    expect(eventKindFor("pulse", "quality")).toBe("session-ended");
    expect(eventKindFor("pulse", "collision")).toBe("session-ended");
    expect(eventKindFor("pulse", "order")).toBe("pulse");
  });
});
