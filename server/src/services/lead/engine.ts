import type { Lead } from "@hanoman/shared";
import { getLead } from "./config";
import { pulse, prodPulseDeps, type PulseDeps } from "./pulse";
import { pruneAsks } from "./ask";
import { expireFlows } from "./flow";
import { recordLeadDecision, recordLegacySession } from "../notifications";
import { liveDecisions } from "../pty";

// SPEC-409 · ADR-0091 · SPEC-909 · ADR-0146 · irama hanoman-lead.
//
// ADR-0091 §5 memberi DUA irama: pintu deteksi tiap 5 detik dan denyut proaktif tiap `everyMin`.
// Irama pertama DICABUT. Pertanyaan sesi kini tiba sebagai event hook (`routes/session-events.ts`
// → `lead/ask.ts`) dan tak pernah lagi menunggu giliran timer mana pun — terukur, jalur lama
// membayar 6,05 dtk (hook `Notification` idle) + setengah tick sebelum sesi yang bertanya bahkan
// DILIHAT, plus satu `capture-pane` per sesi hidup tiap 5 detik saat tak ada yang bertanya.
//
// Yang tersisa satu irama RUMAH TANGGA: menyapu rantai kedaluwarsa, memangkas penghitung sesi mati,
// menagih denyut yang jatuh tempo, dan memberi tahu sesi pra-pembaruan. Jumlah timer BERKURANG,
// bukan bertambah — ADR-0024 utuh, dan tak ada kanal WebSocket baru (ADR-0039 utuh).
export const HOUSEKEEPING_MS = 60_000;

// SPEC-432 · penjaga re-entrancy denyut proaktif. Dulu ada dua (`busyDetect` untuk pintu deteksi);
// yang satu itu ikut dicabut bersama pemindainya — SPEC-909 memberi pintu deteksi penjaganya
// sendiri per SESI (`lead/ask.ts`), bukan satu bendera global yang memulangkan seluruh tick.
let busyPulse = false;

// `lastPulseAt` = denyut terakhir DIMULAI (dibaca `/lead/status`). `pulseEndedAt` = denyut terakhir
// SELESAI, dan jatuh-temponya dihitung dari yang paling belakang di antara keduanya: menstempel
// hanya di awal membuat denyut yang lebih lama dari `everyMin` langsung jatuh tempo lagi begitu ia
// selesai — `everyMin` berhenti jadi lantai, dan denyut berikutnya menyentuh git tanpa jeda.
let lastPulseAt = 0;
let pulseEndedAt = 0;
let timer: NodeJS.Timeout | undefined;

export function lastPulse(): number { return lastPulseAt; }
export function __resetEngine(): void {
  lastPulseAt = 0; pulseEndedAt = 0; busyPulse = false;
}

export type LeadTickDeps = {
  pulse?: PulseDeps;
  /** Jam untuk menstempel AKHIR denyut. Di-inject agar jeda "sejak selesai" teruji deterministik. */
  now?: () => number;
  /**
   * SPEC-485 · ADR-0102 · penyapu RANTAI yang ditinggalkan. Ia MENUMPANG tick ini, bukan membuat
   * `setInterval` sendiri — ADR-0024 melarang timer/scheduler baru, dan pola ini sama dengan
   * penguras antrean webhook (ADR-0100) & governor scheduler (ADR-0072).
   */
  expire?: (now: Date) => Promise<{ id: string; projectId: string; specId: string | null; sessionId: string | null; title: string }[]>;
  notify?: (id: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
  /** SPEC-909 · sesi hidup + apakah ia lahir dengan hook event. */
  live?: () => { id: string; projectId: string; specId?: string; waiting: boolean; eventHook: boolean }[];
  legacy?: (sessionId: string, projectId: string | null, specId: string | null) => Promise<void>;
  /** SPEC-909 · pemangkas penghitung sesi mati — pengganti `sweep()` yang dulu ikut pemindaian. */
  prune?: () => void;
  cfg?: () => Promise<Lead>;
};

/**
 * Satu tick rumah tangga. `now` di-parameter agar cadence teruji deterministik (pola scheduler).
 *
 * AC-27 · Pause menghentikan keputusan BARU: master switch & Pause dibaca ulang di sini, di
 * `admitAsk`, DAN di `decide()`. Yang sedang berjalan dibiarkan selesai; sesi yang sedang bekerja
 * tak disentuh sama sekali.
 *
 * AC-37 · seluruh isinya dibungkus try/catch: lead yang mati (agennya crash, kuota habis, git
 * gagal) tak boleh menjatuhkan proses server maupun menghentikan sesi yang sedang berjalan.
 */
export async function tick(now: number, deps: LeadTickDeps = {}): Promise<void> {
  let cfg;
  try { cfg = await (deps.cfg ?? getLead)(); }
  catch (e) { console.error("lead tick:", e); return; }
  if (!cfg.enabled) return;            // AC-30 · master switch mati → hanoman apa adanya

  const jobs: Promise<void>[] = [];

  // SPEC-485 · penyapu rantai kedaluwarsa. Murah (satu query berindeks `status`), dan TANPA penjaga
  // re-entrancy: `expireFlows` idempoten — `closeFlow` melewatkan alur yang sudah tertutup. Ia
  // sengaja TIDAK digerbangi `cfg.paused`: Pause menghentikan keputusan BARU (AC-27), sementara ini
  // justru menutup alur yang sudah tak akan pernah dijawab siapa pun.
  jobs.push((async () => {
    const expire = deps.expire ?? expireFlows;
    const notify = deps.notify ?? recordLeadDecision;
    for (const f of await expire(new Date())) {
      await notify(f.id, `Rantai keputusan lead ditutup karena kedaluwarsa: ${f.title.slice(0, 80)}`,
        f.projectId, f.specId, f.sessionId);
    }
  })().catch((e) => { console.error("lead expire:", e); }));

  // SPEC-909 · dua pekerjaan yang berbagi SATU bacaan `liveDecisions()` — yaitu satu
  // `tmux list-panes -a`, bukan satu per sesi. Nol `capture-pane`, nol panggilan agen.
  //
  // (a) Sesi pra-pembaruan: lahir tanpa hook event, jadi lead tak akan menjawabnya. Digantung di
  //     tick LEAD, bukan pada `scanDecisions()` milik scheduler: jalur itu memulangkan tick lebih
  //     dulu saat master switch scheduler mati, dan sesi yang menggantung tak boleh bergantung pada
  //     setelan subsistem lain.
  // (b) Pemangkasan penghitung: id sesi spec deterministik dan bisa LAHIR LAGI, jadi sesi yang mati
  //     lalu dilahirkan ulang tanpa satu pun event di antaranya akan mewarisi `answers`/`failures`
  //     nyawa sebelumnya — dan AC-11 menutupnya sebelum ia sempat bertanya sekali pun.
  jobs.push((async () => {
    const live = deps.live ?? liveDecisions;
    const legacy = deps.legacy ?? recordLegacySession;
    for (const s of live()) {
      if (s.eventHook || !s.waiting) continue;
      await legacy(s.id, s.projectId || null, s.specId ?? null);
    }
    (deps.prune ?? pruneAsks)();
  })().catch((e) => { console.error("lead legacy:", e); }));

  // Rem darurat: denyut proaktif ikut diam saat Pause.
  if (!cfg.paused && !busyPulse && now - Math.max(lastPulseAt, pulseEndedAt) >= cfg.everyMin * 60_000) {
    busyPulse = true;
    lastPulseAt = now;
    const clock = deps.now ?? Date.now;
    jobs.push(pulse(deps.pulse ?? prodPulseDeps)
      .then(() => { /* hasilnya dipakai test, bukan engine */ })
      .catch((e) => { console.error("lead pulse:", e); })
      .finally(() => { pulseEndedAt = clock(); busyPulse = false; }));
  }

  await Promise.all(jobs);
}

// Dipanggil server.ts SAJA (app.ts bebas-timer, seperti scheduler). unref → tak menahan proses.
export function startLead(deps: LeadTickDeps = {}): void {
  if (timer) return;
  timer = setInterval(() => void tick(Date.now(), deps), HOUSEKEEPING_MS);
  timer.unref();
  void tick(Date.now(), deps);
}
export function stopLead(): void { if (timer) clearInterval(timer); timer = undefined; }
