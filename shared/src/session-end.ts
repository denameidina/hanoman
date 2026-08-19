// SPEC-844 · ADR-0125 · CARA sebuah baris riwayat sesi ditutup — satu-satunya fakta di sini yang
// tak bisa dihitung ulang dari kolom lain. Kelas hasilnya DITURUNKAN (`sessionOutcome`):
// `completed`/`failed` sudah terbaca dari `exitCode`, dan menyimpannya dua kali membuat dua sumber
// yang bisa berselisih (ADR-0011/0018; arah yang sama dengan ADR-0090).
export const SESSION_END_REASONS = ["closed", "reconciled"] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export const SESSION_OUTCOMES = ["running", "completed", "failed", "interrupted"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

// `endedReason` dibaca LONGGAR: kolomnya `String?`, baris sebelum SPEC-844 null, dan nilai asing
// dari instance yang lebih baru tak boleh melempar di boundary. Semua yang bukan `reconciled`
// jatuh ke jalur `closed` — perilaku persis sebelum spec ini. Hanya `reconciled` memindahkan
// verdict, dan ia mengalahkan `exitCode`: pane yang lenyap tak meninggalkan kode untuk dipercaya.
export function sessionOutcome(r: {
  endedAt: string | null; endedReason?: string | null; exitCode: number | null;
}): SessionOutcome {
  if (!r.endedAt) return "running";
  if (r.endedReason === "reconciled") return "interrupted";
  return r.exitCode === null || r.exitCode === 0 ? "completed" : "failed";
}
