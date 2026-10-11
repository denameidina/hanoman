// Audit UI/UX 2026-10 · Fase 3 (3M) · linimasa keluhan klien. Fungsi murni: status publik tiket
// (`publicStatus()`, SPEC-293) → posisi di empat langkah yang dibaca klien (Diterima → Ditinjau →
// Dikerjakan → Selesai). Tak ada status, endpoint, atau kolom baru: hanya status yang sudah ada.
//
// Urutannya mengikuti kosakata klien, bukan urutan kolom server. "Sedang ditinjau" berarti laporan
// sudah masuk dan langkah Ditinjau sedang berjalan; "Diterima" berarti tinjauan sudah lewat dan
// laporan menunggu giliran dikerjakan. Keduanya berbagi langkah ketiga sebagai "sedang".

export const TIMELINE_STEPS = ["Diterima", "Ditinjau", "Dikerjakan", "Selesai"] as const;

/** done = sudah lewat · current = sedang berjalan · pending = belum · closed = dihentikan di langkah ini. */
export type StepState = "done" | "current" | "pending" | "closed";
export type TimelineStep = { label: string; state: StepState };

function withStates(states: Partial<Record<number, StepState>>): TimelineStep[] {
  return TIMELINE_STEPS.map((label, i) => ({ label, state: states[i] ?? "pending" }));
}

/**
 * Empat langkah dengan keadaannya untuk satu status publik. Status yang tak dikenal (server kelak
 * menambah kosakata) hanya menandai langkah pertama sebagai sudah diterima — tak pernah menebak
 * langkah lanjutannya, dan tak pernah melempar.
 */
export function ticketTimeline(status: string): TimelineStep[] {
  switch (status) {
    case "Sedang ditinjau": return withStates({ 0: "done", 1: "current" });
    case "Diterima": return withStates({ 0: "done", 1: "done", 2: "current" });
    case "Sedang dikerjakan": return withStates({ 0: "done", 1: "done", 2: "current" });
    case "Selesai": return withStates({ 0: "done", 1: "done", 2: "done", 3: "done" });
    case "Ditutup": return withStates({ 0: "done", 1: "closed" });
    default: return withStates({ 0: "done" });
  }
}

/** Satu kalimat yang menjawab "bagaimana masalah saya sekarang?" untuk status ini. */
export function ticketNote(status: string): string {
  switch (status) {
    case "Sedang ditinjau": return "Laporan sudah masuk dan sedang ditinjau tim. Belum ada yang perlu Anda lakukan.";
    case "Diterima": return "Laporan diterima dan menunggu giliran dikerjakan.";
    case "Sedang dikerjakan": return "Tim sedang mengerjakan perbaikannya.";
    case "Selesai": return "Sudah selesai dikerjakan.";
    case "Ditutup": return "Laporan ini tidak dilanjutkan. Kirim laporan baru bila masalahnya masih terjadi.";
    default: return `Status laporan: ${status}.`;
  }
}
