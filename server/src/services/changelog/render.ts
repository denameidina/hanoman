import type { ChangelogMode } from "@hanoman/shared";

// SPEC-516 · ADR-0105 · bentuk akhir changelog. MURNI — nol I/O, nol Prisma, nol spawn.

export type ChangelogItem = { label: string; detail: string };
export type ChangelogInput = {
  mode: ChangelogMode;
  title: string;
  items: ChangelogItem[];
  /** Catatan cakupan yang HARUS sampai ke operator (mis. item tanpa stempel waktu). */
  notes: string[];
};

export const MODE_LABEL: Record<ChangelogMode, string> = {
  backlog: "backlog yang selesai dalam rentang tanggal",
  commit: "riwayat perubahan repo dalam rentang yang dipilih",
  version: "perubahan yang masuk ke versi/rilis itu",
};

const DETAIL_MAX = 240;
const clip = (s: string): string =>
  s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1).trimEnd()}…` : s;

/** Draf deterministik. Dipakai apa adanya saat agen tak tersedia/gagal — operator tetap melihat
 *  sesuatu yang berguna, dan `warning` di barisnya mengatakan mengapa ia belum senaratif
 *  seharusnya. */
export function fallbackMarkdown(input: ChangelogInput): string {
  const lines: string[] = [`# Changelog — ${input.title}`, ""];
  if (input.items.length === 0) {
    lines.push("_Tak ada perubahan yang bisa diringkas untuk rentang ini._", "");
  } else {
    lines.push(`Ringkasan ${input.items.length} perubahan untuk pemakai.`, "");
    for (const it of input.items) {
      const d = clip(it.detail.trim());
      lines.push(d ? `- **${it.label}** — ${d}` : `- **${it.label}**`);
    }
    lines.push("");
  }
  if (input.notes.length) {
    lines.push("---", "");
    for (const n of input.notes) lines.push(`> ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Prompt untuk agen one-shot. Tiga hal yang WAJIB ada dan masing-masing pernah jadi sebab
 * kegagalan nyata di repo ini:
 *
 * 1. **Anggaran waktu disebut.** SPEC-432 mengukurnya: agen berbatas waktu yang tak diberi tahu
 *    batasnya memakai 306 dtk untuk pekerjaan yang, dengan satu paragraf anggaran, selesai dalam
 *    101 dtk. Agen tak bisa menyesuaikan kedalaman terhadap batas yang tak ia ketahui.
 * 2. **Larangan teknis eksplisit.** Scrub adalah jaring, bukan pengganti instruksi.
 * 3. **Bentuk keluaran dikunci.** Satu blok markdown, tanpa pengantar, tanpa blok kode — supaya
 *    hasilnya bisa langsung disimpan & diunduh tanpa parsing.
 */
export function changelogPrompt(input: ChangelogInput, budgetMs: number): string {
  const budget = Math.max(1, Math.round(budgetMs / 1000));
  const items = input.items
    .map((it, i) => `${i + 1}. ${it.label}${it.detail ? ` — ${it.detail}` : ""}`)
    .join("\n");
  return [
    "Kamu menulis changelog untuk PEMAKAI sebuah produk, bukan untuk developer.",
    "",
    `Anggaran waktumu ${budget} detik. Jawab langsung — jangan membaca berkas, jangan memakai tool,`,
    "jangan menyelidiki apa pun. Seluruh bahan sudah ada di bawah.",
    "",
    `Judul rentang: ${input.title}`,
    `Bahan berasal dari ${MODE_LABEL[input.mode]}.`,
    "",
    "Bahan:",
    items || "(tidak ada)",
    "",
    "Aturan:",
    "- Bahasa Indonesia, gaya editorial: tenang, ringkas, kalimat penuh.",
    "- Tulis apa yang berubah BAGI PEMAKAI, bukan apa yang disentuh di dalam kode.",
    "- DILARANG menyebut nama berkas, nama fungsi, nama variabel, hash commit, nomor SPEC/ADR,",
    "  nama branch, atau istilah internal apa pun.",
    "- Gabungkan bahan yang bicara hal yang sama jadi satu butir. 3–10 butir; kurangi bila memang sedikit.",
    "- Jangan mengarang perubahan yang tak ada di bahan.",
    "",
    "Bentuk keluaran — HANYA markdown ini, tanpa kalimat pembuka atau penutup di luarnya,",
    "tanpa blok kode:",
    "",
    `# Changelog — ${input.title}`,
    "",
    "<satu paragraf pembuka, maksimal dua kalimat>",
    "",
    "- **<judul singkat perubahan>** — <satu kalimat manfaatnya bagi pemakai>",
  ].join("\n");
}
