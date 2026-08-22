import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HookEvent } from "@hanoman/shared";
import {
  intakeAsk, liveAsks, pruneAsks, takeOverAsk, __resetAsks, type AskDeps,
} from "../src/services/lead/ask";
import { isTakenOver, __resetDeciding } from "../src/services/lead/deciding";
import { beginAnswer, endAnswer } from "../src/services/session-dialog";

// SPEC-909 · ADR-0146 · registry tanya: idempotensi, batas laju, satu pekerjaan per sesi, takeover.
// Semua deps disuntik — nol tmux, nol agen, nol DB.

const EV: HookEvent = {
  source: "ask-tool", askId: "toolu_1", message: "",
  questions: [{ header: "Basis", question: "Basis?", multiSelect: false, options: [{ label: "SQLite" }] }],
};

type Input = Parameters<typeof intakeAsk>[0];
const IN = (over: Partial<Input> = {}): Input => ({
  sessionId: "s1", agent: "claude", projectId: "p1", specId: "SPEC-1",
  decisionFile: "/m", event: EV, ...over,
});

const ANSWERED = { answered: true, reason: "", at: 0, flowId: "f1", step: 1 };

function deps(over: Partial<AskDeps> = {}): AskDeps {
  return {
    admit: vi.fn(async () => ({ ok: true as const })),
    answer: vi.fn(async () => ANSWERED),
    reset: vi.fn(),
    live: () => ["s1", "s2"],
    maxConcurrent: async () => 2,
    now: () => 1_000_000,
    ...over,
  };
}

beforeEach(() => { __resetAsks(); __resetDeciding(); });

describe("intakeAsk", () => {
  it("menerima event sah dan menjalankan pekerjaannya sekali", async () => {
    const d = deps();
    expect(await intakeAsk(IN(), d)).toEqual({ status: "accepted" });
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
  });

  it("askId yang sama tak melahirkan keputusan kedua", async () => {
    const d = deps();
    await intakeAsk(IN(), d);
    expect(await intakeAsk(IN(), d)).toEqual({ status: "duplicate" });
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
  });

  it("dua event BERBEDA yang tiba bertumpuk = satu pekerjaan berjalan, yang kedua menyusul", async () => {
    let running = 0, maxRunning = 0;
    const d = deps({
      answer: vi.fn(async () => {
        running++; maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return ANSWERED;
      }),
    });
    await intakeAsk(IN({ event: { ...EV, askId: "a" } }), d);
    await intakeAsk(IN({ event: { ...EV, askId: "b" } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(maxRunning).toBe(1);          // satu sesi = satu pekerjaan, tak pernah dua paralel
  });

  it("rantai LINTAS-PANGGILAN: event kedua jadi pekerjaan berikutnya, bukan tunggu layar", async () => {
    const d = deps();
    await intakeAsk(IN({ event: { ...EV, askId: "a" } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
    await intakeAsk(IN({ event: { ...EV, askId: "b", questions: [
      { header: "Auth", question: "Auth?", multiSelect: false, options: [{ label: "Cookie" }] }] } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(2));
    expect(vi.mocked(d.answer).mock.calls[1]![0].questions[0]!.question).toBe("Auth?");
  });

  it("membatasi laju per sesi — badai tak bisa jadi SPEC-472 versi baru", async () => {
    const d = deps();
    const out: string[] = [];
    for (let i = 0; i < 8; i++) out.push((await intakeAsk(IN({ event: { ...EV, askId: `x${i}` } }), d)).status);
    expect(out.filter((s) => s === "rate-limited").length).toBeGreaterThanOrEqual(3);
  });

  it("429 TIDAK menyentuh pagar lead — ia hilang dengan menunggu (SPEC-479)", async () => {
    const d = deps();
    for (let i = 0; i < 8; i++) await intakeAsk(IN({ event: { ...EV, askId: `y${i}` } }), d);
    // Hanya yang lolos ember yang sampai ke pagar: nol baris jejak & nol notifikasi untuk sisanya.
    expect(d.admit).toHaveBeenCalledTimes(5);
  });

  it("event yang ditolak pagar tak pernah memanggil answer", async () => {
    const d = deps({ admit: vi.fn(async () => ({ ok: false as const, reason: "project tak opt-in lead" })) });
    expect(await intakeAsk(IN(), d)).toEqual({ status: "rejected", reason: "project tak opt-in lead" });
    expect(d.answer).not.toHaveBeenCalled();
  });

  it("memangkas penghitung sesi yang sudah tak hidup", async () => {
    const d = deps({ live: () => ["s1", "s2"] });
    await intakeAsk(IN({ sessionId: "s2", event: { ...EV, askId: "a" } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
    // s2 mati; event berikutnya untuk sesi lain memangkasnya.
    const later = deps({ ...d, live: () => ["s1"] });
    await intakeAsk(IN({ event: { ...EV, askId: "b" } }), later);
    expect(later.reset).toHaveBeenCalledWith("s2");
  });

  it("pruneAsks menutup celah sesi yang mati lalu LAHIR LAGI dengan id yang sama", async () => {
    const d = deps({ live: () => ["s1"] });
    await intakeAsk(IN(), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
    // Tanpa jalur ini, penghitung nyawa sebelumnya ikut ke sesi baru dan AC-11 menutupnya sebelum
    // ia sempat bertanya sekali pun — id sesi spec deterministik, jadi ini bukan kasus teoretis.
    pruneAsks({ ...d, live: () => [] });
    expect(d.reset).toHaveBeenCalledWith("s1");
  });

  it("membatasi berapa sesi dilayani sekaligus (cfg.maxConcurrent, SPEC-479)", async () => {
    let running = 0, maxRunning = 0;
    const d = deps({
      maxConcurrent: async () => 1,
      live: () => ["s1", "s2"],
      answer: vi.fn(async () => {
        running++; maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return ANSWERED;
      }),
    });
    await intakeAsk(IN({ sessionId: "s1", event: { ...EV, askId: "a" } }), d);
    await intakeAsk(IN({ sessionId: "s2", event: { ...EV, askId: "b" } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(maxRunning).toBe(1);
  });
});

describe("liveAsks — sumber frame siar leadAsks", () => {
  it("memancarkan tanya yang sedang dikerjakan dengan langkah & total", async () => {
    const d = deps();
    await intakeAsk(IN(), d);
    const a = liveAsks().find((x) => x.sessionId === "s1")!;
    expect(a).toMatchObject({ sessionId: "s1", agent: "claude", source: "ask-tool", total: 1, askId: "toolu_1" });
    expect(a.questions[0]!.question).toBe("Basis?");
    expect(["queued", "deciding", "answered"]).toContain(a.state);
  });

  it("codex memancarkan pesan giliran, bukan pertanyaan palsu", async () => {
    const d = deps();
    await intakeAsk(IN({
      sessionId: "s2", agent: "codex",
      event: { source: "turn-end", askId: "t1", questions: [], message: "Pakai SQLite atau Postgres?" },
    }), d);
    const a = liveAsks().find((x) => x.sessionId === "s2")!;
    expect(a.questions).toEqual([]);
    expect(a.message).toBe("Pakai SQLite atau Postgres?");
    expect(a.total).toBe(1);
  });
});

describe("takeOverAsk", () => {
  it("mengambil alih sebelum lead memegang pane", async () => {
    const d = deps({ answer: vi.fn(() => new Promise<never>(() => {})) as unknown as AskDeps["answer"] });
    await intakeAsk(IN(), d);
    expect(takeOverAsk("s1")).toBe("taken");
    expect(isTakenOver("s1")).toBe(true);
    expect(liveAsks().find((x) => x.sessionId === "s1")!.state).toBe("taken-over");
  });

  it("kalah saat lead sudah mengetik — penolakan yang jelas, bukan dua jawaban", async () => {
    const d = deps();
    await intakeAsk(IN(), d);
    expect(beginAnswer("s1")).toBe(true);      // seolah lead sedang mengetik
    expect(takeOverAsk("s1")).toBe("answering");
    endAnswer("s1");
  });

  it("sesi tanpa tanya hidup → none", () => {
    expect(takeOverAsk("entah")).toBe("none");
  });
});
