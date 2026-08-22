import type { LeadDecision } from "@prisma/client";
import { leadReplyText, type Agent, type Lead, type LeadDelivery } from "@hanoman/shared";
import { capturePane, clearMarker, getSession, liveDecisions, markerFilled, sendToPane, submitPaneDialog } from "../pty";
import { dialogKey, readDialogScreen } from "../tui-dialog";
import { recordLeadDecision } from "../notifications";
import { getLead, leadActive, leadProjects } from "./config";
import { closeFlow, LeadFlowClosedError } from "./flow";
import { readPaneQuestion } from "./pane";
import { decide, prodDecideDeps, takeDelivery, type DecideDeps } from "./decide";
import { LeadBusyError, runPool } from "./gate";
import { recordDecision } from "./trail";

// SPEC-409 · ADR-0091 · PINTU KEPUTUSAN #2 — deteksi otomatis.
//
// Melayani sesi APA ADANYA: tak ada prompt baru, tak ada kontrak baru, tak ada perubahan pada
// mekanisme fase. Lead melihat sesi hidup ber-marker keputusan terisi (mekanisme SPEC-184/196 yang
// sudah ada — pintu ini MEMBANGUN DI ATASNYA, bukan membuat deteksi baru), membaca layarnya,
// memutuskan, lalu mengetik jawabannya ke pane. Sesi melanjutkan pekerjaannya tanpa tahu siapa yang
// menjawab (US-6).

/**
 * AC-11 / OQ-10 · berapa jawaban otomatis BERTURUT-TURUT sudah diberikan untuk satu sesi.
 *
 * Sengaja TIDAK di-reset saat marker kosong: marker memang kosong sesaat setelah lead mengetik
 * (hook `UserPromptSubmit` menjalankan `: > <marker>`), jadi reset di sana akan membuat pagarnya
 * tak pernah tercapai — persis loop tak berujung yang ingin dicegah AC-11. Yang mereset hanyalah
 * sesi yang benar-benar berakhir (`sweep`) dan campur tangan manusia (`resetSession`, dipanggil
 * route saat operator menimpa keputusan).
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
 * operator (`resetSession`), dan oleh sesi yang berakhir (`sweep`) — sama seperti `answers`.
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
 * Dibersihkan oleh yang sama dengan penghitung lain: rantai tuntas, `sweep`, dan `resetSession`.
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
 * SPEC-487 (QA) · berapa tangkapan layar dibutuhkan sebelum "rantainya sudah tuntas" boleh
 * dipercaya (±1,5 dtk).
 *
 * Vonis itu MENGOSONGKAN marker, dan marker sebuah dialog hanya terisi SEKALI (SPEC-474: 0 B
 * selama 120 dtk dengan dialognya masih terbuka) — jadi vonis yang salah membuat sisa rantainya
 * tak terjangkau siapa pun. Sementara itu `waitScreenChange` pulang begitu `dialogKey` berubah,
 * termasuk berubah jadi `"none"` pada satu frame setengah-render di antara dua pertanyaan. Satu
 * tangkapan karena itu bukan bukti; beberapa tangkapan berturut-turut baru bukti.
 *
 * Cermin `SUBMIT_TRIES` (tui-dialog.ts): yang mahal bukan jedanya, melainkan salah membaca layar
 * setengah jadi.
 */
const CHAIN_END_TRIES = 5;

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
  // SPEC-903 · ADR-0143 · `liveDecisions()` juga mengembalikan `waiting` (bit turunan pil terminal);
  // pintu ini SENGAJA tak memakainya — gerbangnya sendiri, `AGENT_TURN_LINE` di readPaneQuestion
  // (SPEC-487, pemisahan terukur 6/6 vs 0/16), berbasis ISI layar dan lebih kuat. Bentuk yang lebih
  // sempit di sini adalah pernyataan itu, bukan kelalaian.
  live: () => { id: string; specId?: string; projectId: string; decisionFile: string }[];
  filled: (file: string) => boolean;
  pane: (id: string) => string;
  agentOf: (id: string) => Agent | null;
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
  live: () => { try { return liveDecisions(); } catch { return []; } },
  filled: markerFilled,
  pane: (id) => capturePane(id),
  agentOf: (id) => { try { return getSession(id)?.agent ?? null; } catch { return null; } },
  // SPEC-402 · tmux tak terbaca ≠ pane mati. Ragu → perlakukan sebagai mati: yang hilang cuma satu
  // jawaban otomatis (sesi jatuh ke perilaku hari ini), sementara salah arah membuat lead mengetik
  // ke pane yang sudah tak ada.
  exited: (id) => { try { return getSession(id)?.exited ?? true; } catch { return true; } },
  send: (id, text, choices) => sendToPane(id, text, 50, choices),
  clearMarker,
  submit: (id) => submitPaneDialog(id),
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

export type DetectResult = { answered: string[]; skipped: { id: string; reason: string }[] };

/** Satu putaran pintu deteksi. Dipanggil denyut (engine.ts); tak pernah melempar ke pemanggil. */
export async function scanAndAnswer(deps: DetectDeps = prodDetectDeps): Promise<DetectResult> {
  const out: DetectResult = { answered: [], skipped: [] };
  const cfg = await deps.cfg();
  if (!cfg.enabled || cfg.paused) return out;
  const optIn = new Set(await deps.optIn());

  const sessions = deps.live();
  sweep(sessions.map((s) => s.id));

  // SPEC-479 (QA) · DUA TAHAP, dan pemisahannya adalah seluruh perbaikannya.
  //
  // Tahap 1 (di bawah) hanya menyaring dan — untuk sesi yang menabrak pagar — menulis satu baris
  // + notifikasi. Semuanya murah dan berurutan, jadi jejak & `skipped` tetap deterministik.
  // Tahap 2 menjalankan rantai dialognya BERBARENGAN, berbatas `maxConcurrent`.
  //
  // Sebelumnya keduanya satu loop `for`+`await`, dan itu membuat "berapa sesi dilayani sekaligus"
  // dijawab oleh bentuk kode: SATU. Terukur `maxInFlight = 1` dengan tangga tunggu linier
  // 0/204/407/614/832/1035 ms untuk 6 sesi, dan karena urutan `tmux list-panes -a` stabil, ekor
  // daftar selalu di ekor. Ditambah `busyDetect` (engine.ts) yang memulangkan tiap tick 5 detik
  // selama satu rantai berjalan — pada anggaran penuh satu sesi boleh memegang pintu ini 60,6 menit.
  const ready: { s: (typeof sessions)[number]; agent: Agent }[] = [];

  for (const s of sessions) {
    const skip = (reason: string) => out.skipped.push({ id: s.id, reason });
    if (!optIn.has(s.projectId)) { skip("project tak opt-in lead"); continue; }
    if (!leadActive(cfg, s.projectId)) { skip("lead dijeda untuk project ini"); continue; }
    // SPEC-487 (QA) · marker adalah PEMBERITAHUAN; layar adalah BUKTI. Hook `Notification` claude
    // mengisi marker sekali per dialog dan tak pernah menembak lagi (SPEC-474: 0 B / 120 dtk dengan
    // dialognya masih terbuka), jadi selama marker adalah satu-satunya kunci pintu ini, marker yang
    // dikosongkan lebih awal — oleh sebab apa pun — membuat dialognya tak terlihat SELAMANYA.
    // Terukur in-vivo: dialog terbuka + marker kosong = 0 percobaan dalam 20 denyut / 100 dtk, dan
    // sesinya tak muncul bahkan di `skipped`.
    //
    // Kunci kedua fail-closed secara konstruksi: `readDialogScreen` menuntut footer chord claude,
    // yang tak pernah dirender codex — AC-9 tetap utuh. Ongkosnya satu `capture-pane` per sesi
    // hidup per denyut untuk sesi ber-marker kosong (terukur 6,28 ms/panggilan, SPEC-479 temuan E).
    if (!deps.filled(s.decisionFile)
      && !(!deps.exited(s.id) && readDialogScreen(deps.pane(s.id)))) continue;   // tak menunggu apa-apa
    if (deps.exited(s.id)) { skip("pane mati"); continue; }   // AC-10

    if ((answers.get(s.id) ?? 0) >= cfg.maxAutoAnswers) {     // AC-11
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
      skip("batas jawaban otomatis tercapai");
      continue;
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
      skip("batas kegagalan beruntun tercapai");
      continue;
    }

    const agent = deps.agentOf(s.id) ?? "claude";
    const read = readPaneQuestion(deps.pane(s.id), agent);
    if (!read.asking) { skip(read.reason); continue; }        // AC-9

    ready.push({ s, agent });
  }

  await runPool(ready, cfg.maxConcurrent, async ({ s, agent }) => {
    const chain = await runChain(s, agent, deps);
    if (chain.acted && chain.done) {
      // SPEC-452/474 · marker dikosongkan HANYA sesudah layarnya bukan dialog lagi. Mengosongkannya
      // di tengah rantai (perilaku sebelum spec ini) membuat sisa rantai tak terlihat oleh siapa
      // pun: hook `Notification` claude mengisi marker SEKALI per dialog dan tak pernah menembak
      // lagi — terukur 0 B selama 120 dtk dengan dialognya masih terbuka.
      deps.clearMarker(s.decisionFile);
      answers.set(s.id, (answers.get(s.id) ?? 0) + 1);   // satu RANTAI = satu jawaban otomatis
      failures.delete(s.id);   // SPEC-472 · "beruntun" — satu keberhasilan memutus rantainya
      out.answered.push(s.id);
      return;
    }
    if (chain.failed) {
      failures.set(s.id, (failures.get(s.id) ?? 0) + 1);
      failedAt.set(s.id, deps.now());
    }
    out.skipped.push({ id: s.id, reason: chain.reason });
  });
  return out;
}

type ChainResult = {
  /** Minimal satu jawaban terkirim atau satu submit berhasil. */
  acted: boolean;
  /** Layarnya sudah bukan dialog lagi — rantainya benar-benar tuntas. */
  done: boolean;
  /** Kegagalan yang layak dihitung (bukan sekadar lead dijeda di tengah panggilan). */
  failed: boolean;
  reason: string;
};

/**
 * SPEC-474 · satu RANTAI `AskUserQuestion`: jawab pertanyaan yang tampil, tunggu layarnya
 * berganti, ulangi, lalu tutup dengan submit.
 *
 * Semuanya dalam SATU putaran deteksi. Menunggu denyut berikutnya bukan pilihan: begitu marker
 * dikosongkan ia tak pernah terisi lagi, dan membiarkannya terisi pun tak menolong karena setiap
 * mata rantai baru akan membayar satu jatah `maxAutoAnswers` — dialog 4 pertanyaan (maksimum yang
 * diizinkan kontrak tool) menjadi mustahil selesai pada setelan default.
 */
async function runChain(
  s: { id: string; specId?: string; projectId: string },
  agent: Agent,
  deps: DetectDeps,
): Promise<ChainResult> {
  let acted = false;
  // SPEC-487 · seluruh rantai duduk di SATU `LeadFlow` (ADR-0102), termasuk saat ia menyeberangi
  // beberapa denyut. `done()` menutupnya; jalan keluar lain sengaja meninggalkannya terbuka supaya
  // lanjutannya menyusul ke alur yang sama.
  const done = async (r: ChainResult): Promise<ChainResult> => {
    const flowId = chainFlows.get(s.id);
    if (flowId) { chainFlows.delete(s.id); await deps.closeChain(flowId).catch(() => {}); }
    return r;
  };
  for (let step = 0; step < MAX_CHAIN_STEPS; step++) {
    // SPEC-487 · di langkah > 0, "layarnya bukan dialog lagi" adalah VONIS yang mengosongkan marker
    // — dan marker sebuah dialog hanya terisi sekali. Karena itu ia dibaca dari tangkapan yang
    // sudah TENANG, bukan dari satu tangkapan yang bisa saja mendarat di frame setengah-render.
    // Langkah 0 tak butuh itu: di sana layar memang boleh bukan dialog (jalur kolom chat lama).
    const text = step === 0 ? deps.pane(s.id) : await settledPane(s.id, deps);
    const screen = readDialogScreen(text);

    // Layar rekap: langkah MEKANIS, tanpa agen. Menekan `Submit answers` tak butuh pertimbangan —
    // seluruh jawabannya sudah masuk, yang tersisa hanya menutup dialognya.
    if (screen?.kind === "review") {
      if (!(await deps.submit(s.id)))
        return { acted, done: false, failed: true, reason: "gagal menekan Submit answers" };
      acted = true;
      continue;
    }

    // Layarnya sudah bukan dialog → rantai tuntas. Langkah 0 sengaja dikecualikan: di sana layar
    // memang boleh berupa kolom chat biasa, dan itu jalur lama yang harus tetap dilayani.
    //
    if (step > 0 && !screen) return done({ acted, done: true, failed: false, reason: "" });

    const read = readPaneQuestion(text, agent);
    if (!read.asking) {
      return step === 0
        ? { acted, done: false, failed: false, reason: read.reason }
        : done({ acted, done: true, failed: false, reason: "" });
    }

    // SPEC-452 · saat layarnya dialog pilihan, jawaban lead dimasukkan lewat KOLOM JAWABAN BEBAS
    // dialog itu ("Type something.") — bukan dengan menekan nomor opsi. Jadi lead diminta menulis
    // jawaban yang berdiri sendiri (boleh menyebut opsi yang dipilihnya), bukan nomor telanjang.
    const notes = [`Sesi ini menunggu di terminal; teks di bawah adalah layar terakhirnya. Jawablah sebagai masukan yang bisa langsung diketik ke terminal itu (isi \`reply\`).`];
    if (read.choices.length) {
      // SPEC-480 · yang dituntut sekarang `choice`, bukan prosa yang menyebut opsinya: server
      // yang merangkai kalimat jawabannya dari label opsi verbatim.
      notes.push("Layarnya adalah dialog pilihan. Isi `choice` dengan nomor atau label opsi yang kamu pilih — server yang merangkai kalimat jawabannya dari label itu, jadi `reply` tak perlu mengulanginya.");
    }
    // SPEC-474 · dialog berantai menampilkan SATU pertanyaan pada satu waktu. Tanpa keterangan ini
    // lead melihat layar yang seolah berdiri sendiri dan bisa mencoba menjawab semuanya sekaligus.
    if (screen?.kind === "question" && screen.tabs.length > 1) {
      const at = screen.tabs.findIndex((t) => !t.answered);
      notes.push(
        `Dialog ini BERANTAI: ${screen.tabs.length} pertanyaan dalam satu tanya `
        + `(${screen.tabs.map((t) => `${t.answered ? "sudah" : "belum"}: ${t.header}`).join(", ")}). `
        + `Yang sedang tampil pertanyaan ke-${at + 1}; jawab HANYA pertanyaan itu — sisanya akan `
        + `ditanyakan sesudah ini.`,
      );
    }

    // SPEC-479 (QA) · gerbang penuh BUKAN kegagalan lead (`failed: false`). Pagar `failures`
    // SPEC-472 dibuat untuk sebab yang TAK HILANG dengan mengulang — kunci ditolak, kuota habis,
    // biner tak terpasang. Penuh adalah kebalikannya: ia hilang begitu slot bebas. Menghitungnya
    // membuat tiga lonjakan beban menutup lead bagi sesi ini selamanya, karena `failCapped` adalah
    // keadaan MENYERAP (tanpa percobaan tak ada keberhasilan, tanpa keberhasilan tak ada reset) —
    // terukur nol percobaan baru dalam 10 denyut sesudah bebannya hilang.
    //
    // Rantai yang terputus di tengah aman ditinggalkan: markernya belum dikosongkan, jadi denyut
    // berikutnya membaca layar dialog apa adanya dan melanjutkan dari pertanyaan yang tampil.
    //
    // SPEC-487 · `chain: true` SELALU dikirim: `runChain` — bukan agen peminta mana pun — adalah
    // penggerak rantai yang sesungguhnya di produksi, dan tanpa bendera itu `decide()` menutup
    // alurnya sebagai `tunggal` di tiap langkah. Terukur sebelum perbaikan ini: 22 dari 22 baris
    // `gate="detected"` ber-`step = 1` dan ketiga alurnya `tunggal`, padahal ketiganya satu dialog
    // 3-pertanyaan. Konsekuensinya `chainSteps` selalu kosong, dan tiap langkah memutuskan tanpa
    // tahu langkah sebelumnya — persis "konteks hilang di antaranya" yang ADR-0102 ada untuk
    // menutupnya.
    const ask = {
      projectId: s.projectId, specId: s.specId, sessionId: s.id,
      gate: "detected" as const, kind: "answer" as const,
      question: read.question,
      options: read.choices.length ? read.choices : undefined,
      notes, chain: true,
    };
    let row: LeadDecision | null;
    try {
      row = await deps.decide({ ...ask, flowId: chainFlows.get(s.id) ?? null }, deps.decideDeps);
    } catch (e) {
      if (e instanceof LeadBusyError) return { acted, done: false, failed: false, reason: `lead penuh — ${e.message}` };
      // Alur yang kedaluwarsa di tengah rantai panjang (`flowTtlMin`) tak boleh menjatuhkan
      // rantainya: lepaskan ingatannya dan mulai alur baru dari langkah ini.
      if (!(e instanceof LeadFlowClosedError)) throw e;
      chainFlows.delete(s.id);
      try { row = await deps.decide({ ...ask, flowId: null }, deps.decideDeps); }
      catch (e2) {
        if (e2 instanceof LeadBusyError) return { acted, done: false, failed: false, reason: `lead penuh — ${e2.message}` };
        throw e2;
      }
    }
    if (row?.flowId) chainFlows.set(s.id, row.flowId);
    // `null` = lead baru saja dijeda/dimatikan di tengah panggilan — bukan kegagalan lead, jadi tak
    // dihitung. Baris ber-status `gagal` ADALAH kegagalan: ia yang harus punya ujung (SPEC-472).
    if (!row) return { acted, done: false, failed: false, reason: "lead tak menghasilkan keputusan yang berlaku" };
    if (row.status !== "berlaku")
      return { acted, done: false, failed: true, reason: "lead tak menghasilkan keputusan yang berlaku" };

    // SPEC-480 · teks yang diketik DIRAKIT dari putusan terstruktur, bukan dipungut dari prosa:
    // pilihan yang terselesaikan disebut dengan LABEL VERBATIM, konteks yang kurang disebut apa
    // adanya, dan panjangnya sudah dipagari sebelum menyentuh `goalChunks`. Saluran pengiriman
    // hidup di memori dan berumur satu ketikan, jadi ia bisa saja meleset: yang selalu ada adalah
    // `answer`. Jangan pernah mengetik string kosong ke pane hanya karena saluran itu kosong.
    const sent = deps.delivery(row.id);
    const reply = (sent ? leadReplyText(sent) : "") || row.answer;
    // SPEC-485 · label opsi terpilih diteruskan apa adanya; `sendToPane` yang memetakannya ke nomor
    // baris terhadap opsi LAYAR ITU. Dialog non-multi mengabaikannya — jalur SPEC-452/474 utuh.
    const picked = sent?.choices.map((c) => c.option) ?? [];
    if (!(await deps.send(s.id, reply, picked)))
      return { acted, done: false, failed: true, reason: "gagal mengetik ke pane" };
    acted = true;

    // Kolom chat biasa: satu jawaban lalu selesai — perilaku persis sebelum spec ini.
    if (!screen) return done({ acted, done: true, failed: false, reason: "" });

    // Dialog: tunggu layarnya BENAR-BENAR berganti sebelum mata rantai berikutnya dibaca. Tanpa
    // jeda ini tangkapan berikutnya masih layar yang sama, dan gerbang anti-loop akan menutup
    // rantai yang sebenarnya sehat.
    if (!(await waitScreenChange(s.id, dialogKey(text), deps)))
      return { acted, done: false, failed: true, reason: "layar dialog tak berubah sesudah dijawab" };
  }
  return { acted, done: false, failed: true, reason: "batas langkah rantai dialog tercapai" };
}

/**
 * SPEC-487 · tangkapan layar yang sudah TENANG: kembalikan tangkapan pertama yang berupa dialog,
 * atau — bila memang tak ada lagi — tangkapan terakhir sesudah `CHAIN_END_TRIES` percobaan.
 *
 * Bukan `waitScreenChange` yang lain: yang itu menunggu layar BERGANTI (dan karena itu puas oleh
 * frame apa pun yang berbeda), yang ini menunggu layar BERHENTI berubah bentuk. Keduanya dibutuhkan
 * di tempat yang berbeda, dan menggabungkannya akan membuat salah satunya kehilangan artinya.
 */
async function settledPane(id: string, deps: DetectDeps): Promise<string> {
  let text = deps.pane(id);
  for (let i = 0; i < CHAIN_END_TRIES && !readDialogScreen(text); i++) {
    await deps.sleep(CHAIN_POLL_MS);
    text = deps.pane(id);
  }
  return text;
}

async function waitScreenChange(id: string, before: string, deps: DetectDeps): Promise<boolean> {
  for (let i = 0; i < CHAIN_POLL_TRIES; i++) {
    await deps.sleep(CHAIN_POLL_MS);
    if (dialogKey(deps.pane(id)) !== before) return true;
  }
  return false;
}

/** Buang penghitung sesi yang sudah tak ada — id sesi spec deterministik dan bisa lahir lagi. */
function sweep(liveIds: string[]): void {
  const live = new Set(liveIds);
  for (const id of [...answers.keys()]) if (!live.has(id)) answers.delete(id);
  for (const id of [...capped]) if (!live.has(id)) capped.delete(id);
  for (const id of [...failures.keys()]) if (!live.has(id)) failures.delete(id);
  for (const id of [...failCapped]) if (!live.has(id)) failCapped.delete(id);
  for (const id of [...failedAt.keys()]) if (!live.has(id)) failedAt.delete(id);
  // Alur rantainya sendiri tak ikut ditutup di sini: penyapu TTL (ADR-0102) yang mengurusnya, dan
  // "peminta mati di tengah rantai" memang tepat keadaan yang `kedaluwarsa` ada untuk menamainya.
  for (const id of [...chainFlows.keys()]) if (!live.has(id)) chainFlows.delete(id);
}
