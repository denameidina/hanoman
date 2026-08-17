import { describe, it, expect } from "vitest";
import { clipboardIntent, imageFilesFrom, hasImageDrag } from "../src/screens/terminal-clipboard";

const key = (over: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ type: "keydown", metaKey: false, ctrlKey: false, shiftKey: false, ...over } as KeyboardEvent);

describe("clipboardIntent", () => {
  it("Cmd+C copies when there is a selection (macOS)", () => {
    expect(clipboardIntent(key({ key: "c", metaKey: true }), true)).toBe("copy");
  });

  it("Cmd+C does nothing without a selection", () => {
    expect(clipboardIntent(key({ key: "c", metaKey: true }), false)).toBeNull();
  });

  it("Ctrl+Shift+C copies when there is a selection (Windows/Linux)", () => {
    expect(clipboardIntent(key({ key: "C", ctrlKey: true, shiftKey: true }), true)).toBe("copy");
  });

  it("plain Ctrl+C is left to the terminal (SIGINT), never hijacked as copy", () => {
    expect(clipboardIntent(key({ key: "c", ctrlKey: true }), true)).toBeNull();
  });

  it("Cmd+V pastes (macOS)", () => {
    expect(clipboardIntent(key({ key: "v", metaKey: true }), false)).toBe("paste");
  });

  it("Ctrl+Shift+V pastes (Windows/Linux)", () => {
    expect(clipboardIntent(key({ key: "V", ctrlKey: true, shiftKey: true }), false)).toBe("paste");
  });

  it("plain Ctrl+V is left to the terminal, never hijacked as paste", () => {
    expect(clipboardIntent(key({ key: "v", ctrlKey: true }), false)).toBeNull();
  });

  it("ignores keyup so only one action fires per keystroke", () => {
    expect(clipboardIntent(key({ key: "c", metaKey: true, type: "keyup" }), true)).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(clipboardIntent(key({ key: "a", metaKey: true }), true)).toBeNull();
  });
});

describe("SPEC-816 · pemilah berkas gambar", () => {
  it("mengambil png/jpeg/webp dan membuang sisanya", () => {
    const files = [
      { type: "image/png" }, { type: "text/plain" }, { type: "image/webp" },
      { type: "image/gif" }, { type: "image/jpeg" }, { type: "application/pdf" },
    ];
    expect(imageFilesFrom({ files }).map((f) => f.type))
      .toEqual(["image/png", "image/webp", "image/jpeg"]);
  });

  it("clipboard teks polos tak menghasilkan lampiran", () => {
    expect(imageFilesFrom({ files: [] })).toEqual([]);
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
  });

  // dragover: `files` masih KOSONG selama seret berlangsung (baru terisi saat drop), jadi
  // keputusan preventDefault harus dibaca dari `types`.
  it("hasImageDrag membaca types, bukan files", () => {
    expect(hasImageDrag({ types: ["Files"] })).toBe(true);
    expect(hasImageDrag({ types: ["text/plain"] })).toBe(false);
    expect(hasImageDrag(null)).toBe(false);
  });
});
