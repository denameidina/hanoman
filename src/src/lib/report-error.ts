// Audit UI/UX 2026-10 · kebijakan error: `.catch(() => {})` kosong dilarang kecuali untuk
// akses localStorage. Pesan galat dinormalisasi di satu tempat supaya toast/inline error selalu
// menyebut APA yang gagal + alasan singkatnya, bukan "Gagal" tanpa konteks.
export function errorMessage(err: unknown, fallback = "Terjadi kesalahan"): string {
  const m = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return m && m.trim() ? m.trim() : fallback;
}

/** "Gagal <aksi>: <alasan>" — dipakai toast `err` dan blok error inline. */
export function failureMessage(action: string, err: unknown): string {
  const reason = errorMessage(err, "");
  return reason ? `Gagal ${action}: ${reason}` : `Gagal ${action}`;
}
