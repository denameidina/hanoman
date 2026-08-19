import { randomBytes } from "node:crypto";

// SPEC-854 · ADR-0129 · LAPIS 1. Pesan klien adalah BAHAN yang dibicarakan, bukan perintah yang
// dituruti. Yang menegakkan itu bukan kalimat di system prompt melainkan BENTUKNYA: pesan hidup
// di dalam satu blok berbatas ber-nonce acak, dan penanda batas yang muncul di dalam pesan
// dijinakkan sehingga klien tak punya cara menutup bloknya sendiri.
//
// Nonce acak per giliran, bukan penanda tetap: penanda tetap ada di dalam jangkauan tebakan
// siapa pun yang pernah melihat produk ini, dan menebaknya sekali cukup untuk keluar.

export const MAX_PESAN = 4000;

export const newNonce = (): string => randomBytes(4).toString("hex");

/** Karakter kontrol dibuang (newline & tab tetap), lalu dipotong pada batas panjang. */
export function sanitizeClientText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, MAX_PESAN);
}

/**
 * Bungkus pesan klien jadi satu blok bahan. Penanda batas yang diketik klien disisipi spasi
 * lebar-nol sehingga ia tetap TERBACA sebagai teks — operator perlu melihat apa yang sebenarnya
 * ditulis klien — tetapi tak lagi cocok dengan penanda asli.
 */
export function wrapClientMessage(text: string, nonce: string): string {
  const open = `<pesan-klien-${nonce}>`;
  const close = `</pesan-klien-${nonce}>`;
  const jinak = sanitizeClientText(text)
    .replaceAll("</pesan-klien", "<\u200B/pesan-klien")
    .replaceAll("<pesan-klien", "<\u200Bpesan-klien");
  return `${open}\n${jinak}\n${close}`;
}
