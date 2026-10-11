/* Filter "Ber-worktree" di Backlog (ADR-0214 · frontend-implementation § Backlog, filter worktree).

   Mengapa bukan "Perlu ditinjau": Spec.stage berhenti di `done` (tak ada tahap tinjauan), status
   integrasi tak tercatat di SpecSlim, dan keputusan sesi "menunggu manusia" (SessionDTO.decision)
   tak sampai ke layar ini — layar hanya menerima `activeSpecs` (id yang punya sesi hidup). Predikat
   "perlu ditinjau" yang jujur tak bisa diturunkan dari data klien yang ada, jadi filter ini menyebut
   apa yang benar-benar diketahui.

   Predikat: `baseSha` terisi. Server (scheduler/queue.ts, kolomnya sejak ADR-0030) memakainya untuk
   "apakah hanoman pernah membuatkan worktree". Ia TIDAK berarti worktree-nya masih ada. Item yang
   selesai sebelum ADR-0030 atau dikerjakan di checkout lain tetap `null` walau pernah dikerjakan. */
import { WORKTREE_SCOPE_LABEL } from "../lib/labels";

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
