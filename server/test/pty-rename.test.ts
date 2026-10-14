import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, killAll, listSessions, renameSession } from "../src/services/pty";

// tmux SUNGGUHAN: nama kustom disimpan sebagai opsi `@hanoman_name` dan dibaca lagi lewat daftar sesi,
// jadi selamat dari restart API (tak ada map di memori).
afterEach(() => { killAll(); });

const nameOf = (id: string) => listSessions().find((s) => s.id === id)?.name;

describe("renameSession", () => {
  it("menyimpan, menimpa, dan menghapus nama kustom; sesi tak dikenal → false", { timeout: 20_000 }, () => {
    const s = createSession("rn1", mkdtempSync(join(tmpdir(), "hanoman-rn-")), { command: ["/bin/sleep", "30"] });
    expect(nameOf(s.id)).toBeUndefined();

    expect(renameSession(s.id, "  Perbaiki login  ")).toBe(true);
    expect(nameOf(s.id)).toBe("Perbaiki login");

    // Karakter kontrol (tab/newline) tak boleh merusak baris FMT; dipadatkan jadi spasi dan dipotong 80.
    expect(renameSession(s.id, `a\tb\nc${"x".repeat(200)}`)).toBe(true);
    const n = nameOf(s.id)!;
    expect(n.startsWith("a b c")).toBe(true);
    expect(n.length).toBe(80);

    expect(renameSession(s.id, "   ")).toBe(true);
    expect(nameOf(s.id)).toBeUndefined();

    expect(renameSession("tak-ada-sesi-ini", "x")).toBe(false);
  });
});
