/* Filter "Ber-worktree" dan "Perlu ditinjau" di Backlog (ADR-0214 · frontend-implementation § Backlog).

   "Ber-worktree": predikat `baseSha` terisi. Server (scheduler/queue.ts, kolomnya sejak ADR-0030)
   memakainya untuk "apakah hanoman pernah membuatkan worktree". Ia TIDAK berarti worktree-nya masih ada:
   `DELETE /specs/:id/worktree` (ADR-0213) dan integrasi tidak menyentuh `baseSha`. Item yang selesai
   sebelum ADR-0030 atau dikerjakan di checkout lain tetap `null` walau pernah dikerjakan.

   "Perlu ditinjau": item yang sesinya SEDANG menunggu jawaban manusia. Kondisinya sama dengan
   "Menunggu jawabanmu" di Overview dan pet (`sessionKind` = "waiting", sesi hidup). Layar Backlog tak
   menerima daftar sesi, jadi himpunan id-nya dihitung di App.tsx (`reviewSpecIds`).
   Klausa "stage done + baseSha" sengaja TIDAK dipakai: `baseSha` tak berarti worktree masih ada (lihat
   di atas), dan status tinjau/integrasi tak tercatat di server. Item selesai akan tampil "perlu
   ditinjau" padahal sudah diintegrasikan atau worktree-nya sudah dihapus. Tinjauan diff tetap lewat
   aksi "Review perubahan" pada item. */
import type { TerminalSession } from "../api/client";
import { REVIEW_SCOPE_LABEL, WORKTREE_SCOPE_LABEL } from "../lib/labels";
import { sessionKind } from "./pet-state";

export type WorktreeScope = "all" | "worktree";

export const WORKTREE_SCOPE_OPTS: readonly { value: WorktreeScope; label: string }[] = [
  { value: "all", label: WORKTREE_SCOPE_LABEL.all },
  { value: "worktree", label: WORKTREE_SCOPE_LABEL.worktree },
];

/** Pernah dibuatkan worktree oleh hanoman. `undefined` (respons lama) dihitung tidak. */
export const hasWorktree = (s: { baseSha?: string | null }): boolean => Boolean(s.baseSha);

export function scopeByWorktree<T extends { baseSha?: string | null }>(
  items: readonly T[], scope: WorktreeScope,
): readonly T[] {
  return scope === "all" ? items : items.filter(hasWorktree);
}

export type ReviewScope = "all" | "review";

export const REVIEW_SCOPE_OPTS: readonly { value: ReviewScope; label: string }[] = [
  { value: "all", label: REVIEW_SCOPE_LABEL.all },
  { value: "review", label: REVIEW_SCOPE_LABEL.review },
];

const NO_DONE_SPECS: ReadonlySet<string> = new Set<string>();

/** Id item yang sesinya menunggu jawaban manusia. Memakai `sessionKind` (klasifikasi tunggal pet-state,
 *  juga dipakai sel Terminal). Sesi yang sudah berakhir dan sesi yang sedang diputuskan lead tidak ikut.
 *  `NO_DONE_SPECS` tak mengubah hasil untuk "waiting": cabang itu diuji sebelum status item selesai. */
export function reviewSpecIdsOf(sessions: readonly TerminalSession[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const s of sessions) {
    if (s.specId && sessionKind(s, NO_DONE_SPECS) === "waiting") ids.add(s.specId);
  }
  return ids;
}

export function scopeByReview<T extends { id: string }>(
  items: readonly T[], scope: ReviewScope, reviewSpecIds: ReadonlySet<string>,
): readonly T[] {
  return scope === "all" ? items : items.filter((s) => reviewSpecIds.has(s.id));
}
