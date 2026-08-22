import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/app";
import { intakeAsk, __resetAsks, type AskDeps } from "../src/services/lead/ask";
import { isTakenOver, __resetDeciding } from "../src/services/lead/deciding";
import { beginAnswer, endAnswer } from "../src/services/session-dialog";

// SPEC-909 · ADR-0146 · AC-6 · perebutan operator vs lead. Pemenangnya deterministik: siapa pun
// yang kalah mendapat penolakan yang jelas, bukan dua jawaban terketik ke pane yang sama.

const PANE: Record<string, unknown> = {
  s1: { id: "s1", projectId: "p1", exited: false, agent: "claude", decisionFile: "/m", cwd: "/w" },
};
vi.mock("../src/services/pty", async (orig) => ({
  ...(await orig<typeof import("../src/services/pty")>()),
  getSession: vi.fn((id: string) => PANE[id]),
  getSessionAsync: vi.fn(async (id: string) => PANE[id]),
  listSessions: vi.fn(() => Object.values(PANE)),
}));

const EV = {
  source: "ask-tool" as const, askId: "t1", message: "",
  questions: [{ header: "H", question: "Q?", multiSelect: false, options: [{ label: "A" }] }],
};

/** Lead yang menggantung: sudah "menyusun", belum mengetik. Justru jendela takeover-nya. */
const hanging = (): AskDeps => ({
  admit: async () => ({ ok: true }),
  answer: () => new Promise<never>(() => {}),
  reset: () => {},
  live: () => ["s1"],
  maxConcurrent: async () => 1,
  now: () => 1_000_000,
});

const url = "/api/terminal/sessions/s1/dialog/takeover";
beforeEach(() => { __resetAsks(); __resetDeciding(); });

describe("POST /terminal/sessions/:id/dialog/takeover", () => {
  it("202 dan lead berhenti sebelum mengetik", async () => {
    const app = buildApp({ requireAuth: false });
    await intakeAsk({ sessionId: "s1", agent: "claude", projectId: "p1", event: EV }, hanging());
    const r = await app.inject({ method: "POST", url });
    expect(r.statusCode).toBe(202);
    expect(isTakenOver("s1")).toBe(true);
    await app.close();
  });

  it("409 answering saat lead sudah memegang pane — bukan dua jawaban ke pane yang sama", async () => {
    const app = buildApp({ requireAuth: false });
    await intakeAsk({ sessionId: "s1", agent: "claude", projectId: "p1", event: EV }, hanging());
    expect(beginAnswer("s1")).toBe(true);          // seolah lead sedang mengetik
    const r = await app.inject({ method: "POST", url });
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toBe("answering");
    expect(isTakenOver("s1")).toBe(false);
    endAnswer("s1");
    await app.close();
  });

  it("404 saat tak ada tanya hidup untuk sesi itu", async () => {
    const app = buildApp({ requireAuth: false });
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(404);
    await app.close();
  });

  it("sesudah diambil alih, jawaban operator tak lagi ditolak 409 deciding", async () => {
    const app = buildApp({ requireAuth: false });
    await intakeAsk({ sessionId: "s1", agent: "claude", projectId: "p1", event: EV }, hanging());
    // Gerbang `deciding` (ADR-0142 §5) berlaku SELAMA lead memegangnya …
    const before = await app.inject({
      method: "POST", url: "/api/terminal/sessions/s1/dialog/answer",
      payload: { screenHash: "abc123", text: "jawab" },
    });
    expect(before.statusCode).toBe(409);
    expect(before.json().reason).toBe("deciding");
    // … dan lepas begitu operator merebutnya. Yang tersisa hanya pagar `screenHash` SPEC-899,
    // yang memang menolak layar basi — bukan lagi "lead sedang menyusun".
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(202);
    const after = await app.inject({
      method: "POST", url: "/api/terminal/sessions/s1/dialog/answer",
      payload: { screenHash: "abc123", text: "jawab" },
    });
    expect(after.json().reason).not.toBe("deciding");
    await app.close();
  });
});
