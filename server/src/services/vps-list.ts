// ADR-0211 · daftar VPS untuk `GET /vps` DAN siaran grup `vps` (services/events.ts). Satu fungsi,
// dua pintu: dulu keduanya menyusun `prisma.vps.findMany` sendiri-sendiri, dan setiap bentuk baru
// wajib diubah dua kali — skor yang hanya ada di satu jalur akan hilang setiap kali siaran datang.
import { prisma } from "../db";
import { latestScores } from "../vps/checklist";

/**
 * Setiap baris membawa `scoreTotal` dari `latestScores` — hitungan yang sama dengan checklist, dari
 * snapshot audit yang TERSIMPAN. Listing tak pernah menjalankan audit. `null` = belum pernah diaudit.
 */
export async function listVpsWithScore() {
  const rows = await prisma.vps.findMany({ orderBy: { createdAt: "asc" } });
  const skor = await latestScores(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, scoreTotal: skor.get(r.id) ?? null }));
}
