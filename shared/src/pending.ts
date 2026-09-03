// SPEC-961 · "apa lagi yang butuh pengajuan?" — satu angka per permukaan nav.
//
// Definisinya sengaja hidup DI SINI, bukan di server: sidebar merender angkanya, tetapi yang
// membuat angka itu berarti adalah kesepakatan tentang apa yang dihitung. Menaruhnya di satu
// modul yang dibaca kedua sisi membuat "belum diputuskan" tak bisa berarti dua hal berbeda di
// server dan di tampilan (kelas drift yang sama yang ditutup `ticket-status.ts` & `prd-status.ts`).
//
// Nilai turunan penuh (ADR-0011/0018): tak ada kolom, tak ada tabel, tak ada cache durable —
// keempatnya bisa dihitung ulang kapan saja dari baris yang sudah ada.

/**
 * Jumlah item yang masih menunggu pengajuan/keputusan operator, per permukaan nav.
 *
 * - `triage`  — tiket Help Center + issue GitHub berstatus `new` (belum accept/reject).
 * - `backlog` — `Spec` yang belum pernah punya sesi (`startedAt === null`) dan belum `done`.
 * - `prd`     — PRD berstatus `draft` (belum melahirkan satu pun backlog, lihat `prd-status.ts`).
 * - `lead`    — rantai `LeadFlow` yang masih terbuka (`menunggu` / `sebagian`).
 */
export type PendingCounts = { triage: number; backlog: number; prd: number; lead: number };

export const EMPTY_PENDING: PendingCounts = { triage: 0, backlog: 0, prd: 0, lead: 0 };

// Status `LeadFlow` yang berarti "rantainya belum tuntas". Cermin kosakata schema.prisma
// (`menunggu | sebagian | selesai | dibatalkan`) — dua yang terakhir bukan pekerjaan siapa pun lagi.
export const OPEN_LEAD_FLOW_STATUSES = ["menunggu", "sebagian"] as const;

/**
 * Total lintas permukaan. Dipakai untuk judul/aria-label ("N butuh pengajuan"), BUKAN untuk
 * memutuskan apakah sebuah badge muncul — tiap badge menghakimi angkanya sendiri.
 */
export function pendingTotal(c: PendingCounts): number {
  return c.triage + c.backlog + c.prd + c.lead;
}

/**
 * Angka yang berhak dipakai badge sebuah entri nav — `undefined` bila entri itu memang tak punya
 * angka, atau angkanya nol. Nol TIDAK dirender: badge "0" membuat sidebar berisik justru saat tak
 * ada yang perlu dikerjakan, dan pembaca harus membedakan "nol" dari "belum tahu" setiap kali.
 */
export function pendingFor(counts: PendingCounts | null, navKey: string): number | undefined {
  if (!counts) return undefined;                       // server lama tak mengirim frame ini (ADR-0087)
  const n = (counts as Record<string, unknown>)[navKey];
  return typeof n === "number" && n > 0 ? n : undefined;
}

/** Label ringkas > 99 supaya lebar badge tak menggeser layout sidebar. */
export function pendingLabel(n: number): string {
  return n > 99 ? "99+" : String(n);
}
