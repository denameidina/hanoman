import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionAsk } from "@hanoman/shared";
import {
  admitAsk, answerAsk, __resetDetect, answerCount, failureCount, type DetectDeps,
} from "../src/services/lead/detect";
import { __resetLeadGate } from "../src/services/lead/gate";
import { __resetDeciding } from "../src/services/lead/deciding";

const LEAD = {
  enabled: true, paused: false, pausedProjects: [] as string[], everyMin: 5, timeoutSec: 600,
  maxAutoAnswers: 3, maxConcurrent: 2, queueWaitSec: 120, flowTtlMin: 60,
  requireGreenBeforeIntegrate: true,
  engine: { enabled: false, agent: "claude", model: "m", effort: "high" },
} as never;

const DIALOG = [
  "☐ Basis",
  "Basis data mana?",
  "❯ 1. SQLite",
  "  2. Postgres",
  "  3. Type something.",
  "  4. Chat about this",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
].join("\n");

const ask = (over: Partial<SessionAsk> = {}): SessionAsk => ({
  sessionId: "s1", agent: "claude", source: "ask-tool", askId: "toolu_1",
  askedAt: new Date().toISOString(),
  questions: [{ header: "Basis", question: "Basis data mana?", multiSelect: false,
    options: [{ label: "SQLite" }, { label: "Postgres" }] }],
  message: "", at: 0, total: 1, state: "queued", flowId: null, step: null, ...over,
});

const CTX = { projectId: "p1", specId: "SPEC-1", decisionFile: "/m" };
const S = { id: "s1", specId: "SPEC-1", projectId: "p1" };

function deps(over: Partial<DetectDeps> = {}): DetectDeps {
  return {
    pane: () => DIALOG,
    exited: () => false,
    send: vi.fn(async () => true),
    clearMarker: vi.fn(),
    submit: vi.fn(async () => true),
    sleep: async () => {},
    closeChain: vi.fn(async () => {}),
    now: () => 1_000_000,
    decide: vi.fn(async () => ({ id: "d1", status: "berlaku", answer: "SQLite", flowId: "f1", step: 1 })),
    decideDeps: {},
    delivery: () => ({ decision: "Pakai SQLite", choices: [{ index: 1, option: "SQLite" }], refs: [], missing: [] }),
    optIn: async () => ["p1"],
    notify: vi.fn(async () => {}),
    cfg: async () => LEAD,
    ...over,
  } as unknown as DetectDeps;
}

beforeEach(() => { __resetDetect(); __resetLeadGate(); __resetDeciding(); });

describe("admitAsk — pagar lama, satu sesi per panggilan", () => {
  it("meloloskan sesi yang opt-in & lead aktif", async () => {
    expect(await admitAsk(S, deps())).toEqual({ ok: true });
  });

  it("menolak project yang tak opt-in", async () => {
    expect(await admitAsk(S, deps({ optIn: async () => [] })))
      .toEqual({ ok: false, reason: "project tak opt-in lead" });
  });

  it("menolak saat lead dijeda untuk project ini (AC-15/27)", async () => {
    const cfg = (async () => ({ ...(LEAD as object), pausedProjects: ["p1"] })) as never;
    expect(await admitAsk(S, deps({ cfg })))
      .toEqual({ ok: false, reason: "lead dijeda untuk project ini" });
  });

  it("menolak saat master switch mati (AC-30)", async () => {
    const cfg = (async () => ({ ...(LEAD as object), enabled: false })) as never;
    expect((await admitAsk(S, deps({ cfg }))).ok).toBe(false);
  });

  it("menolak pane mati (AC-10)", async () => {
    expect(await admitAsk(S, deps({ exited: () => true })))
      .toEqual({ ok: false, reason: "pane mati" });
  });

  it("menolak + menotifikasi SEKALI saat maxAutoAnswers tercapai (AC-11)", async () => {
    const d = deps();
    for (let i = 0; i < 3; i++) await answerAsk(ask({ askId: `t${i}` }), CTX, d);
    expect(answerCount("s1")).toBe(3);
    const first = await admitAsk(S, d);
    const second = await admitAsk(S, d);
    expect(first).toEqual({ ok: false, reason: "batas jawaban otomatis tercapai" });
    expect(second.ok).toBe(false);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("melepas failCapped sesudah FAIL_COOLDOWN_MS (SPEC-487)", async () => {
    const decide = (async () => ({ id: "d", status: "gagal", answer: "", flowId: null, step: null })) as never;
    const d = deps({ decide });
    for (let i = 0; i < 3; i++) await answerAsk(ask({ askId: `t${i}` }), CTX, d);
    expect(failureCount("s1")).toBe(3);
    expect((await admitAsk(S, d)).ok).toBe(false);
    expect(await admitAsk(S, deps({ now: () => 1_000_000 + 16 * 60_000 }))).toEqual({ ok: true });
  });
});

describe("answerAsk — rantai disuapi payload", () => {
  it("memakai pertanyaan & opsi DARI PAYLOAD, bukan dari layar", async () => {
    const d = deps();
    await answerAsk(ask(), CTX, d);
    const req = vi.mocked(d.decide).mock.calls[0]![0] as Record<string, unknown>;
    expect(req.question).toBe("Basis data mana?");
    expect(req.options).toEqual(["SQLite", "Postgres"]);
    expect(req.chain).toBe(true);
  });

  it("satu panggilan 3 pertanyaan = 3 decide dalam SATU alur, lalu Submit & marker dikosongkan", async () => {
    // Layar sungguhan MAJU antar-tab: judulnya berganti, jadi `dialogKey` — dan karena itu
    // `waitScreenChange` — ikut berganti. Suffix kosmetik saja tak cukup: `dialogKey` sengaja
    // stabil terhadap kursor & spinner (ADR-0142 keputusan 2).
    let n = 0;
    const paneAt = (t: number) => [
      "☐ Basis", `Pertanyaan ke-${t}?`, "❯ 1. SQLite", "  2. Postgres",
      "  3. Type something.", "  4. Chat about this",
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ].join("\n");
    const d = deps({ pane: () => paneAt(n++) });
    const three = ask({
      total: 3,
      questions: [
        { header: "Basis", question: "Basis?", multiSelect: false, options: [{ label: "SQLite" }] },
        { header: "Auth", question: "Auth?", multiSelect: true, options: [{ label: "Cookie" }] },
        { header: "Deploy", question: "Deploy?", multiSelect: false, options: [{ label: "VPS" }] },
      ],
    });
    const r = await answerAsk(three, CTX, d);
    const calls = vi.mocked(d.decide).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => (c[0] as Record<string, unknown>).flowId)).toEqual([null, "f1", "f1"]);
    expect(d.submit).toHaveBeenCalledTimes(1);
    expect(d.clearMarker).toHaveBeenCalledWith("/m");
    expect(d.closeChain).toHaveBeenCalledWith("f1");
    expect(r.answered).toBe(true);
    expect(answerCount("s1")).toBe(1);       // satu PANGGILAN = satu jawaban otomatis
  });

  it("dialog tak pernah muncul → TIDAK mengetik apa pun (anti pesan liar SPEC-487)", async () => {
    const d = deps({ pane: () => "✻ Cooked for 40m 4s\n> " });
    const r = await answerAsk(ask(), CTX, d);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.clearMarker).not.toHaveBeenCalled();
    expect(r.answered).toBe(false);
    expect(failureCount("s1")).toBe(1);
  });

  it("codex turn-end tanpa sinyal pertanyaan → diam (AC-9)", async () => {
    const d = deps({ pane: () => "> " });
    const r = await answerAsk(
      ask({ agent: "codex", source: "turn-end", questions: [], message: "Selesai. tokens used 8.180" }),
      CTX, d);
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(r.answered).toBe(false);
  });

  it("codex turn-end DENGAN pertanyaan → prosa diketik ke kolom chat", async () => {
    const d = deps({ pane: () => "> " });
    const r = await answerAsk(
      ask({ agent: "codex", source: "turn-end", questions: [], message: "Pakai SQLite atau Postgres?" }),
      CTX, d);
    expect((vi.mocked(d.decide).mock.calls[0]![0] as Record<string, unknown>).question)
      .toBe("Pakai SQLite atau Postgres?");
    expect(d.send).toHaveBeenCalled();
    expect(r.answered).toBe(true);
  });
});
