// ADR-0212 · urutan & penyaring "perlu perhatian" untuk daftar project, dihitung di SERVER lintas
// seluruh hasil (bukan per halaman). Memakai `docStatus` yang sudah ada di ProjectView; tak ada
// kolom atau perhitungan baru.
import type { ProjectView } from "@hanoman/shared";

type Attention = Pick<ProjectView, "docStatus">;

/** rusak (0) → drift (1) → sisanya (2). */
export function attentionRank(p: Attention): number {
  return p.docStatus === "broken" ? 0 : p.docStatus === "drift" ? 1 : 2;
}

/** Dokumen drift atau rusak butuh perhatian operator. */
export const needsAttention = (p: Attention): boolean => p.docStatus !== "ok";

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/**
 * Urutan TOTAL: rank perhatian, lalu nama (huruf kecil), lalu id. Karena totalnya tak menyisakan
 * seri, hasilnya sama setiap panggilan dan paginasi konsisten lintas halaman. Input tak diubah.
 */
export function sortByAttention<T extends Pick<ProjectView, "id" | "name" | "docStatus">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) =>
    attentionRank(a) - attentionRank(b)
    || cmp(a.name.toLowerCase(), b.name.toLowerCase())
    || cmp(a.id, b.id));
}

/**
 * Parameter boolean di query: kosong/tak ada → false; "1"/"true" → true; "0"/"false" → false.
 * Nilai lain → null (pemanggil menjawab 400). Server tak menebak maksudnya.
 */
export function boolParam(v: string | undefined): boolean | null {
  if (v === undefined || v === "") return false;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return null;
}
