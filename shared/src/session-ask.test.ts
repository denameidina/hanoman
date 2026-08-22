import { describe, it, expect } from "vitest";
import { parseHookEvent, ASK_MESSAGE_MAX } from "./session-ask";

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
