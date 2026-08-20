// SPEC-856 · echo prediktif lokal. Seluruh logikanya murni supaya rekonsiliasi bisa diuji tanpa
// tmux dan tanpa layout engine: komponen menyuplai pandangan layar sebagai data (lihat `View`).
//
// Invarian keselamatan yang menopang seluruh modul ini: begitu satu byte pun datang dari pty,
// prediksi di-rollback SEBELUM byte itu ditulis, dalam SATU panggilan `term.write`. Layar sesudah
// setiap frame server karena itu byte-identik dengan layar tanpa prediksi — prediksi paling buruk
// hanya salah selama < 1 RTT lalu hilang tanpa sisa.

export type InputKind = "text" | "control" | "bulk";

/** Kontrol C0/C1 dan DEL: apa pun di sini tak pernah diprediksi dan tak pernah di-batch. */
const CONTROL = /[\x00-\x1f\x7f]/;

export function classifyInput(d: string): InputKind {
  if (!d || CONTROL.test(d)) return "control";
  return [...d].length > 1 ? "bulk" : "text";
}

/** Underline saja: `\x1b[24m` mematikan underline TANPA menyentuh warna/latar, jadi SGR yang
 *  berlaku sesudah prediksi identik dengan sebelumnya — itu yang membuat `rollbackSeq` setia. */
export function applySeq(chars: string): string {
  return chars ? `\x1b[4m${chars}\x1b[24m` : "";
}

/** Mundur n kolom lalu hapus ke akhir baris. Setia hanya karena gerbang menjamin ekor baris di
 *  kanan kursor kosong — yang justru dipastikan `\x1b[K` milik TUI agen sendiri. */
export function rollbackSeq(n: number): string {
  return n > 0 ? `\x1b[${n}D\x1b[K` : "";
}
