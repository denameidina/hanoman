// SPEC-409 · ADR-0091 · SPEC-909 · ADR-0146 · gerbang "codex benar-benar bertanya".
//
// Modul ini dulu juga memuat `readPaneQuestion`, yang menurunkan PERTANYAAN claude dari teks pane
// beserta penanda baris-giliran `AGENT_TURN_LINE` (SPEC-487). Keduanya dicabut SPEC-909: pertanyaan
// claude kini datang dari payload tool `AskUserQuestion`, dan yang mencegah lead mengetik ke pane
// yang sedang bekerja adalah `waitDialog` di `detect.ts` — gerbang yang menuntut dialognya benar-
// benar TERGAMBAR, bukan tebakan atas baris giliran. Riwayatnya di git dan di ADR-0146.
//
// Yang tersisa MURNI: masuk teks, keluar "apakah ini benar-benar pertanyaan". Tanpa I/O, supaya
// AC-9 (giliran codex yang sebenarnya selesai wajar) bisa dibuktikan test tanpa tmux.

/**
 * AC-9 · codex TIDAK punya event `Notification` — markernya diturunkan dari `Stop`+`UserPromptSubmit`
 * (ADR-0074), jadi ia MENYALA JUGA saat sesi selesai wajar. Penanda di bawah adalah teks yang
 * dipancarkan codex saat selesai, bukan saat bertanya. Ketemu satu → jangan ketik apa pun.
 */
const CODEX_FINISHED = [
  /Goal achieved/i, /Goal unmet/i, /\btokens used\b/i, /\bTo continue this session\b/i,
];

/**
 * Sinyal "sedang bertanya". Sengaja konservatif: jalur ini berujung pada MENGETIK ke terminal agen
 * yang mungkin sedang bekerja, jadi ragu = diam. Yang dianggap sinyal: baris yang berakhir tanda
 * tanya, daftar opsi bernomor, dan kata kerja permintaan putusan yang lazim dipakai agen berbahasa
 * Indonesia/Inggris.
 */
const ASK_SIGNALS = [
  /\?\s*$/m,
  /^\s*\[?\d+[).\]]\s+\S/m,
  /\b(pilih|apakah|haruskah|mana yang|opsi|which|should i|do you want|proceed\?)\b/i,
];

/**
 * SPEC-909 · ADR-0146 · gerbang "codex benar-benar bertanya", dinilai atas `last_assistant_message`
 * dari payload hook `Stop` — bukan atas `capture-pane`.
 *
 * Sumber yang lebih baik untuk pertanyaan yang sama: pesan giliran tak dipotong lebar pane (pane
 * sesi di mesin dev 52 kolom) dan tak tercampur sisa scrollback. Nol invokasi tmux. Ambangnya
 * TIDAK berubah — `CODEX_FINISHED` dan `ASK_SIGNALS` yang sama, supaya cakupan codex sesudah SPEC
 * ini setara dengan sebelumnya, bukan lebih longgar.
 */
export function readCodexTurn(message: string): { asking: boolean; reason: string } {
  const body = message.trim();
  if (!body) return { asking: false, reason: "giliran codex berakhir tanpa pesan" };
  if (CODEX_FINISHED.some((re) => re.test(body)))
    return { asking: false, reason: "sesi codex selesai wajar (ADR-0074)" };
  if (!ASK_SIGNALS.some((re) => re.test(body)))
    return { asking: false, reason: "tak ada sinyal pertanyaan di pesan giliran codex" };
  return { asking: true, reason: "" };
}
