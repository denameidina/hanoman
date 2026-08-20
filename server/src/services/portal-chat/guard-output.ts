import { TEKS_TETAP } from "@hanoman/shared";

// SPEC-854 · ADR-0129 · LAPIS 4 — dan lapis yang paling sering menyala.
//
// Ia ada karena diukur, bukan karena kehati-hatian umum. Pada pengukuran SPEC-854, agen yang
// SUDAH tak punya tool tulis dan SUDAH menolak seluruh percobaan keluar tetap memproduksi tiga
// hal yang dilarang huruf E di dalam prosanya sendiri: satu blok berpagar `bash`, satu path
// absolut workspace, dan alamat email operator yang datang dari system-reminder milik claude.
// Prompt tak bisa menutup satu pun dari ketiganya — hanya gerbang di sisi hanoman yang bisa.

const POLA: [RegExp, string][] = [
  [/```/, "blok-kode"],
  [/(^|\s)(\/[A-Za-z0-9._-]+){2,}\/?/, "path"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email"],
  [/\b[\w-]+\.(md|ts|tsx|js|json|sql|sh|yml|yaml|prisma|env|log)\b/i, "nama-berkas"],
  [/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|ALTER TABLE|JOIN)\b/, "istilah-teknis"],
  [/\b(tabel|table|database|schema|migration|endpoint|API|repository|repositori|commit|branch|deploy|backend|frontend|query|kolom|prisma|sqlite|json|http|url|cookie|token|regex|array|boolean|null|undefined)\b/i, "istilah-teknis"],
  [/\b(npm|pnpm|yarn|git|curl|docker|podman|ssh|sudo|cd|ls|cat|rm|chmod|mkdir)\s+[\w./-]/, "perintah"],
  [/\b[A-Z][A-Z0-9_]{3,}=/, "konfigurasi"],
  [/\n\s+at\s+\S|(^|\s)\w*Error:\s/m, "jejak-galat"],
];

/**
 * Dua tingkat, sengaja.
 *
 * **Redaksi** untuk yang bisa dijinakkan tanpa mengubah arti — span kode inline jadi teks biasa.
 * Memblokir seluruh balasan hanya karena satu backtick akan membuat gerbang ini menyala begitu
 * sering sehingga orang berikutnya melonggarkannya.
 *
 * **Tolak total** untuk sisanya. Balasan diganti kalimat karangan server; teks mentahnya tetap
 * disimpan pemanggil untuk dibaca operator. Menyaring sebagian dari balasan yang sudah terbukti
 * membocorkan sesuatu adalah menebak batas kebocoran — dan huruf E menyebut kebocoran sebagai
 * kegagalan total fitur, bukan cacat kecil.
 */
export function guardReply(
  text: string,
  o: { projectName: string; otherNames: string[] },
): { text: string; blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // Pola diadu ke teks MENTAH, redaksi hanya membentuk keluaran. Urutan ini mengikat: menjalankan
  // redaksi lebih dulu membuat span inline mengunyah pagar ``` (dua backtick pertama runtuh jadi
  // kosong) sehingga blok kode lolos justru karena dibersihkan.
  const redaksi = text.replace(/`([^`\n]*)`/g, "$1");

  if (!redaksi.trim()) reasons.push("kosong");
  for (const [pola, sebab] of POLA)
    if (pola.test(text) && !reasons.includes(sebab)) reasons.push(sebab);

  // Nama project lain dicocokkan case-insensitive pada batas kata, dan DILEWATI bila ia bagian
  // dari nama project klien sendiri — "Toko Mekar" tak boleh memblokir "Toko Mekar Jaya".
  const sendiri = o.projectName.toLowerCase();
  const bocor = o.otherNames.some((n) => {
    const l = n.toLowerCase();
    if (!l || sendiri.includes(l)) return false;
    return new RegExp(`(^|\\W)${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(text);
  });
  if (bocor) reasons.push("project-lain");

  return reasons.length
    ? { text: TEKS_TETAP.diblokir, blocked: true, reasons }
    : { text: redaksi.trim(), blocked: false, reasons: [] };
}
