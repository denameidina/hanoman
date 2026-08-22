import { afterEach, describe, expect, it, vi } from "vitest";
import { scannerFromEnv } from "../src/services/upload-pipeline";

// SPEC-884 · ADR-0139 · gerbang scanner berpindah pemicu dari NODE_ENV ke hardening. Instalasi
// biasa tak punya scanner virus, dan menolak setiap lampiran karena itu bukan perilaku yang bisa
// dipakai siapa pun — tapi ketiadaannya juga tak boleh senyap.
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

describe("gerbang scanner upload (SPEC-884)", () => {
  it("tanpa hardening: berkas diterima, tapi peringatannya dicetak", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HANOMAN_UPLOAD_SCANNER;
    delete process.env.HANOMAN_HARDENING;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(scannerFromEnv("/tmp/x")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HANOMAN_UPLOAD_SCANNER"));
  });

  it("hardening menyala tanpa scanner: fail closed", async () => {
    process.env.HANOMAN_HARDENING = "1";
    delete process.env.HANOMAN_UPLOAD_SCANNER;
    await expect(scannerFromEnv("/tmp/x")).rejects.toMatchObject({ code: "UPLOAD_SCAN" });
  });

  it("path scanner relatif tetap ditolak apa pun profilnya", async () => {
    delete process.env.HANOMAN_HARDENING;
    process.env.HANOMAN_UPLOAD_SCANNER = "clamscan";
    await expect(scannerFromEnv("/tmp/x")).rejects.toMatchObject({ code: "UPLOAD_SCAN" });
  });
});
