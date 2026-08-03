// SPEC-516 · ADR-0105 · buang jejak teknis dari teks changelog. MURNI — nol I/O, nol Prisma.
//
// Dipakai DUA kali: pada INPUT (sebelum agen melihatnya) dan pada OUTPUT (jaring kedua). Yang
// pertama yang menentukan: cara paling kuat mencegah kebocoran teknis adalah tak pernah
// menyerahkannya. Subject conventional-commit dan objective backlog adalah dua sumber yang
// terbukti memuat nama berkas, hash, dan nomor SPEC.

const MERGE = /^merge\s+(branch|pull request|remote-tracking branch|tag)\b/i;
const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\([^)]*\))?!?:\s*/i;
// `a/b/c.ts`, `internal/docs/README.md` — minimal satu segmen direktori + ekstensi.
const PATH_LIKE = /(?:[\w.@-]+\/)+[\w.-]+\.\w{1,6}/g;
// Hash commit: 7–40 hex. Wajib memuat setidaknya satu DIGIT **dan** satu huruf a–f. Tanpa syarat
// digit, kata seperti "decade" ikut terbuang; tanpa syarat huruf, "1000000" pada "naikkan batas ke
// 1000000 baris" ikut terbuang. Sha 7-karakter yang kebetulan seluruhnya angka atau seluruhnya
// huruf praktis tak ada, dan `scrubOutput` masih jadi jaring keduanya.
const HEX = /\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
const INTERNAL_REF = /\b(?:SPEC|ADR|PR|ISSUE)[-\s]?\d+\b/gi;
// camelCase: butuh ≥2 huruf kecil sebelum kapital DAN ≥2 huruf kecil sesudahnya — "macOS"/"iOS"
// karena itu selamat, "macOptionClickForcesSelection" tidak.
const CAMEL = /\b[a-z]{2,}(?:[A-Z][a-z]{2,})+\b/g;
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi;
const CALL = /\b[A-Za-z_][\w.]*\(\s*\)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const FENCE = /^```[\s\S]*?^```$/gm;
const TRAILER = /^[A-Za-z-]+:\s.*$/gm;   // Co-Authored-By:, Signed-off-by:, Refs:

// Urutan mengikat: kurung yang jadi kosong dibuang DULU, baru spasi dirapatkan — kebalikannya
// meninggalkan spasi ganda di tengah kalimat. Titik/koma sengaja TIDAK ikut dipangkas di ujung
// kanan: kalimat prosa yang sah berakhir dengan titik.
const tidy = (s: string): string =>
  s.replace(/\(\s*\)/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s:;,·—–-]+/, "")
    .replace(/[\s:;,·—–-]+$/, "")
    .trim();

function strip(s: string): string {
  return s
    .replace(INLINE_CODE, " ")
    .replace(PATH_LIKE, " ")
    .replace(CALL, " ")
    .replace(HEX, " ")
    .replace(INTERNAL_REF, " ")
    .replace(CAMEL, " ")
    .replace(SNAKE, " ");
}

/** Satu baris judul (subject commit / judul backlog). Commit merge → string kosong: ia bukan
 *  perubahan yang berarti bagi pemakai, dan pemanggil membuang butir kosong. */
export function scrubSubject(s: string): string {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
  if (!one || MERGE.test(one)) return "";
  return tidy(strip(one.replace(CONVENTIONAL, "")));
}

/** Badan commit / objective backlog: ambil PARAGRAF PERTAMA saja (sisanya lazimnya detail
 *  teknis & trailer), lalu scrub dengan aturan yang sama. */
export function scrubBody(s: string): string {
  const first = (s ?? "").replace(TRAILER, "").split(/\n\s*\n/)[0] ?? "";
  return tidy(strip(first.replace(/\s+/g, " ").trim()));
}

/** Jaring kedua atas markdown keluaran agen. Blok kode dibuang UTUH — sebuah changelog untuk
 *  pemakai tak pernah punya alasan memuatnya — sementara judul & butir dipertahankan. */
export function scrubOutput(md: string): string {
  const noFence = (md ?? "").replace(FENCE, "");
  const lines = noFence.split("\n").map((line) => {
    const m = /^(\s*(?:[-*+]|\d+\.)\s+|\s*#{1,6}\s+|\s*>\s*)?(.*)$/.exec(line);
    const lead = m?.[1] ?? "";
    const rest = m?.[2] ?? line;
    const cleaned = tidy(strip(rest));
    // Baris yang isinya habis di-scrub dibuang seluruhnya berikut penandanya — butir kosong
    // (`- `) atau judul tanpa teks lebih mengganggu daripada tak ada baris sama sekali.
    return cleaned ? `${lead}${cleaned}` : "";
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
