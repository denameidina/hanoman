import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerify } from "../src/services/lead/verify";

// ADR-0228 · perintah verifikasi integrasi dijalankan server.

const dir = mkdtempSync(join(tmpdir(), "lead-verify-"));

describe("runVerify", () => {
  it("hijau untuk exit 0, di direktori kerja yang diminta", async () => {
    const r = await runVerify(dir, "pwd", 5000);
    expect(r.ok).toBe(true);
    expect(r.tail).toContain("lead-verify-");
  });
  it("merah + ekor keluaran untuk exit ≠ 0", async () => {
    const r = await runVerify(dir, "echo gagal-test >&2; exit 3", 5000);
    expect(r).toMatchObject({ ok: false, code: 3 });
    expect(r.tail).toContain("gagal-test");
  });
  it("merah saat melewati batas waktu", async () => {
    const r = await runVerify(dir, "sleep 5", 200);
    expect(r.ok).toBe(false);
    expect(r.tail).toContain("dihentikan");
  });
  it("tak meneruskan env sesi hanoman ke perintah", async () => {
    process.env.HANOMAN_EVENT_TOKEN = "rahasia";
    try {
      const r = await runVerify(dir, "echo \"[$HANOMAN_EVENT_TOKEN]\"", 5000);
      expect(r.tail).toContain("[]");
    } finally { delete process.env.HANOMAN_EVENT_TOKEN; }
  });
});
