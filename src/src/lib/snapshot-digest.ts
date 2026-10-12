// Audit UI/UX 2026-10 · frame siar snapshot (`sessions`, `leadAsks`, `pending`, ...) dikirim utuh
// tiap connect dan tiap kali grupnya berubah — sering isinya sama persis dengan yang sudah tampil.
// Helper ini membandingkan ISI, bukan referensi, supaya frame identik tak menyentuh state dan tak
// me-render ulang App (dan HanomanPet/modal yang ada di dalamnya).

/** Sidik jari generik: JSON. Cukup untuk frame yang bentuk & urutan kuncinya tetap (dikirim server). */
export const digestOf = (value: unknown): string => JSON.stringify(value) ?? "";

/**
 * Terapkan `next` lewat `set` HANYA bila isinya berbeda dari `shown` (nilai yang sedang ditampilkan).
 * Mengembalikan `true` bila `set` dipanggil. `shown` sebaiknya dibaca dari ref yang diperbarui tiap
 * render, sehingga perubahan lokal (optimistik) ikut terhitung.
 */
export function applyIfChanged<T>(
  shown: T, next: T, set: (value: T) => void, digest: (value: T) => string = digestOf,
): boolean {
  if (digest(shown) === digest(next)) return false;
  set(next);
  return true;
}
