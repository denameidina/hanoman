import { createHmac, timingSafeEqual } from "node:crypto";
import { secretKey } from "./secret-box";

// SPEC-909 · ADR-0146 · kredensial hook sesi.
//
// TURUNAN, bukan acak-lalu-disimpan, dan itu keputusan yang membeli tiga hal sekaligus: tak ada
// registry yang harus dihidrasi ulang sesudah restart server, tak ada round-trip tmux di jalur
// panas (`execFileSync` tmux memblokir event loop — SPEC-856/860/878), dan sesi yang lahir sebelum
// restart tetap bisa mengirim event.
//
// Sub-kunci, bukan `secretKey()` langsung: kunci itu juga dipakai enkripsi at-rest RuntimeConfig
// (ADR-0097), dan satu kunci untuk dua kegunaan adalah cara termurah membuat kebocoran di satu
// sisi jadi kebocoran di sisi lain.
const SUBKEY_LABEL = "hanoman:session-event:v1";

const subkey = (): Buffer => createHmac("sha256", secretKey()).update(SUBKEY_LABEL).digest();

export function sessionEventToken(sessionId: string): string {
  return createHmac("sha256", subkey()).update(sessionId).digest("base64url");
}

/**
 * Batas yang dinyatakan apa adanya: token ini membuktikan "pengirim tahu rahasia milik sesi ini",
 * bukan "pengirim ADALAH sesi ini". Semua sesi di mesin ini berjalan sebagai uid yang sama, jadi
 * tetangga yang memang berniat bisa membacanya dari env prosesnya — batas yang sama yang sudah
 * diterima ADR-0037. Yang ditutup di sini: pemanggil tanpa kredensial apa pun, dan pemalsuan yang
 * cuma bermodal tahu id sesi.
 */
export function verifySessionEventToken(sessionId: string, given: string): boolean {
  const want = Buffer.from(sessionEventToken(sessionId));
  const got = Buffer.from(given);
  // Panjang dibandingkan lebih dulu: `timingSafeEqual` MELEMPAR untuk panjang berbeda, dan token
  // kita selalu sama panjang — jadi selisih panjang bukan informasi rahasia.
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}
