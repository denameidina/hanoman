import type { LeadDecision } from "@prisma/client";
import { leadReplyText, type Lead, type LeadDelivery, type SessionAsk } from "@hanoman/shared";
import { capturePane, clearMarker, getSession, sendToPane, submitPaneDialog } from "../pty";
import { dialogKey, readDialogScreen } from "../tui-dialog";
import { recordLeadDecision } from "../notifications";
import { beginAnswer, endAnswer } from "../session-dialog";
import { getLead, leadActive, leadProjects } from "./config";
import { isTakenOver } from "./deciding";
import { closeFlow, LeadFlowClosedError } from "./flow";
import { readCodexTurn } from "./pane";
import { decide, prodDecideDeps, takeDelivery, type DecideDeps } from "./decide";
import { LeadBusyError } from "./gate";
import { recordDecision } from "./trail";

// SPEC-409 · ADR-0091 · SPEC-909 · ADR-0146 · PINTU KEPUTUSAN #2 — deteksi otomatis.
//
// Melayani sesi APA ADANYA: tak ada prompt baru, tak ada kontrak baru, tak ada perubahan pada
// mekanisme fase. Sesi melanjutkan pekerjaannya tanpa tahu siapa yang menjawab (US-6).
//
// SPEC-909 mengubah PEMICUNYA, bukan pagarnya. Dulu modul ini PEMINDAI: `scanAndAnswer` menyapu
// semua sesi hidup tiap 5 detik, membaca marker, lalu men-`capture-pane` untuk menebak apa yang
// ditanyakan. Sekarang ia PENERIMA: hook agen menembak tepat pada `AskUserQuestion` (claude) atau
// akhir-turn (codex), dan `lead/ask.ts` memanggil `admitAsk` + `answerAsk` untuk SATU sesi. Yang
// diketik ke pane, dan setiap pagar yang menahannya, tak berubah sedikit pun.

/**
 * AC-11 / OQ-10 · berapa jawaban otomatis BERTURUT-TURUT sudah diberikan untuk satu sesi.
 *
 * Sengaja TIDAK di-reset saat marker kosong: marker memang kosong sesaat setelah lead mengetik
 * (hook `UserPromptSubmit` menjalankan `: > <marker>`), jadi reset di sana akan membuat pagarnya
 * tak pernah tercapai — persis loop tak berujung yang ingin dicegah AC-11. Yang mereset hanyalah
 * sesi yang benar-benar berakhir (`pruneAsks`, lead/ask.ts) dan campur tangan manusia
 * (`resetSession`, dipanggil route saat operator menimpa keputusan).
 */
const answers = new Map<string, number>();
const capped = new Set<string>();

/**
 * SPEC-472 (QA) · berapa keputusan BERTURUT-TURUT gagal disusun untuk satu sesi.
 *
 * Penghitung KEDUA, sengaja terpisah dari `answers`: pagar AC-11 mengukur "sudah dijawab berapa
 * kali" dan karena itu tak pernah bergerak untuk sesi yang keputusannya tak pernah jadi. Tanpa
 * pagar sendiri, satu penyebab yang tak kunjung hilang (kunci API ditolak, kuota habis, agen tak
 * terpasang) membuat denyut 5 detik men-spawn agen lead baru untuk sesi yang sama tanpa ujung —
 * terukur 152 percobaan dalam ±13 menit, masing-masing satu proses agen dan satu baris jejak yang
 * sama. Ambangnya ikut `maxAutoAnswers`: knob itu sudah berarti "berapa kali lead boleh mencoba
 * sendiri sebelum menyerah ke operator", dan kegagalan adalah percobaan juga.
 *
 * Dikosongkan oleh keputusan yang BERHASIL (lead terbukti sanggup lagi), oleh campur tangan
 * operator (`resetSession`), dan oleh sesi yang berakhir (`pruneAsks`) — sama seperti `answers`.
 */
const failures = new Map<string, number>();
const failCapped = new Set<string>();
/** Kapan kegagalan terakhir sesi itu terjadi — pasangan `FAIL_COOLDOWN_MS`. */
const failedAt = new Map<string, number>();

/**
 * SPEC-487 (QA) · sesudah sekian lama tanpa kegagalan baru, deretnya dianggap PUTUS.
 *
 * Temuan C audit SPEC-479 mengukur `failCapped` sebagai keadaan MENYERAP: sesudah cap tak ada
 * percobaan, tanpa percobaan tak ada keberhasilan, tanpa keberhasilan `failures` tak pernah
 * dikosongkan — nol percobaan baru dalam 10 denyut sesudah bebannya hilang. Perbaikan SPEC-479
 * hanya mengecualikan `LeadBusyError`, yaitu kasus di mana agen BELUM SEMPAT dipanggil; kasus yang
 * diukur temuan itu — agen dipanggil lalu di-SIGTERM di detik ke-`timeoutSec` karena mesinnya
 * sedang berat — tetap tiba sebagai `status = "gagal"` biasa. Beban adalah justru tempat deadline
 * itu terlampaui, jadi pengecualiannya menutup separuh yang salah.
 *
 * 15 menit dipilih dari bentuk badainya, bukan dari angka bulat: badai SPEC-472 (152 percobaan
 * dalam ±13 menit) berjarak `TICK_MS` = 5 detik, jadi ambang `maxAutoAnswers` tetap tercapai dalam
 * hitungan detik dan masa dingin ini menurunkannya ke ±3 percobaan per 15 menit — sementara sesi
 * yang cuma korban tiga lonjakan beban tak lagi ditinggalkan selamanya. Konstanta modul, cermin
 * `MAX_CHAIN_STEPS` (ADR-0091): ia bukan setelan, ia bentuk pagarnya.
 */
export const FAIL_COOLDOWN_MS = 15 * 60_000;

/**
 * SPEC-487 (QA) · ADR-0102 · `LeadFlow` rantai yang sedang berjalan untuk satu sesi.
 *
 * Diingat LINTAS DENYUT, bukan lokal di `runChain`: rantai boleh terputus di tengah (gerbang penuh,
 * agen gagal, layar belum berganti) dan markernya sengaja dipertahankan supaya denyut berikutnya
 * melanjutkannya. Kalau alurnya tak ikut diingat, lanjutannya lahir sebagai alur BARU dan
 * `chainSteps` — satu-satunya alasan ADR-0102 ada — kosong lagi tepat di tempat yang paling
 * membutuhkannya.
 *
 * Dibersihkan oleh yang sama dengan penghitung lain: rantai tuntas, `pruneAsks`, dan `resetSession`.
 */
const chainFlows = new Map<string, string>();

/**
 * SPEC-474 · batas langkah satu RANTAI dialog. Konstanta modul, bukan konfigurasi (cermin
 * `LEAD_ACTIONS`, ADR-0091): kontrak tool `AskUserQuestion` memberi maksimum 4 pertanyaan, dan dua
 * langkah sisanya menampung layar rekap + satu layar tak terduga. Tanpa batas ini satu pane yang
 * menolak maju bisa membakar giliran agen tanpa ujung (kelas SPEC-472).
 */
export const MAX_CHAIN_STEPS = 6;

/** Jeda & percobaan menunggu layar dialog BERGANTI sesudah dijawab (±6 dtk). */
const CHAIN_POLL_MS = 300;
const CHAIN_POLL_TRIES = 20;

/**
 * SPEC-909 · ADR-0146 · berapa lama menunggu dialognya TERGAMBAR sesudah lead selesai memutuskan.
 *
 * `PreToolUse` menembak SEBELUM tool-nya jalan, jadi pada saat event tiba dialognya belum ada di
 * layar. Menunggunya praktis gratis: `decide()` sudah memakan detik sampai menit lebih dulu.
 * Habis tanpa dialog = BATAL, bukan jatuh ke jalur prosa — `sendToPane` akan mengetik prosa +
 * `Enter` ke kolom chat yang sudah normal, dan itu persis pesan liar yang diukur SPEC-487.
 */
const DIALOG_WAIT_TRIES = 20;

export function resetSession(sessionId: string): void {
  answers.delete(sessionId); capped.delete(sessionId);
  failures.delete(sessionId); failCapped.delete(sessionId); failedAt.delete(sessionId);
  chainFlows.delete(sessionId);
}
export function __resetDetect(): void {
  answers.clear(); capped.clear(); failures.clear(); failCapped.clear(); failedAt.clear();
  chainFlows.clear();
}
export function answerCount(sessionId: string): number { return answers.get(sessionId) ?? 0; }
export function failureCount(sessionId: string): number { return failures.get(sessionId) ?? 0; }

export type DetectDeps = {
  pane: (id: string) => string;
  exited: (id: string) => boolean;
  /**
   * SPEC-485 · pilihan lead ikut sebagai DATA, bukan hanya prosa: dialog `multiSelect` dijawab
   * dengan mencentang kotaknya, dan label-label inilah yang dipetakan ke nomor baris.
   */
  send: (id: string, text: string, choices: string[]) => Promise<boolean>;
  /**
   * SPEC-452 · kosongkan marker keputusan sesudah jawaban mendarat.
   *
   * Menjawab sebuah DIALOG bukan `UserPromptSubmit`, jadi hook pengosong (`: > <marker>`,
   * SPEC-184) tak menembak dan markernya tetap terisi meski sesi sudah kembali bekerja. Terukur:
   * 8 byte sebelum jawaban, 8 byte sesudahnya. Tanpa langkah ini denyut berikutnya membaca sesi
   * itu masih "menunggu", membakar satu giliran agen, lalu mengetik prosanya ke kolom chat yang
   * sudah normal — pesan liar yang membelokkan sesi yang sedang bekerja — sampai `maxAutoAnswers`.
   * Berbeda dari berkas fase (ADR-0084, tak pernah ditulis server), marker keputusan memang berkas
   * yang ditulis & dikosongkan dari luar agen sejak SPEC-184.
   */
  clearMarker: (file: string) => void;
  /**
   * SPEC-474 · tekan `Submit answers` di layar rekap dialog berantai. Langkah MEKANIS: tak ada
   * yang perlu dipertimbangkan untuk menutup dialog yang seluruh jawabannya sudah masuk, jadi
   * pintu ini tak boleh membakar satu giliran agen untuknya.
   */
  submit: (id: string) => Promise<boolean>;
  /** Jeda antar-pembacaan layar; disuntikkan supaya rantai bisa diuji tanpa waktu nyata. */
  sleep: (ms: number) => Promise<void>;
  /**
   * SPEC-487 · tutup `LeadFlow` sebuah rantai yang benar-benar tuntas.
   *
   * Pasangan dari `chain: true` yang dikirim `runChain` ke `decide()`: selama bendera itu menyala
   * `decide()` sengaja TIDAK menutup alurnya sendiri (ADR-0102), jadi harus ada yang menutupnya di
   * ujung — dan ujungnya hanya diketahui `runChain`.
   */
  closeChain: (flowId: string) => Promise<void>;
  /** Jam untuk masa dingin `failures` (`FAIL_COOLDOWN_MS`); disuntik supaya teruji deterministik. */
  now: () => number;
  decide: typeof decide;
  decideDeps: DecideDeps;
  /**
   * SPEC-480 · putusan "sebagaimana dikirim" milik baris yang baru saja lahir — terpangkas, dengan
   * pilihan yang sudah terselesaikan. Disuntik (bukan dipanggil langsung) supaya rantai dialog bisa
   * diuji tanpa menjalankan `decide()` sungguhan; prod tetap satu definisi, `takeDelivery`.
   */
  delivery: (decisionId: string) => LeadDelivery | null;
  optIn: () => Promise<string[]>;
  notify: (id: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
  cfg: () => Promise<Lead>;
};

export const prodDetectDeps: DetectDeps = {
  pane: (id) => capturePane(id),
  // SPEC-402 · tmux tak terbaca ≠ pane mati. Ragu → perlakukan sebagai mati: yang hilang cuma satu
  // jawaban otomatis (sesi jatuh ke perilaku hari ini), sementara salah arah membuat lead mengetik
  // ke pane yang sudah tak ada.
  exited: (id) => { try { return getSession(id)?.exited ?? true; } catch { return true; } },
  // SPEC-909 · ADR-0146 · jalur lead ikut masuk ke penjaga yang SAMA dengan jalur manusia
  // (`beginAnswer`, ADR-0142 §5). Dua penulis pane yang tak sepakat menyilangkan keystroke jadi
  // sampah yang tak bisa ditarik kembali — dan sejak operator bisa MENGAMBIL ALIH (AC-6), kedua
  // penulis itu memang bisa aktif bersamaan.
  send: async (id, text, choices) => {
    if (!beginAnswer(id)) return false;
    try { return await sendToPane(id, text, 50, choices); }
    finally { endAnswer(id); }
  },
  clearMarker,
  submit: async (id) => {
    if (!beginAnswer(id)) return false;
    try { return await submitPaneDialog(id); }
    finally { endAnswer(id); }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  // Alur yang gagal ditutup bukan alasan menggagalkan rantai yang sudah berhasil: penyapu TTL
  // (ADR-0102) tetap menutupnya.
  closeChain: async (flowId) => { await closeFlow(flowId, "submit").catch(() => null); },
  now: Date.now,
  decide,
  decideDeps: prodDecideDeps,
  delivery: takeDelivery,
  optIn: leadProjects,
  notify: recordLeadDecision,
  cfg: getLead,
};

export type AdmitResult = { ok: true } | { ok: false; reason: string };
export type AskCtx = { projectId: string; specId?: string; decisionFile?: string };
export type AnswerAskResult = {
  answered: boolean; reason: string; at: number; flowId: string | null; step: number | null;
};

/**
 * SPEC-909 · ADR-0146 · seluruh pagar tahap 1 `scanAndAnswer` yang lama, dinilai untuk SATU sesi.
 *
 * Kalimat, `kind`, dan `weighty` baris jejaknya sengaja tak berubah sehuruf pun: pagar yang "masih
 * menggigit" harus menggigit dengan bunyi yang sama, dan operator membaca jejak itu sebagai bukti.
 */
export async function admitAsk(
  s: { id: string; specId?: string; projectId: string },
  deps: DetectDeps = prodDetectDeps,
): Promise<AdmitResult> {
  const cfg = await deps.cfg();
  const no = (reason: string): AdmitResult => ({ ok: false, reason });
  if (!cfg.enabled || cfg.paused) return no("lead tidak aktif");        // AC-27/AC-30
  if (!(await deps.optIn()).includes(s.projectId)) return no("project tak opt-in lead");
  if (!leadActive(cfg, s.projectId)) return no("lead dijeda untuk project ini");   // AC-15
  if (deps.exited(s.id)) return no("pane mati");                        // AC-10

  if ((answers.get(s.id) ?? 0) >= cfg.maxAutoAnswers) {                 // AC-11
    if (!capped.has(s.id)) {
      capped.add(s.id);
      const row = await recordDecision({
        projectId: s.projectId, specId: s.specId, sessionId: s.id,
        gate: "detected", kind: "quality",
        question: `Sesi ${s.id} sudah dijawab otomatis ${cfg.maxAutoAnswers}× berturut-turut.`,
        answer: "Berhenti menjawab sesi ini; serahkan ke operator.",
        reason: "Batas jawaban otomatis per sesi tercapai — pengulangan menandakan lead tak benar-benar membuka jalan buntunya (AC-11).",
        refs: [], confidence: "tinggi", action: "none", weighty: true,
      });
      await deps.notify(row.id, `Lead berhenti menjawab sesi ${s.id} (batas ${cfg.maxAutoAnswers}× tercapai)`,
        s.projectId, s.specId ?? null, s.id);
    }
    return no("batas jawaban otomatis tercapai");
  }

  // SPEC-487 · deret kegagalan PUTUS sesudah `FAIL_COOLDOWN_MS` tanpa kegagalan baru. Tanpa ini
  // `failCapped` adalah keadaan menyerap dan tiga lonjakan beban menutup lead bagi sesi ini
  // selamanya (temuan C audit SPEC-479, yang perbaikannya hanya menyentuh `LeadBusyError`).
  const lastFail = failedAt.get(s.id);
  if (lastFail !== undefined && deps.now() - lastFail > FAIL_COOLDOWN_MS) {
    failures.delete(s.id); failCapped.delete(s.id); failedAt.delete(s.id);
  }

  // SPEC-472 · pagar kedua: menyerah sesudah sederet kegagalan. Ditempatkan SEBELUM `decide()`
  // karena yang mahal justru panggilannya — satu proses agen per percobaan.
  if ((failures.get(s.id) ?? 0) >= cfg.maxAutoAnswers) {
    if (!failCapped.has(s.id)) {
      failCapped.add(s.id);
      const row = await recordDecision({
        projectId: s.projectId, specId: s.specId, sessionId: s.id,
        gate: "detected", kind: "quality",
        question: `Keputusan untuk sesi ${s.id} gagal disusun ${cfg.maxAutoAnswers}× berturut-turut.`,
        answer: "Berhenti mencoba; serahkan ke operator.",
        reason: "Kegagalan beruntun menandakan sebab yang tak hilang dengan mengulang (kunci/kuota agen, biner tak terpasang) — mencoba lagi tiap denyut hanya membakar kuota. Alasan percobaan terakhir ada di baris jejak `gagal` tepat di atas ini.",
        refs: [], confidence: "tinggi", action: "none", weighty: true,
      });
      await deps.notify(row.id, `Lead berhenti mencoba sesi ${s.id} (${cfg.maxAutoAnswers}× gagal berturut-turut)`,
        s.projectId, s.specId ?? null, s.id);
    }
    return no("batas kegagalan beruntun tercapai");
  }
  return { ok: true };
}

/**
 * Layani SATU event. Dipanggil pekerja `lead/ask.ts`; tak pernah melempar ke pemanggil.
 *
 * Penghitungnya persis seperti jalur lama: satu PANGGILAN `AskUserQuestion` = satu jawaban otomatis
 * (AC-11), keberhasilan memutus deret `failures` (SPEC-472), dan marker dikosongkan HANYA saat
 * seluruh rantainya tuntas (SPEC-452/474 — marker sebuah dialog hanya terisi sekali).
 */
export async function answerAsk(
  ask: SessionAsk, s: AskCtx, deps: DetectDeps = prodDetectDeps,
): Promise<AnswerAskResult> {
  const chain = await runChain(ask, s, deps);
  const out = { at: chain.at, flowId: chain.flowId, step: chain.step };
  if (chain.acted && chain.done) {
    if (s.decisionFile) deps.clearMarker(s.decisionFile);
    answers.set(ask.sessionId, (answers.get(ask.sessionId) ?? 0) + 1);
    failures.delete(ask.sessionId);
    return { answered: true, reason: "", ...out };
  }
  if (chain.failed) {
    failures.set(ask.sessionId, (failures.get(ask.sessionId) ?? 0) + 1);
    failedAt.set(ask.sessionId, deps.now());
  }
  return { answered: false, reason: chain.reason, ...out };
}

type ChainResult = {
  /** Minimal satu jawaban terkirim atau satu submit berhasil. */
  acted: boolean;
  /** Seluruh pertanyaan panggilan ini terjawab dan dialognya ditutup. */
  done: boolean;
  /** Kegagalan yang layak dihitung (bukan sekadar lead dijeda/penuh di tengah panggilan). */
  failed: boolean;
  reason: string;
  /** Langkah terakhir yang dikerjakan (0-based) — dipancarkan ke pet sebagai "ke-berapa dari". */
  at: number;
  flowId: string | null;
  step: number | null;
};

/**
 * SPEC-474 · SPEC-909 · ADR-0146 · satu panggilan `AskUserQuestion` = satu rantai = satu `LeadFlow`.
 *
 * Berapa langkahnya DIKETAHUI dari payload (`questions.length`, ≤ 4 per kontrak tool), bukan
 * ditebak dari layar — itulah yang mencabut `CHAIN_END_TRIES`/`settledPane`. Yang tersisa dari
 * layar hanya dua, keduanya di DALAM satu rantai yang sudah dipicu event: menunggu dialognya
 * tergambar (`waitDialog` — `PreToolUse` menembak sebelum tool-nya jalan) dan berpindah antar-tab
 * (`waitScreenChange` — terukur tak ada event di antara tab, satu panggilan 3 pertanyaan
 * menerbitkan 1 event).
 *
 * Panggilan `AskUserQuestion` BERIKUTNYA tiba sebagai event berikutnya, jadi rantai lintas-panggilan
 * tak pernah lagi ditunggu di layar.
 */
async function runChain(ask: SessionAsk, s: AskCtx, deps: DetectDeps): Promise<ChainResult> {
  const sid = ask.sessionId;
  let flowId: string | null = chainFlows.get(sid) ?? null;
  let step: number | null = null;
  let acted = false;
  let at = 0;

  const close = async (r: Omit<ChainResult, "flowId" | "step">): Promise<ChainResult> => {
    const f = chainFlows.get(sid);
    if (f) { chainFlows.delete(sid); await deps.closeChain(f).catch(() => {}); }
    return { ...r, flowId, step };
  };
  const stop = (reason: string, failed = false): ChainResult =>
    ({ acted, done: false, failed, reason, at, flowId, step });

  // codex: satu langkah prosa ke kolom chat. Gerbangnya PESAN GILIRAN, bukan layar — teks penuh,
  // tak dipotong lebar pane, dan nol invokasi tmux. Ambangnya sama persis (AC-9 utuh).
  if (ask.source === "turn-end") {
    const read = readCodexTurn(ask.message);
    if (!read.asking) return stop(read.reason);
  }

  const steps: (SessionAsk["questions"][number] | null)[] =
    ask.source === "ask-tool" ? ask.questions : [null];
  if (steps.length > MAX_CHAIN_STEPS) return stop("payload melebihi batas langkah rantai dialog");

  for (let i = 0; i < steps.length; i++) {
    at = i;
    if (isTakenOver(sid)) return stop("diambil alih operator");
    const q = steps[i] ?? null;

    const notes = ["Sesi ini menunggu di terminal. Jawablah sebagai masukan yang bisa langsung diketik ke terminal itu (isi `reply`)."];
    if (q?.options.length) {
      // SPEC-480 · yang dituntut `choice`, bukan prosa yang menyebut opsinya: server yang merangkai
      // kalimat jawabannya dari label opsi verbatim.
      notes.push("Layarnya adalah dialog pilihan. Isi `choice` dengan nomor atau label opsi yang kamu pilih — server yang merangkai kalimat jawabannya dari label itu, jadi `reply` tak perlu mengulanginya.");
    }
    if (steps.length > 1) {
      // SPEC-474 · dialog berantai menampilkan SATU pertanyaan pada satu waktu. Bedanya dengan
      // jalur lama: daftar headernya datang dari payload, bukan dari strip tab yang di-scrape.
      notes.push(
        `Dialog ini BERANTAI: ${steps.length} pertanyaan dalam satu tanya `
        + `(${ask.questions.map((x) => x.header || x.question.slice(0, 24)).join(", ")}). `
        + `Yang sedang tampil pertanyaan ke-${i + 1}; jawab HANYA pertanyaan itu — sisanya akan `
        + "ditanyakan sesudah ini.",
      );
    }

    const req = {
      projectId: s.projectId, specId: s.specId, sessionId: sid,
      gate: "detected" as const, kind: "answer" as const,
      question: q ? q.question : ask.message,
      options: q?.options.length ? q.options.map((o) => o.label) : undefined,
      // SPEC-485 · ADR-0102 · `multiSelect` datang dari payload, jadi bentuk pilihannya tak perlu
      // disimpulkan dari kotak centang di layar lagi.
      select: q?.multiSelect ? { mode: "multi" as const, min: 1, max: null } : undefined,
      notes,
      // SPEC-487 · `chain: true` SELALU dikirim: penggerak rantai di produksi adalah fungsi ini,
      // bukan agen peminta mana pun, dan tanpa bendera itu `decide()` menutup alurnya sebagai
      // `tunggal` di tiap langkah — `chainSteps` kosong tepat di tempat yang paling membutuhkannya.
      chain: true,
    };

    let row: LeadDecision | null;
    try {
      row = await deps.decide({ ...req, flowId }, deps.decideDeps);
    } catch (e) {
      // SPEC-479 · gerbang penuh BUKAN kegagalan lead: ia hilang begitu slot bebas, sementara
      // `failures` dibuat untuk sebab yang TAK hilang dengan mengulang.
      if (e instanceof LeadBusyError) return stop(`lead penuh — ${e.message}`);
      // Alur yang kedaluwarsa di tengah rantai (`flowTtlMin`) tak boleh menjatuhkan rantainya.
      if (!(e instanceof LeadFlowClosedError)) throw e;
      chainFlows.delete(sid); flowId = null;
      try { row = await deps.decide({ ...req, flowId: null }, deps.decideDeps); }
      catch (e2) {
        if (e2 instanceof LeadBusyError) return stop(`lead penuh — ${e2.message}`);
        throw e2;
      }
    }
    if (row?.flowId) { flowId = row.flowId; chainFlows.set(sid, row.flowId); }
    if (row?.step != null) step = row.step;
    // `null` = lead baru saja dijeda/dimatikan di tengah panggilan — bukan kegagalan lead.
    if (!row) return stop("lead tak menghasilkan keputusan yang berlaku");
    if (row.status !== "berlaku") return stop("lead tak menghasilkan keputusan yang berlaku", true);

    // Dialognya baru tergambar SESUDAH tool-nya jalan; untuk codex tak ada dialog sama sekali.
    let before = "";
    if (ask.source === "ask-tool") {
      const text = await waitDialog(sid, deps);
      if (text === null) return stop("dialog tak muncul di pane — tak ada yang diketik", true);
      before = dialogKey(text);
    }
    if (isTakenOver(sid)) return stop("diambil alih operator");

    // SPEC-480 · teks yang diketik DIRAKIT dari putusan terstruktur. Saluran pengiriman hidup di
    // memori dan berumur satu ketikan, jadi ia bisa meleset: yang selalu ada adalah `answer`.
    // Jangan pernah mengetik string kosong ke pane hanya karena saluran itu kosong.
    const sent = deps.delivery(row.id);
    const reply = (sent ? leadReplyText(sent) : "") || row.answer;
    // SPEC-485 · label opsi terpilih diteruskan apa adanya; `sendToPane` yang memetakannya ke nomor
    // baris terhadap opsi LAYAR ITU.
    const picked = sent?.choices.map((c) => c.option) ?? [];
    if (!(await deps.send(sid, reply, picked))) return stop("gagal mengetik ke pane", true);
    acted = true;

    if (ask.source === "turn-end") return close({ acted, done: true, failed: false, reason: "", at });
    if (i < steps.length - 1 && !(await waitScreenChange(sid, before, deps)))
      return stop("layar dialog tak berubah sesudah dijawab", true);
  }

  // SPEC-474 · layar rekap ditutup sebagai langkah MEKANIS, tanpa agen. Tapi keberadaannya harus
  // DIBUKTIKAN dulu: `submitPaneDialog` fail-closed untuk layar yang bukan rekap (pty.ts), dan
  // dialog SATU pertanyaan claude tak pernah menampilkan layar rekap sama sekali. Menekannya tanpa
  // syarat membuat kasus paling umum — satu pertanyaan, dijawab benar — dilaporkan `gagal`:
  // marker tak dikosongkan, `answers` tak naik, `failures` naik, dan sesudah `maxAutoAnswers`
  // dialog sehat sesi itu kena `failCapped`.
  switch (await afterLastAnswer(sid, deps)) {
    case "closed":
      return close({ acted: true, done: true, failed: false, reason: "", at });
    case "review":
      if (!(await deps.submit(sid))) return stop("gagal menekan Submit answers", true);
      return close({ acted: true, done: true, failed: false, reason: "", at });
    default:
      // Masih dialog pertanyaan padahal payload bilang semuanya sudah dijawab. JANGAN mengetik apa
      // pun dan JANGAN mengosongkan marker: sesi itu memang masih menunggu, dan marker adalah
      // satu-satunya yang membuatnya terlihat di pil, notifikasi, dan panel pet.
      return stop("dialog belum tertutup sesudah pertanyaan terakhir dijawab");
  }
}

/**
 * Apa yang terjadi pada layar sesudah pertanyaan TERAKHIR dijawab.
 *
 * Ini bukan `CHAIN_END_TRIES` yang dicabut: yang itu menebak BERAPA pertanyaan tersisa, dan
 * tebakannya mengosongkan marker. Yang ini cuma menanyakan satu hal mekanis pada dialog yang
 * jumlah pertanyaannya sudah diketahui dari payload — apakah ia menutup sendiri atau menyisakan
 * layar rekap untuk ditekan.
 */
async function afterLastAnswer(id: string, deps: DetectDeps): Promise<"review" | "closed" | "pending"> {
  for (let i = 0; i < CHAIN_POLL_TRIES; i++) {
    await deps.sleep(CHAIN_POLL_MS);
    const screen = readDialogScreen(deps.pane(id));
    if (!screen) return "closed";
    if (screen.kind === "review") return "review";
  }
  return "pending";
}

/**
 * SPEC-909 · tangkapan pertama yang berupa dialog, atau `null` bila ia tak pernah muncul.
 *
 * Bukan `waitScreenChange`: yang itu menunggu layar BERGANTI, yang ini menunggu layar MENJADI
 * dialog. Keduanya dibutuhkan di tempat yang berbeda, dan menggabungkannya akan membuat salah
 * satunya kehilangan artinya.
 */
async function waitDialog(id: string, deps: DetectDeps): Promise<string | null> {
  for (let i = 0; i < DIALOG_WAIT_TRIES; i++) {
    const text = deps.pane(id);
    if (readDialogScreen(text)) return text;
    await deps.sleep(CHAIN_POLL_MS);
  }
  return null;
}

async function waitScreenChange(id: string, before: string, deps: DetectDeps): Promise<boolean> {
  for (let i = 0; i < CHAIN_POLL_TRIES; i++) {
    await deps.sleep(CHAIN_POLL_MS);
    if (dialogKey(deps.pane(id)) !== before) return true;
  }
  return false;
}
