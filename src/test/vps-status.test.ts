// Audit UI/UX 2026-10 · Fase 3J — status tiga langkah VPS dan syarat Terapkan di alur perbaikan.
import { describe, expect, it } from "vitest";
import type { VpsView } from "@hanoman/shared";
import { canApplyRemediation, scoreText, vpsSteps } from "../src/screens/vps-status";

const NOW = Date.parse("2026-10-11T10:00:00.000Z");
const VPS = {
  id: "v1", name: "web-1", host: "203.0.113.10", port: 22, user: "deploy", keyPath: null,
  createdAt: "2026-07-10T00:00:00Z", lastSeenAt: null, health: null,
  lastAuditAt: null, audit: null, hardened: false,
} as VpsView;

const states = (v: VpsView) => vpsSteps(v, NOW).map((s) => [s.label, s.state, s.text]);

describe("vpsSteps: Terhubung → Diaudit → Diperkuat", () => {
  it("VPS baru: semua langkah belum, tanpa 'gagal' untuk yang belum pernah terhubung", () => {
    expect(states(VPS)).toEqual([
      ["Terhubung", "todo", "belum terhubung"],
      ["Diaudit", "todo", "belum diaudit"],
      ["Diperkuat", "todo", "belum diperkuat"],
    ]);
  });

  it("terhubung dalam 10 menit terakhir → selesai; pernah terhubung lalu hilang → gagal", () => {
    expect(vpsSteps({ ...VPS, lastSeenAt: "2026-10-11T09:55:00.000Z" } as VpsView, NOW)[0])
      .toMatchObject({ state: "done", text: "terhubung" });
    expect(vpsSteps({ ...VPS, lastSeenAt: "2026-10-11T08:00:00.000Z" } as VpsView, NOW)[0])
      .toMatchObject({ state: "gagal", text: "tidak terjangkau" });
  });

  it("sudah diaudit tapi belum diperkuat: langkah ketiga tetap belum", () => {
    const v = { ...VPS, lastAuditAt: "2026-10-11T08:00:00.000Z", hardened: false } as VpsView;
    expect(vpsSteps(v, NOW)[1]).toMatchObject({ state: "done" });
    expect(vpsSteps(v, NOW)[2]).toMatchObject({ state: "todo", text: "belum diperkuat" });
  });

  it("diperkuat hanya bila sudah diaudit DAN hardened", () => {
    const v = { ...VPS, lastAuditAt: "2026-10-11T08:00:00.000Z", hardened: true } as VpsView;
    expect(vpsSteps(v, NOW)[2]).toMatchObject({ state: "done", text: "diperkuat" });
  });

  it("teks langkah audit memakai waktu relatif dari lib/time-format", () => {
    const v = { ...VPS, lastAuditAt: "2026-10-11T08:00:00.000Z" } as VpsView;
    expect(vpsSteps(v, NOW)[1]!.text).toBe("diaudit 2 jam lalu");
  });
});

describe("canApplyRemediation: Terapkan hanya dari pratinjau untuk pilihan yang sama", () => {
  it("tanpa pratinjau, Terapkan tak boleh", () => {
    expect(canApplyRemediation(["fw-b1"], null)).toBe(false);
  });

  it("pratinjau untuk pilihan yang sama boleh", () => {
    expect(canApplyRemediation(["fw-b1", "ssh-b2"], ["ssh-b2", "fw-b1"])).toBe(true);
  });

  it("pratinjau untuk pilihan yang berbeda tak boleh (pilihan berubah = pratinjau basi)", () => {
    expect(canApplyRemediation(["fw-b1", "fw-b2"], ["fw-b1"])).toBe(false);
    expect(canApplyRemediation(["fw-b1"], ["fw-b1", "fw-b2"])).toBe(false);
  });

  it("tanpa pilihan tak ada yang bisa diterapkan", () => {
    expect(canApplyRemediation([], [])).toBe(false);
  });
});

describe("scoreText", () => {
  it("skor belum diketahui ditulis sebagai strip, bukan 0%", () => {
    expect(scoreText(undefined)).toBe("Skor —");
    expect(scoreText(0)).toBe("Skor 0%");
    expect(scoreText(77)).toBe("Skor 77%");
  });
});
