import { describe, expect, it } from "vitest";
import { TELEGRAM_REQUIRED_CAPABILITIES } from "../src/services/telegram/bootstrap";
import { verifyTelegramAgentToken } from "../src/services/telegram/credentials";

const DANGER = ["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"] as const;

// ADR-0155 · gateway Telegram menjalankan pekerjaan operator PENUH, termasuk membuka sesi. Karena
// keempat capability berbahaya dipecah dari `:write`, token gateway lama berhenti mencukupi — dan
// `credentials.ts` menolak MENYALAKAN gateway bila satu pun kurang, bukan menolak per-panggilan.
// Itu kelas kegagalan SPEC-491 ("Telegram diam total"), jadi test ini menjaga dua hal: keempatnya
// memang wajib, DAN kekurangannya dilaporkan dengan nama, bukan diam.
describe("gateway Telegram menuntut capability berbahaya", () => {
  it("keempatnya wajib", () => {
    for (const c of DANGER) expect(TELEGRAM_REQUIRED_CAPABILITIES as readonly string[]).toContain(c);
  });

  it("token gateway lama ditolak dengan daftar yang kurang, bukan diam", async () => {
    const lama = TELEGRAM_REQUIRED_CAPABILITIES.filter((c) => !(DANGER as readonly string[]).includes(c));
    const gate = await verifyTelegramAgentToken("hnm_agt_lama", {
      verify: async () => ({ id: "t1", capabilities: [...lama] }),
    });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.missing).toEqual(expect.arrayContaining([...DANGER]));
    expect(gate.ok === false && gate.reason).toMatch(/kurang 4 capability/);
  });

  it("token lengkap lolos", async () => {
    const gate = await verifyTelegramAgentToken("hnm_agt_baru", {
      verify: async () => ({ id: "t1", capabilities: [...TELEGRAM_REQUIRED_CAPABILITIES] }),
    });
    expect(gate.ok).toBe(true);
  });
});
