import { describe, it, expect } from "vitest";
import {
  PORTAL_CHAT_TYPES, zAgentReply, PORTAL_CHAT_REPLY_SCHEMA, TEKS_TETAP,
  periodKeyOf, nextResetOf,
} from "./portal-chat";

describe("kontrak chat portal (SPEC-854)", () => {
  it("dua tipe sesi, tak lebih", () => {
    expect([...PORTAL_CHAT_TYPES]).toEqual(["brainstorm", "tanya"]);
  });

  it("keluaran agen tervalidasi; bentuk asing ditolak", () => {
    const ok = zAgentReply.safeParse({
      balasan: "Halo", keluar_topik: false, prd_siap: false, prd: null, ringkasan: "sapaan",
    });
    expect(ok.success).toBe(true);
    expect(zAgentReply.safeParse({ balasan: "Halo" }).success).toBe(false);
  });

  // Skema yang dikirim ke `--json-schema` harus additionalProperties:false — kalau tidak,
  // agen bisa menyelipkan field yang tak pernah dibaca siapa pun.
  it("skema JSON untuk CLI tertutup", () => {
    expect(PORTAL_CHAT_REPLY_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(PORTAL_CHAT_REPLY_SCHEMA.properties).sort())
      .toEqual(["balasan", "keluar_topik", "prd", "prd_siap", "ringkasan"]);
  });

  // Teks penolakan dikarang SERVER: pesan yang disusupi tak boleh bisa mengarang teksnya sendiri.
  it("teks tetap bebas istilah teknis", () => {
    for (const t of Object.values(TEKS_TETAP)) {
      expect(t).not.toMatch(/```|\/[a-z]+\/|\.ts\b|SELECT |Error:/i);
      expect(t.length).toBeGreaterThan(20);
    }
  });

  it("periode bulanan UTC dan tanggal resetnya", () => {
    expect(periodKeyOf(new Date("2026-08-19T23:30:00Z"))).toBe("2026-08");
    expect(periodKeyOf(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(nextResetOf("2026-12").toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(nextResetOf("2026-08").toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
