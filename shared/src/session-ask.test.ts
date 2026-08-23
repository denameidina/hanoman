import { describe, it, expect } from "vitest";
import { parseHookEvent, ASK_MESSAGE_MAX, ASK_QUESTION_MAX } from "./session-ask";

// Payload di bawah adalah TANGKAPAN NYATA (spec SPEC-909 §6.1/§6.4), bukan karangan: claude 2.1.240
// & codex-cli 0.147.0. Kalau bentuknya berubah, test ini yang harus jadi tempat pertama tahu.
const CLAUDE = {
  session_id: "6b3cc73f-9494-4dd9-ac6e-8545f8bc2f2b",
  cwd: "/tmp/hooktest", hook_event_name: "PreToolUse", tool_name: "AskUserQuestion",
  tool_use_id: "toolu_01Ev4E6Yw74X3uEWxLbKMsSv",
  tool_input: { questions: [{
    question: "Warna mana yang kamu pilih?", header: "Warna", multiSelect: false,
    options: [{ label: "Merah", description: "hangat" }, { label: "Biru", description: "sejuk" }],
  }] },
};
const CODEX = {
  session_id: "01a02bad-554c-7fe0-b7ad-92e070301f77", turn_id: "01a02bad-5737-72e0-933b-fcc99b4b993b",
  cwd: "/tmp/hooktest", hook_event_name: "Stop", stop_hook_active: false,
  last_assistant_message: "Mau pakai SQLite atau Postgres?",
};

describe("parseHookEvent", () => {
  it("membaca AskUserQuestion claude jadi daftar pertanyaan terstruktur", () => {
    const e = parseHookEvent(CLAUDE);
    expect(e).toMatchObject({ source: "ask-tool", askId: "toolu_01Ev4E6Yw74X3uEWxLbKMsSv", message: "" });
    expect(e!.questions).toHaveLength(1);
    expect(e!.questions[0]).toEqual({
      header: "Warna", question: "Warna mana yang kamu pilih?", multiSelect: false,
      options: [{ label: "Merah", description: "hangat" }, { label: "Biru", description: "sejuk" }],
    });
  });

  it("membaca Stop codex jadi pesan giliran, tanpa pertanyaan terstruktur", () => {
    const e = parseHookEvent(CODEX);
    expect(e).toMatchObject({
      source: "turn-end", askId: "01a02bad-5737-72e0-933b-fcc99b4b993b",
      message: "Mau pakai SQLite atau Postgres?",
    });
    expect(e!.questions).toEqual([]);
  });

  it("memotong pesan yang kelewat panjang, bukan menolaknya", () => {
    const e = parseHookEvent({ ...CODEX, last_assistant_message: "x".repeat(ASK_MESSAGE_MAX + 500) });
    expect(e!.message).toHaveLength(ASK_MESSAGE_MAX);
  });

  it("mengabaikan event yang bukan pertanyaan", () => {
    expect(parseHookEvent({ ...CLAUDE, tool_name: "Bash" })).toBeNull();
    expect(parseHookEvent({ hook_event_name: "PostToolUse" })).toBeNull();
    expect(parseHookEvent({ ...CODEX, stop_hook_active: true })).toBeNull();
    expect(parseHookEvent(null)).toBeNull();
    expect(parseHookEvent("bukan objek")).toBeNull();
  });

  it("menolak AskUserQuestion tanpa satu pun pertanyaan", () => {
    expect(parseHookEvent({ ...CLAUDE, tool_input: { questions: [] } })).toBeNull();
  });
});

// SPEC-909 (tinjauan keamanan) · payload hook adalah input TAK TERPERCAYA, dan `parseHookEvent`
// duduk SEBELUM ember token — jadi biayanya harus berbatas di sini, bukan di hilir.
describe("parseHookEvent · pagar biaya", () => {
  const ask = (q: unknown) => ({
    hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "t1",
    tool_input: { questions: q },
  });

  it("linear terhadap panjang — bukan kuadratik (regresi ReDoS `clip`)", () => {
    // `/\s+$/` atas string PENUH memberi 556 ms @ 30 kB dan 2 195 ms @ 60 kB (terukur). Yang
    // dijaga di sini bukan angka absolutnya, melainkan bahwa menggandakan input tak melipat
    // waktunya jauh lebih dari dua kali.
    const run = (n: number) => {
      const body = ask([{ question: `${" ".repeat(n)}x${" ".repeat(n)}`, header: "h" }]);
      const t0 = performance.now();
      expect(parseHookEvent(body)).not.toBeNull();
      return performance.now() - t0;
    };
    run(1_000);                                    // pemanasan JIT
    const kecil = Math.max(run(20_000), 0.05);
    const besar = run(80_000);
    expect(besar / kecil).toBeLessThan(20);        // kuadratik akan ≈ 16× per 4× panjang, dan naik
    expect(besar).toBeLessThan(500);
  });

  it("menolak payload yang jumlahnya di luar akal — bukan memangkasnya diam-diam", () => {
    const banyakOpsi = [{ question: "q", header: "h",
      options: Array.from({ length: 5_000 }, (_, i) => ({ label: `o${i}` })) }];
    expect(parseHookEvent(ask(banyakOpsi))).toBeNull();
    const banyakPertanyaan = Array.from({ length: 64 }, (_, i) => ({ question: `q${i}`, header: "h" }));
    expect(parseHookEvent(ask(banyakPertanyaan))).toBeNull();
  });

  it("memotong tiap teks, jadi satu payload tak bisa membengkakkan prompt/frame/kolom jejak", () => {
    const e = parseHookEvent(ask([{
      question: "q".repeat(50_000), header: "h".repeat(50_000),
      options: [{ label: "l".repeat(50_000), description: "d".repeat(50_000) }],
    }]))!;
    expect(e.questions[0]!.question.length).toBeLessThanOrEqual(ASK_QUESTION_MAX);
    expect(e.questions[0]!.header.length).toBeLessThanOrEqual(200);
    expect(e.questions[0]!.options[0]!.label.length).toBeLessThanOrEqual(200);
    expect(e.questions[0]!.options[0]!.description!.length).toBeLessThanOrEqual(400);
  });
});
