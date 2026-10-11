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
  // ADR-0193 · bot token Telegram (`<angka>:<35+ karakter>`). Bentuknya tetap, jadi disensor lewat
  // pola juga — nilai yang kebetulan lewat di galat/stderr tak boleh bocor hanya karena bukan
  // argumen panggilan ini.
  return redactCredentialFields(out.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, MASK));
}

/**
 * ADR-0193..0195 · menyensor rahasia yang DIKIRIM pemanggil pada panggilan ini (password akun klien,
 * bot token) dari teks keluar. Nilainya diambil dari argumen yang ditandai `secretArgs` di katalog.
 * Nilai terlalu pendek diabaikan: menyensor "ab" akan merusak teks lain, dan password sah minimal 8.
 * Rahasia yang dibangkitkan SERVER (secret webhook sekali-tampil) tidak lewat sini — itu hasil yang
 * memang harus sampai ke pemanggil.
 */
export function redactSecrets(text: string, values: readonly string[]): string {
  let out = text;
  for (const v of values) if (v.length >= 4) out = out.split(v).join(MASK);
  return out;
}

/** Nilai string dari argumen yang ditandai rahasia oleh `tool.secretArgs`. */
export function secretValues(
  secretArgs: readonly string[] | undefined, args: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const k of secretArgs ?? []) {
    const v = args[k];
    if (typeof v === "string" && v !== "") out.push(v);
  }
  return out;
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
