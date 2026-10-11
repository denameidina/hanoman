// Pencocokan fuzzy untuk palet perintah (Audit UI/UX 2026-10 · Fase 2C). Murni: tanpa React, tanpa DOM.
//
// Aturan: kueri dipecah per spasi dan SETIAP kata wajib ditemukan di teks. Huruf besar/kecil dan
// diakritik diabaikan. Kata yang muncul utuh sebagai substring selalu mengalahkan kecocokan
// berpencar; di antara kecocokan berpencar, karakter yang berurutan dan yang mulai di awal kata
// memberi skor lebih tinggi, celah di antaranya mengurangi skor.

const BOUNDARY = /[\s\-_./:·>|()[\]]/;

export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function atWordStart(hay: string, i: number): boolean {
  return i === 0 || BOUNDARY.test(hay[i - 1]!);
}

function tokenScore(token: string, hay: string): number | null {
  const at = hay.indexOf(token);
  // Substring utuh: 1000 + bonus awal-kata − posisi. Selalu di atas skor berpencar (≤ ~8 per huruf).
  if (at >= 0) return 1000 + (atWordStart(hay, at) ? 100 : 0) - Math.min(at, 99);

  let pos = 0;
  let prev = -2;
  let first = -1;
  let score = 0;
  for (const ch of token) {
    const i = hay.indexOf(ch, pos);
    if (i < 0) return null;
    if (first < 0) first = i;
    score += 1;
    if (i === prev + 1) score += 3;
    if (atWordStart(hay, i)) score += 4;
    prev = i;
    pos = i + 1;
  }
  const gaps = prev - first + 1 - token.length;
  return Math.max(1, score - Math.min(gaps, 20));
}

/**
 * Skor kecocokan `query` terhadap `text`, atau `null` bila ada kata yang tak ditemukan.
 * Kueri kosong = 0 (cocok dengan apa pun, tanpa urutan khusus).
 */
export function fuzzyScore(query: string, text: string): number | null {
  const tokens = normalizeText(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const hay = normalizeText(text);
  let total = 0;
  for (const token of tokens) {
    const s = tokenScore(token, hay);
    if (s === null) return null;
    total += s;
  }
  return total;
}
