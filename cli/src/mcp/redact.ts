// SPEC-482 · ADR-0099 · satu titik keluar untuk redaksi token. Dipasang di SEMUA teks yang
// meninggalkan proses (hasil tool, pesan galat, stderr) — bukan di tiap call site. SPEC-472
// membuktikan sekali cukup untuk gagal: pesan `execFile` memuat argv, dan argv memuat rahasia.
const MASK = "«token disembunyikan»";

export function redactToken(text: string, token: string): string {
  // `split`/`join` alih-alih regex: token bisa memuat karakter yang bermakna di regex, dan
  // meng-escape-nya adalah langkah yang mudah dilupakan saat kode ini disalin.
  let out = token.length > 0 ? text.split(token).join(MASK) : text;
  // Bentuknya juga, bukan hanya nilainya: token instance LAIN yang kebetulan lewat tetap rahasia.
  out = out.replace(/hnm_agt_[A-Za-z0-9_-]+/g, MASK);
  return redactCredentialFields(out);
}

/**
 * ADR-0196 · hasil sukses tool yang `revealsSecret` (cetak agent/device token): kredensial BARU yang
 * dikembalikan REST sekali-tampil harus sampai ke pemanggil, jadi topeng pola `hnm_agt_…` tidak
 * dipasang. Yang TETAP disembunyikan: token konfigurasi proses MCP ini dan field password.
 */
export function redactKeepingFresh(text: string, token: string): string {
  const out = token.length > 0 ? text.split(token).join(MASK) : text;
  return redactCredentialFields(out);
}

/**
 * Field kredensial berbentuk JSON (`"password":"…"`, `newPassword`, `passwordHash`) disensor di
 * semua keluaran. Tool admin menerima password di ARGUMEN, dan galat server kadang memantulkan
 * bentuk request; satu regex di titik keluar lebih murah daripada mengingat tiap call site.
 */
function redactCredentialFields(text: string): string {
  return text.replace(/("(?:password|newPassword|currentPassword|passwordHash)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, `$1"${MASK}"`);
}
