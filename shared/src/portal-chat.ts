import { z } from "zod";

// SPEC-854 · ADR-0129 · kontrak chat portal klien. Hidup di modul DAUN (hanya zod) supaya
// `entities.ts` bisa mengimpornya tanpa menutup siklus modul — jebakan yang sudah dibayar
// `agent-engine.ts`.

export const PORTAL_CHAT_TYPES = ["brainstorm", "tanya"] as const;
export const zPortalChatType = z.enum(PORTAL_CHAT_TYPES);
export type PortalChatType = (typeof PORTAL_CHAT_TYPES)[number];

/** Bentuk keluaran agen. Ia SATU-SATUNYA jalan balik dari runtime ke hanoman. */
export const zAgentReply = z.object({
  balasan: z.string(),
  keluar_topik: z.boolean(),
  prd_siap: z.boolean(),
  prd: z.string().nullable(),
  ringkasan: z.string(),
});
export type AgentReply = z.infer<typeof zAgentReply>;

/**
 * Cermin `zAgentReply` untuk `claude --json-schema`. Ditulis tangan, bukan digenerate:
 * `additionalProperties: false` adalah gerbangnya, dan generator zod→JSON Schema tak menjamin
 * itu. `portal-chat.test.ts` mengadu daftar kuncinya ke zod di atas.
 */
export const PORTAL_CHAT_REPLY_SCHEMA = {
  type: "object",
  properties: {
    balasan: { type: "string" },
    keluar_topik: { type: "boolean" },
    prd_siap: { type: "boolean" },
    prd: { type: ["string", "null"] },
    ringkasan: { type: "string" },
  },
  required: ["balasan", "keluar_topik", "prd_siap", "prd", "ringkasan"],
  additionalProperties: false,
} as const;

/**
 * Kalimat yang dilihat klien saat hanoman TIDAK meneruskan prosa agen. Dikarang server, bukan
 * agen: kalau teks penolakan boleh datang dari agen, pesan yang disusupi bisa mengarang
 * penolakannya sendiri — dan itu persis jalur yang ditutup huruf E.
 */
export const TEKS_TETAP = {
  keluarTopik:
    "Maaf, obrolan ini khusus untuk ide dan pertanyaan seputar project Anda. Boleh kita kembali ke sana? Ceritakan saja apa yang ingin Anda capai.",
  diblokir:
    "Maaf, jawaban tadi tidak bisa saya tampilkan apa adanya. Boleh Anda ulangi pertanyaannya dengan kata-kata lain? Tim akan melihat percakapan ini juga.",
  gagal:
    "Maaf, saya belum bisa menjawab sekarang. Coba beberapa saat lagi ya — pesan Anda sudah tersimpan.",
  kuotaHabis:
    "Jatah obrolan project ini untuk bulan ini sudah terpakai semua. Jatahnya akan kembali penuh pada tanggal reset di bawah.",
} as const;

export type PortalChatMessageView = {
  id: string; seq: number; role: "klien" | "hanoman"; text: string; createdAt: string;
};
export type PortalChatSessionView = {
  id: string; type: PortalChatType; summary: string; prdSiap: boolean;
  createdAt: string; updatedAt: string;
};
export type PortalChatQuotaView = {
  enabled: boolean;
  brainstorm: { terpakai: number; jatah: number; sisa: number };
  tanya: { terpakai: number; jatah: number; sisa: number };
  resetPada: string;
};

/** Ember kuota = bulan UTC. UTC, bukan waktu mesin: reset harus sama di hub dan di client. */
export const periodKeyOf = (now: Date): string =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

/** Awal periode BERIKUTNYA — yang dibaca klien sebagai "jatah kembali penuh pada". */
export function nextResetOf(periodKey: string): Date {
  const [y, m] = periodKey.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
}
