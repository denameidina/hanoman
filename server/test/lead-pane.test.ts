import { describe, it, expect } from "vitest";
import { readCodexTurn } from "../src/services/lead/pane";

// AC-9 · SPEC-909 · ADR-0146 · codex TIDAK punya `AskUserQuestion`; markernya diturunkan dari `Stop`
// (ADR-0074) yang menembak di TIAP akhir turn, jadi ia menyala juga saat sesi selesai wajar.
//
// Berkas ini dulu menguji `readPaneQuestion`, yang menilai teks PANE. Sejak SPEC-909 gerbangnya
// menilai `last_assistant_message` dari payload hook: teks penuh giliran terakhir, tak dipotong
// lebar pane (pane sesi di mesin dev 52 kolom) dan tak tercampur sisa scrollback. Ambangnya sama
// persis — `CODEX_FINISHED` dan `ASK_SIGNALS` yang sama — supaya cakupan codex setara, bukan lebih
// longgar. Kasus yang hanya berarti untuk pane (ornamen TUI, baris giliran claude) ikut hilang
// bersama fungsinya; yang tersisa di sini adalah gerbangnya sendiri.

describe("readCodexTurn · penanda SELESAI (AC-9)", () => {
  it.each([
    ["Goal achieved\n• Ran 12 tests, all green", "Goal achieved"],
    ["Goal unmet — plan masih punya kotak kosong", "Goal unmet"],
    ["Selesai merapikan modul.\n245k tokens used", "tokens used"],
    ["To continue this session, run codex resume", "To continue"],
  ])("diam untuk giliran yang berakhir wajar (%s)", (message) => {
    const r = readCodexTurn(message);
    expect(r.asking).toBe(false);
    expect(r.reason).toContain("selesai wajar");
  });

  it("penanda selesai MENANG atas sinyal pertanyaan yang kebetulan ada", () => {
    // Laporan akhir giliran sering memuat tanda tanya retoris atau daftar bernomor. Salah arah ke
    // "menjawab" membangunkan sesi yang sudah selesai; salah arah ke "diam" cuma mengembalikan
    // perilaku sebelum ADR-0091.
    expect(readCodexTurn("Mau lanjut ke langkah berikutnya?\n\n245k tokens used").asking).toBe(false);
  });
});

describe("readCodexTurn · sinyal BERTANYA", () => {
  it.each([
    "Pakai SQLite atau Postgres?",
    "1. SQLite\n2. Postgres",
    "Silakan pilih salah satu dari dua pendekatan itu.",
    "Should I proceed with the migration",
  ])("melayani giliran yang benar-benar meminta putusan (%s)", (message) => {
    expect(readCodexTurn(message).asking).toBe(true);
  });

  it("diam saat giliran cuma melapor, tanpa satu pun sinyal pertanyaan", () => {
    const r = readCodexTurn("Sudah kutambahkan indeks pada kolom createdAt dan memperbarui docs.");
    expect(r.asking).toBe(false);
    expect(r.reason).toContain("tak ada sinyal pertanyaan");
  });

  it("giliran tanpa pesan sama sekali bukan pertanyaan", () => {
    expect(readCodexTurn("").asking).toBe(false);
    expect(readCodexTurn("   \n\n  ").reason).toContain("tanpa pesan");
  });
});
