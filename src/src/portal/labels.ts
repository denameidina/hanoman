// Audit UI/UX 2026-10 (Portal & Public): satu map untuk kosakata yang dibaca klien. Kategori dan
// prioritas tak pernah tampil sebagai enum mentah ("bug", "tinggi"); nilai yang tak dikenal jatuh
// ke teksnya sendiri, bukan ke layar kosong. ID internal (SPEC-nnn) tak punya label — ia disembunyikan.
export const KATEGORI_LABEL: Record<string, string> = {
  bug: "Ada masalah",
  fitur: "Permintaan fitur",
  pertanyaan: "Pertanyaan",
  lainnya: "Lainnya",
};

export const PRIORITAS_LABEL: Record<string, string> = {
  tinggi: "Prioritas tinggi",
  sedang: "Prioritas sedang",
  rendah: "Prioritas rendah",
};

export const kategoriLabel = (v: string): string => KATEGORI_LABEL[v] ?? v;
export const prioritasLabel = (v: string): string => PRIORITAS_LABEL[v] ?? v;

/** Pesan galat jaringan (fetch gagal) bukan kalimat untuk klien: ganti dengan langkah berikutnya. */
export function jaringanAtauPesan(e: unknown, fallback: string): string {
  if (e instanceof TypeError) return "Tidak bisa terhubung ke server. Periksa koneksi, lalu coba lagi.";
  const m = e instanceof Error ? e.message.trim() : "";
  return m || fallback;
}
