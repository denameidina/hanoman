import type { Agent } from "@hanoman/shared";
import { readChoiceDialog } from "../tui-dialog";

// SPEC-409 · ADR-0091 · pintu keputusan #2 (deteksi otomatis) membaca LAYAR sesi. Modul ini murni:
// masuk teks pane, keluar "apakah ini benar-benar pertanyaan" + pertanyaannya. Tanpa I/O, supaya
// AC-9 (marker codex yang sebenarnya selesai wajar) bisa dibuktikan test tanpa tmux.

/** Buang ornamen TUI supaya prosa pertanyaannya terbaca. */
const CLEAN = /[│┃┆┊┌┐└┘├┤┬┴┼─━╭╮╰╯>❯]/g;

const tail = (text: string, lines: number): string[] =>
  text.split("\n").map((l) => l.replace(CLEAN, " ").trimEnd())
    .filter((l) => l.trim()).slice(-lines);

/**
 * AC-9 · codex TIDAK punya event `Notification` — markernya diturunkan dari `Stop`+`UserPromptSubmit`
 * (ADR-0074), jadi ia MENYALA JUGA saat sesi selesai wajar. Penanda di bawah adalah teks yang
 * dipancarkan codex saat selesai, bukan saat bertanya. Ketemu satu → jangan ketik apa pun.
 */
const CODEX_FINISHED = [
  /Goal achieved/i, /Goal unmet/i, /\btokens used\b/i, /\bTo continue this session\b/i,
];

/**
 * SPEC-487 (QA) · penanda BARIS GILIRAN claude — sesi yang bekerja atau baru saja selesai bekerja,
 * bukan sesi yang bertanya.
 *
 * Marker keputusan adalah pemberitahuan, bukan keadaan: hook `Notification` (SPEC-184) menyala
 * untuk `idle|permission|waiting for|needs.?input`, tak pernah padam sendiri, dan claude di bawah
 * ini menerimanya tanpa satu pun syarat lain. Terukur di jejak DB hidup: **6 dari 22** keputusan
 * pintu deteksi diambil untuk sesi yang layarnya berakhir pada baris giliran, bukan pada
 * pertanyaan — dan pemisahannya dari 16 baris dialog SEMPURNA (6/6 vs 0/16).
 *
 * Claude menulis baris itu dalam dua bentuk, keduanya membawa TIMER giliran, dan keduanya berarti
 * "agen berbicara, tak bertanya":
 *
 * - sedang berjalan  `✳ Scurrying… (3m 24s · ↓ 12.5k tokens)`   (1 dari 6)
 * - baru saja selesai `✻ Cooked for 40m 4s`                      (5 dari 6, tetap di layar)
 *
 * Isi keenamnya diperiksa satu per satu: semuanya LAPORAN akhir giliran (ringkasan perubahan,
 * catatan lingkungan, alasan sesuatu ditunda) — **nol** di antaranya pertanyaan. Jadi menutup pintu
 * di sini tak mencabut kemampuan menjawab pertanyaan prosa: pertanyaan prosa yang belum berakhir
 * giliran tak punya baris ini. Lima dari enam berujung prosa yang benar-benar diketik ke pane (satu
 * ke sesi yang sudah bekerja 91 menit), dan tiap pesan liar itu menaikkan `answers` — jatah AC-11
 * yang seharusnya menjawab dialog sungguhan berikutnya.
 *
 * Polanya menuntut ANGKA + satuan waktu, bukan kata kerjanya: nama verb claude berganti-ganti tiap
 * rilis, sementara timernya adalah kontrak tampilan yang tak pernah absen.
 */
const AGENT_TURN_LINE = /(?:\bfor\s+\d+\s*[hms]\b|\(\s*\d+\s*[hms][^)]*·)/i;

/**
 * Sinyal "sedang bertanya". Sengaja konservatif: pintu ini MENGETIK ke terminal agen yang sedang
 * bekerja, jadi ragu = diam. Yang dianggap sinyal: baris yang berakhir tanda tanya, daftar opsi
 * bernomor, dan kata kerja permintaan putusan yang lazim dipakai agen berbahasa Indonesia/Inggris.
 */
const ASK_SIGNALS = [
  /\?\s*$/m,
  /^\s*\[?\d+[).\]]\s+\S/m,
  /\b(pilih|apakah|haruskah|mana yang|opsi|which|should i|do you want|proceed\?)\b/i,
];

export type PaneRead = {
  asking: boolean;
  question: string;
  reason: string;
  /**
   * SPEC-452 · label opsi bila layarnya dialog pilihan (`AskUserQuestion`). Disodorkan ke
   * `leadPrompt` lewat `options` — tempat yang sudah ada sejak ADR-0091 dan selama ini tak pernah
   * diisi pintu deteksi, sehingga lead cuma melihat opsinya terkubur di dalam teks layar. Kosong
   * berarti "bukan dialog", bukan "dialog tanpa opsi".
   */
  choices: string[];
};

/**
 * Turunkan pertanyaan dari layar pane.
 *
 * claude: marker keputusan lahir dari hook `Notification` yang hanya menembak saat agen benar-benar
 * meminta masukan — markernya dipercaya, isi layar dipakai sebagai pertanyaannya.
 *
 * codex: marker tak bisa dipercaya sendirian (lihat CODEX_FINISHED), jadi butuh sinyal bertanya
 * yang eksplisit DAN tak ada penanda selesai.
 */
export function readPaneQuestion(text: string, agent: Agent): PaneRead {
  const lines = tail(text, 40);
  const body = lines.join("\n").trim();
  // SPEC-452 · dibaca dari teks ASLI, bukan dari `body`: `CLEAN` membuang `❯` dan garis kotak yang
  // ikut menyusun layar dialog, dan parser dialog memang menunggu bentuknya apa adanya.
  const dialog = readChoiceDialog(text);
  const choices = dialog?.options ?? [];
  if (!body) return { asking: false, question: "", reason: "layar kosong", choices };
  const question = tail(text, 25).join("\n").trim();
  // SPEC-487 · dialog di layar adalah bukti LANGSUNG dan menang mutlak: ia tak pernah terbuka
  // sementara giliran berjalan, sedangkan `capturePane` menyeret 200 baris riwayat yang bisa masih
  // memuat baris spinner giliran sebelumnya. Menilai busy lebih dulu akan membuang dialog nyata
  // karena sisa layar lama — tepat kesalahan yang berlawanan.
  if (!dialog && AGENT_TURN_LINE.test(body))
    return { asking: false, question, reason: "giliran agen, bukan pertanyaan (baris giliran claude di layar)", choices };
  if (agent === "codex") {
    const finished = CODEX_FINISHED.find((re) => re.test(body));
    if (finished) return { asking: false, question, reason: "sesi codex selesai wajar (ADR-0074)", choices };
    if (!ASK_SIGNALS.some((re) => re.test(body)))
      return { asking: false, question, reason: "tak ada sinyal pertanyaan di layar codex", choices };
  }
  return { asking: true, question, reason: "", choices };
}

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
