import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HookEvent } from "@hanoman/shared";
import {
  intakeAsk, liveAsks, pruneAsks, takeOverAsk, __resetAsks, ASK_MISMATCH_MAX, type AskDeps,
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
    await vi.waitFor(() => expect(later.reset).toHaveBeenCalledWith("s2"));
  });

  it("pruneAsks menutup celah sesi yang mati lalu LAHIR LAGI dengan id yang sama", async () => {
    const d = deps({ live: () => ["s1"] });
    await intakeAsk(IN(), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
    // Tanpa jalur ini, penghitung nyawa sebelumnya ikut ke sesi baru dan AC-11 menutupnya sebelum
    // ia sempat bertanya sekali pun — id sesi spec deterministik, jadi ini bukan kasus teoretis.
    pruneAsks({ ...d, live: () => [] });
    await vi.waitFor(() => expect(d.reset).toHaveBeenCalledWith("s1"));
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

  it("event yang tiba selagi lead berjalan TIDAK mencabut takeover operator", async () => {
    // Pemicunya milik SESI (agennya bertanya lagi), bukan operator. Kalau `clearTakeover` berjalan
    // tanpa syarat, event kedua yang tiba selagi lead masih di tengah rantai akan mengembalikan
    // kendali ke lead tanpa satu pun pesan — dan pane menerima dua jawaban.
    const d = deps({ answer: vi.fn(() => new Promise<never>(() => {})) as unknown as AskDeps["answer"] });
    await intakeAsk(IN({ event: { ...EV, askId: "a" } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalled());   // lead benar-benar BERJALAN
    expect(takeOverAsk("s1")).toBe("taken");
    await intakeAsk(IN({ event: { ...EV, askId: "b" } }), d);
    expect(isTakenOver("s1")).toBe(true);
    expect(liveAsks().find((x) => x.sessionId === "s1")!.state).toBe("taken-over");
  });
});

// ADR-0223 · setiap panggilan di rantai `AskUserQuestion` harus sampai ke lead, urut kedatangan.
describe("antrean tanya per sesi (ADR-0223)", () => {
  const ev = (askId: string, question = `${askId}?`): HookEvent => ({
    ...EV, askId, questions: [{ header: askId, question, multiSelect: false, options: [{ label: "Ya" }] }],
  });
  const order = (d: AskDeps): string[] => vi.mocked(d.answer).mock.calls.map((c) => c[0].askId);

  it("event yang tiba SEBELUM pekerjanya mulai tidak menimpa tanya pertama", async () => {
    // Regresi: `running` baru menyala sesudah `await maxConcurrent()`, dan event kedua di celah itu
    // dulu menimpa entri yang belum mulai, lalu KEDUA entri berjalan paralel di satu pane.
    let running = 0, maxRunning = 0;
    const d = deps({
      maxConcurrent: () => new Promise((r) => setTimeout(() => r(2), 20)),
      answer: vi.fn(async () => {
        running++; maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 15));
        running--;
        return ANSWERED;
      }),
    });
    await intakeAsk(IN({ event: ev("a") }), d);
    await intakeAsk(IN({ event: ev("b") }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(order(d)).toEqual(["a", "b"]);
    expect(maxRunning).toBe(1);
  });

  it("tiga panggilan bertumpuk dijawab SEMUA, urut kedatangan — bukan cuma yang terbaru", async () => {
    const d = deps({
      answer: vi.fn(async () => { await new Promise((r) => setTimeout(r, 15)); return ANSWERED; }),
    });
    for (const id of ["a", "b", "c"]) await intakeAsk(IN({ event: ev(id) }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(3), { timeout: 2000 });
    expect(order(d)).toEqual(["a", "b", "c"]);
  });

  it("dialog di layar milik tanya lain → tanya berikutnya didahulukan, yang ini diulang sesudahnya", async () => {
    let first = true;
    const d = deps({
      answer: vi.fn(async (a) => {
        await new Promise((r) => setTimeout(r, 10));
        if (a.askId === "a" && first) { first = false; return { ...ANSWERED, answered: false, reason: "lain", mismatch: true }; }
        return ANSWERED;
      }),
    });
    await intakeAsk(IN({ event: ev("a") }), d);
    await intakeAsk(IN({ event: ev("b") }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(3), { timeout: 2000 });
    expect(order(d)).toEqual(["a", "b", "a"]);
  });

  it("mismatch tanpa tanya lain di antrean tidak diulang tanpa ujung", async () => {
    const d = deps({ answer: vi.fn(async () => ({ ...ANSWERED, answered: false, reason: "lain", mismatch: true })) });
    await intakeAsk(IN({ event: ev("a") }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(d.answer).toHaveBeenCalledTimes(1);
    expect(liveAsks().find((x) => x.sessionId === "s1")!.state).toBe("failed");
  });

  it("rotasi mismatch berbatas ASK_MISMATCH_MAX", async () => {
    const d = deps({ answer: vi.fn(async () => ({ ...ANSWERED, answered: false, reason: "lain", mismatch: true })) });
    await intakeAsk(IN({ event: ev("a") }), d);
    await intakeAsk(IN({ event: ev("b") }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    // a, b, a, b, a — tiap tanya dicoba paling banyak 1 + ASK_MISMATCH_MAX kali, lalu dilepas.
    expect(vi.mocked(d.answer).mock.calls.length).toBeLessThanOrEqual(2 * (1 + ASK_MISMATCH_MAX));
  });

  it("pagar menerima tanda tangan pertanyaan untuk AC-11 per pertanyaan", async () => {
    const d = deps();
    await intakeAsk(IN({ event: ev("a", "Basis data mana?") }), d);
    expect(vi.mocked(d.admit).mock.calls[0]![0].sig).toBe("basis data mana?");
  });
});
