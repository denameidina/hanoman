import { beforeEach, describe, expect, it } from "vitest";
import {
  appendFinal, DEFAULT_LANG, ERROR_MESSAGES, initialVoiceState, LANG_KEY, readLang, voiceReducer,
  writeLang, type SpeechError, type VoiceState,
} from "../src/screens/speech-engine";

describe("appendFinal", () => {
  it("draf kosong → teks final apa adanya (di-trim)", () => {
    expect(appendFinal("", "  halo dunia ")).toBe("halo dunia");
  });
  it("menyisipkan satu spasi pemisah", () => {
    expect(appendFinal("buka file", "server")).toBe("buka file server");
  });
  it("tidak menggandakan spasi bila draf sudah berakhir spasi", () => {
    expect(appendFinal("buka ", "file")).toBe("buka file");
  });
  it("teks final kosong/spasi saja → draf tak berubah", () => {
    expect(appendFinal("abc", "")).toBe("abc");
    expect(appendFinal("abc", "   ")).toBe("abc");
  });
  it("tidak mengubah kapitalisasi", () => {
    expect(appendFinal("jalankan", "PNPM Vitest")).toBe("jalankan PNPM Vitest");
  });
});

describe("voiceReducer", () => {
  const listening: VoiceState = { status: "listening", interim: "", error: null };

  it("start → listening, interim & galat dibersihkan", () => {
    const s = voiceReducer({ status: "idle", interim: "x", error: "network" }, { type: "start" });
    expect(s).toEqual(listening);
  });
  it("interim menyimpan teks sementara", () => {
    expect(voiceReducer(listening, { type: "interim", text: "ha" }).interim).toBe("ha");
  });
  it("final membersihkan interim, tetap listening", () => {
    const s = voiceReducer({ ...listening, interim: "halo" }, { type: "final" });
    expect(s).toEqual(listening);
  });
  it("error → idle dan galat tersimpan", () => {
    const s = voiceReducer({ ...listening, interim: "ha" }, { type: "error", error: "not-allowed" });
    expect(s).toEqual({ status: "idle", interim: "", error: "not-allowed" });
  });
  it("end sesudah error mempertahankan galat (browser memicu error lalu end)", () => {
    const afterError = voiceReducer(listening, { type: "error", error: "no-speech" });
    expect(voiceReducer(afterError, { type: "end" }).error).toBe("no-speech");
  });
  it("end tanpa galat → idle bersih", () => {
    expect(voiceReducer({ ...listening, interim: "ha" }, { type: "end" }))
      .toEqual(initialVoiceState);
  });
  it("dismiss menghapus galat saja", () => {
    const s = voiceReducer({ status: "idle", interim: "", error: "network" }, { type: "dismiss" });
    expect(s).toEqual(initialVoiceState);
  });
});

describe("ERROR_MESSAGES", () => {
  it("punya pesan untuk setiap SpeechError", () => {
    const all: SpeechError[] = ["not-allowed", "no-speech", "network", "insecure-context", "unsupported", "other"];
    for (const e of all) expect(ERROR_MESSAGES[e].length).toBeGreaterThan(0);
  });
});

describe("readLang/writeLang", () => {
  beforeEach(() => { localStorage.clear(); });

  it("default id-ID bila belum tersimpan", () => {
    expect(readLang()).toBe(DEFAULT_LANG);
    expect(DEFAULT_LANG).toBe("id-ID");
  });
  it("menyimpan dan membaca bahasa yang dikenal", () => {
    writeLang("en-US");
    expect(localStorage.getItem(LANG_KEY)).toBe("en-US");
    expect(readLang()).toBe("en-US");
  });
  it("nilai asing di storage → jatuh ke default", () => {
    localStorage.setItem(LANG_KEY, "xx-XX");
    expect(readLang()).toBe(DEFAULT_LANG);
  });
  it("storage melempar → tidak crash, default", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    try { expect(readLang()).toBe(DEFAULT_LANG); } finally { Storage.prototype.getItem = orig; }
    expect(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("blocked"); };
      try { writeLang("en-US"); } finally { Storage.prototype.setItem = set; }
    }).not.toThrow();
  });
});
