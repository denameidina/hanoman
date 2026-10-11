// Audit UI/UX 2026-10 · Fase 3G — pemetaan tingkat akses ↔ grant kendali jarak jauh.
// Selektor Lihat/Kerja/Tulis hanya sah bila tingkatnya memetakan ke grant API yang ada tanpa mengubah API.
import { describe, expect, it } from "vitest";
import type { RemoteCapability } from "@hanoman/shared";
import {
  ACCESS_TIERS, TIER_GRANTS, customGrantLabels, grantDiff, isRiskyTier, needsConfirm, tierOf,
} from "../src/screens/remote-access-tier";

const READ: RemoteCapability[] = ["sessions:read", "backlog:read", "ide:read"];

describe("pemetaan tingkat → grant", () => {
  it("Lihat hanya grant baca", () => {
    expect([...TIER_GRANTS.lihat].sort()).toEqual([...READ].sort());
  });

  it("Kerja = Lihat + tandai selesai + mulai sesi, tanpa mengetik ke terminal", () => {
    expect([...TIER_GRANTS.kerja].sort()).toEqual(
      [...READ, "backlog:write", "sessions:spawn"].sort());
    expect(TIER_GRANTS.kerja).not.toContain("sessions:write");
  });

  it("Tulis = Kerja + tulis ke terminal (semua grant yang dikenal server)", () => {
    expect([...TIER_GRANTS.tulis].sort()).toEqual([
      "backlog:read", "backlog:write", "ide:read", "sessions:read", "sessions:spawn", "sessions:write",
    ]);
  });

  // Tingkat bertingkat: setiap tingkat memuat semua grant tingkat di bawahnya.
  it("tiap tingkat adalah superset tingkat di bawahnya", () => {
    for (let i = 1; i < ACCESS_TIERS.length; i++) {
      const lower = TIER_GRANTS[ACCESS_TIERS[i - 1]!];
      for (const c of lower) expect(TIER_GRANTS[ACCESS_TIERS[i]!]).toContain(c);
    }
  });

  // Server menolak grant tulis tanpa sessions:read; setiap tingkat memuatnya.
  it("setiap tingkat memuat sessions:read", () => {
    for (const t of ACCESS_TIERS) expect(TIER_GRANTS[t]).toContain("sessions:read");
  });
});

describe("tierOf: membaca tingkat dari daftar grant server", () => {
  it("tiap tingkat dikenali dari grant persisnya, apa pun urutannya", () => {
    expect(tierOf(["ide:read", "sessions:spawn", "backlog:write", "sessions:read", "backlog:read"])).toBe("kerja");
    expect(tierOf([...READ])).toBe("lihat");
    expect(tierOf([...TIER_GRANTS.tulis].reverse())).toBe("tulis");
  });

  it("tanpa grant = kosong (bukan Lihat)", () => {
    expect(tierOf([])).toBe("kosong");
  });

  // Kombinasi yang tak terwakili tingkat mana pun → khusus, supaya tidak diam-diam dianggap tingkat lain.
  it("kombinasi di luar tingkat = khusus", () => {
    expect(tierOf(["sessions:read", "sessions:write"])).toBe("khusus");
    expect(tierOf([...READ, "sessions:spawn"])).toBe("khusus");
    // Kerja tanpa ide:read: hampir tingkat, tetap bukan tingkat.
    expect(tierOf(["sessions:read", "backlog:read", "backlog:write", "sessions:spawn"])).toBe("khusus");
  });
});

describe("customGrantLabels & grantDiff", () => {
  it("rincian khusus dalam bahasa biasa, urut katalog", () => {
    expect(customGrantLabels(["sessions:write", "sessions:read"])).toEqual(["Lihat sesi", "Tulis ke terminal"]);
  });

  it("selisih grant saat turun dari Tulis ke Kerja hanya memuat grant yang dicabut", () => {
    const diff = grantDiff(TIER_GRANTS.tulis, TIER_GRANTS.kerja);
    expect(diff.removed).toEqual(["sessions:write"]);
    expect(diff.added).toEqual([]);
  });

  it("selisih naik dari Lihat ke Kerja hanya memuat grant yang ditambahkan", () => {
    const diff = grantDiff(TIER_GRANTS.lihat, TIER_GRANTS.kerja);
    expect([...diff.added].sort()).toEqual(["backlog:write", "sessions:spawn"]);
    expect(diff.removed).toEqual([]);
  });
});

describe("konfirmasi", () => {
  it("naik ke grant berisiko selalu perlu konfirmasi", () => {
    expect(needsConfirm(grantDiff(TIER_GRANTS.lihat, TIER_GRANTS.kerja))).toBe(true);
    expect(needsConfirm(grantDiff(TIER_GRANTS.kerja, TIER_GRANTS.tulis))).toBe(true);
  });

  it("menurunkan tingkat juga perlu konfirmasi karena ada yang dicabut", () => {
    expect(needsConfirm(grantDiff(TIER_GRANTS.tulis, TIER_GRANTS.kerja))).toBe(true);
  });

  it("menambah grant baca saja tidak perlu konfirmasi (kosong → Lihat)", () => {
    expect(needsConfirm(grantDiff([], TIER_GRANTS.lihat))).toBe(false);
  });

  it("Kerja dan Tulis adalah tingkat berisiko; Lihat tidak", () => {
    expect(isRiskyTier("lihat")).toBe(false);
    expect(isRiskyTier("kerja")).toBe(true);
    expect(isRiskyTier("tulis")).toBe(true);
  });
});
