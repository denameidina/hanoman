import { prisma } from "../../db";
import type { LeadDecision } from "@prisma/client";
import type { Lead, Scheduler } from "@hanoman/shared";
import { listSessionsAsync, sessionFinishedAsync } from "../pty";
import { planCompleteAsync } from "../session-phases";
import { resolveRepoDir } from "../local-binding";
import { specReview } from "../spec-review";
import { enqueue, UNSTARTED_SPEC_WHERE } from "../scheduler/queue";
import { blockersForSpec } from "../spec-deps";
import { getScheduler } from "../scheduler/config";
import { recordLeadDecision } from "../notifications";
import { getLead, leadActive, leadProjects } from "./config";
import { decide, prodDecideDeps, type DecideDeps } from "./decide";
import { LeadBusyError } from "./gate";
import { applyAction } from "./apply";
import { recordDecision } from "./trail";

// SPEC-409 · ADR-0091 · PINTU #3 — denyut proaktif. Tiga pekerjaan yang tak dipicu siapa-siapa:
// menata urutan kerja, mendeteksi tabrakan area kerja, dan menindaklanjuti sesi yang baru selesai.
//
// AC-12 · denyut hidup di dalam proses server (setInterval, engine.ts) — TANPA message queue,
// worker terpisah, atau cron eksternal (ADR-0024). AC-13 · urutan yang ia putuskan diserahkan ke
// antrean & governor yang sudah ada (ADR-0072); tak ada antrean kedua.

// ── Area kerja (OQ-9) ────────────────────────────────────────────────────────────────────────
// "Area kerja" diturunkan dari BERKAS YANG SUDAH BERUBAH di worktree sesi, bukan dari plan atau
// isi backlog: plan menyatakan niat (dan sering meleset), diff menyatakan kenyataan. Sumbernya
// `specReview` yang sudah dipakai layar Review — satu definisi "apa yang disentuh sesi ini".

export type WorkArea = { specId: string; sessionId: string; projectId: string; paths: string[] };
export type Collision = { a: WorkArea; b: WorkArea; shared: string[]; nearby: string[] };

/** Dua segmen pertama sebuah path = "modul". `server/src/services/x.ts` → `server/src`. */
const moduleOf = (p: string): string => p.split("/").slice(0, 2).join("/");

/**
 * AC-14 · dua pekerjaan yang menyentuh area sama. Murni, supaya definisinya bisa diuji tanpa git.
 * `shared` = berkas yang SAMA persis (tabrakan hampir pasti). `nearby` = modul yang sama tanpa
 * berkas yang sama (sinyal lebih lemah, tetap dilaporkan — konflik integrasi lahir di sana juga).
 * Pasangan tanpa keduanya bukan tabrakan dan tak menghabiskan satu giliran lead pun.
 */
export function findCollisions(areas: WorkArea[]): Collision[] {
  const out: Collision[] = [];
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i]!, b = areas[j]!;
      if (a.projectId !== b.projectId) continue;
      const bp = new Set(b.paths);
      const shared = a.paths.filter((p) => bp.has(p));
      const bm = new Set(b.paths.map(moduleOf));
      const nearby = [...new Set(a.paths.map(moduleOf))].filter((m) => bm.has(m) && !shared.some((s) => moduleOf(s) === m));
      if (shared.length || nearby.length) out.push({ a, b, shared, nearby });
    }
  }
  return out;
}

// SPEC-1267 · pembacaan sesi/plan di denyut ini asinkron (event loop yang sama melayani PTY);
// fake sinkron di test tetap sah.
type Maybe<T> = T | Promise<T>;

// ── Deps ─────────────────────────────────────────────────────────────────────────────────────
export type PulseDeps = {
  sessions: () => Maybe<{ id: string; projectId: string; specId?: string; cwd: string; exited: boolean; exitCode?: number }[]>;
  areas: (s: { id: string; projectId: string; specId: string }) => Promise<string[]>;
  planDone: (cwd: string, specId: string) => Maybe<boolean>;
  /**
   * SPEC-451 · verdict "pekerjaan sesi ini sudah selesai" (SPEC-433) — fakta yang BERDIRI SENDIRI
   * di sebelah `exited`. Ia yang menggerbangi pintu keberhasilan; `exited` menggerbangi pintu
   * kegagalan. Memakai `exited` untuk keduanya adalah konflasi yang sama yang ditutup SPEC-402/433.
   */
  finished: (sessionId: string) => Maybe<boolean>;
  decide: typeof decide;
  decideDeps: DecideDeps;
  apply: typeof applyAction;
  enqueue: typeof enqueue;
  notify: (id: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
  optIn: () => Promise<string[]>;
  cfg: () => Promise<Lead>;
  /** SPEC-432 · penataan urutan hanya berarti bila antrean memang dikuras — lihat `orderProject`. */
  scheduler: () => Promise<Scheduler>;
};

export const prodPulseDeps: PulseDeps = {
  sessions: () => listSessionsAsync().catch(() => []),
  areas: async (s) => {
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return [];
    const spec = await prisma.spec.findUnique({ where: { id: s.specId }, select: { baseSha: true, branchFrom: true } });
    if (!spec) return [];
    try {
      const r = await specReview(repoDir, s.specId, spec.baseSha, spec.branchFrom);
      return r.changed.map((c) => c.path);
    } catch { return []; }   // worktree sudah lenyap / basis tak resolve → bukan area kerja
  },
  planDone: planCompleteAsync,
  finished: (id) => sessionFinishedAsync(id).catch(() => false),
  decide,
  decideDeps: prodDecideDeps,
  apply: applyAction,
  enqueue,
  notify: recordLeadDecision,
  optIn: leadProjects,
  cfg: getLead,
  scheduler: getScheduler,
};

export type PulseResult = { ordered: number; collisions: number; quality: number };

/**
 * SPEC-479 (QA) · gerbang lead penuh → lewati pekerjaan INI saja, coba lagi denyut berikutnya.
 *
 * SATU definisi untuk keempat call site denyut, bukan empat `try/catch` yang sama — kelas bug
 * SPEC-431/448/475, yang tiga kali lahir dari perilaku yang disalin alih-alih dibagi.
 *
 * `null` dipilih sengaja: keempat pemanggil sudah memperlakukan `null` sebagai "tak ada yang
 * terjadi, lewati" (itu arti lead-tak-aktif sejak ADR-0091), dan penuh menuntut penanganan yang
 * persis sama. Melempar ke atas terlihat setara — `pulse()` membungkus tiap sub-pintu dengan
 * try/catch — tapi tidak: galat yang lolos membatalkan SISA sesi di sub-pintu itu, yaitu
 * head-of-line yang sama yang sedang diperbaiki, hanya lebih kecil.
 *
 * Yang penting ia TIDAK menulis baris jejak: idempotensi denyut memakai jejak (SPEC-432), jadi
 * baris untuk permintaan yang belum pernah sampai ke agen akan membuat sesi itu dianggap sudah
 * diputuskan dan pertanyaannya hilang selamanya.
 */
async function decideOrSkip(
  deps: PulseDeps, req: Parameters<typeof decide>[0],
): Promise<LeadDecision | null> {
  try { return await deps.decide(req, deps.decideDeps); }
  catch (e) {
    if (e instanceof LeadBusyError) return null;
    throw e;
  }
}

// OQ-2 · jangan membakar kuota saat tak ada yang berubah: satu putusan penataan hanya lahir saat
// himpunan backlog siap-kerja BERBEDA dari yang terakhir ditata. In-memory & sengaja begitu —
// setelah restart satu penataan ulang jauh lebih murah daripada kolom DB untuk nilai turunan.
// PER PROJECT, bukan global: satu lead melayani satu project (NG1), jadi backlog project A yang
// berubah tak boleh menghabiskan giliran lead untuk project B — dan sebaliknya, project B yang diam
// tak boleh menahan penataan project A hanya karena tanda tangan gabungannya tak berubah.
const lastReadySig = new Map<string, string>();
export function __resetPulse(): void { lastReadySig.clear(); }

/** Satu denyut. Tak pernah melempar: satu bagian gagal tak boleh menghentikan dua yang lain. */
export async function pulse(deps: PulseDeps = prodPulseDeps): Promise<PulseResult> {
  const res: PulseResult = { ordered: 0, collisions: 0, quality: 0 };
  const cfg = await deps.cfg();
  if (!cfg.enabled || cfg.paused) return res;
  const optIn = (await deps.optIn()).filter((p) => leadActive(cfg, p));
  if (!optIn.length) return res;

  try { res.quality = await followUpFinished(cfg, optIn, deps); } catch { /* satu bagian gagal tak menghentikan sisanya */ }
  try { res.quality += await followUpComplete(optIn, deps); } catch { /* idem */ }
  try { res.collisions = await detectCollisions(optIn, deps); } catch { /* idem */ }
  try { res.ordered = await orderReadyWork(optIn, deps); } catch { /* idem */ }
  return res;
}

// ── D · mutu: sesi yang baru selesai ─────────────────────────────────────────────────────────
/**
 * AC-16 · sesi berakhir dengan kode keluar ≠ 0 → lead memutuskan tindak lanjutnya.
 * AC-17 · sesi berakhir sementara plan-nya masih menyisakan `- [ ]` → pekerjaan belum tuntas.
 * AC-18 · bila putusannya "lanjutkan", jalur yang dipakai adalah jalur lanjutkan-sesi yang sudah
 *         ada (ADR-0084) — dan basis review (`baseSha`) tak pernah ditulis ulang. Route yang
 *         mengeksekusi tindakan itu memanggil `startSpecSession` apa adanya.
 *
 * OQ-13 · sesi DOKUMEN (prd/audit/reverse/scaffold/breakdown) tak punya plan berkotak; ia hanya
 * dinilai lewat kode keluar. Sesi tanpa specId dilewati seluruhnya di versi ini.
 */
async function followUpFinished(cfg: Lead, optIn: string[], deps: PulseDeps): Promise<number> {
  let n = 0;
  const opt = new Set(optIn);
  for (const s of await deps.sessions()) {
    if (!s.exited || !s.specId || !opt.has(s.projectId)) continue;
    const bad = (s.exitCode ?? 0) !== 0;
    const unfinished = !(await deps.planDone(s.cwd, s.specId));
    if (!bad && !unfinished) continue;
    // Idempoten lewat JEJAK, bukan Set memori: sesi mati bertahan di tmux (`remain-on-exit on`)
    // berhari-hari, dan denyut tiap 5 menit akan memutuskan hal yang sama berulang kali —
    // termasuk sesudah server restart, yang justru saat Set memori kosong.
    //
    // SPEC-432 · kuncinya BUKAN `kind`. `decide()` menulis ulang `kind` jadi "refusal" begitu
    // tindakan usulan lead di luar allowlist, jadi kunci ber-`kind` meleset persis pada baris yang
    // sudah ditulis — dan sesi yang sama ditanyakan ulang tiap denyut, selamanya. Yang stabil
    // adalah awalan pertanyaannya: ia deterministik per sesi dan tak pernah dimiliki pintu lain
    // (pertanyaan tabrakan berbunyi "Dua pekerjaan menyentuh …").
    const mark = `Sesi ${s.id} untuk backlog ${s.specId}`;
    const seen = await prisma.leadDecision.findFirst({
      where: { sessionId: s.id, gate: "pulse", question: { startsWith: mark } },
    });
    if (seen) continue;
    const why = [bad ? `berakhir dengan kode keluar ${s.exitCode}` : null,
      unfinished ? "plan-nya masih menyisakan kotak `- [ ]`" : null].filter(Boolean).join(" dan ");
    const row = await decideOrSkip(deps, {
      projectId: s.projectId, specId: s.specId, sessionId: s.id,
      gate: "pulse", kind: "quality",
      question: `${mark} ${why}. Tindak lanjutnya apa: lanjutkan pekerjaan yang terputus, ulangi dari awal, atau hentikan?`,
      options: [
        "resume-session — lanjutkan dari keadaan worktree sekarang (ADR-0084)",
        "restart-session — ulangi dari awal",
        "none — terima apa adanya, sertakan alasannya",
      ],
      notes: [`Worktree sesi: ${s.cwd}`],
    });
    if (!row) continue;
    n++;
    // Lead memutuskan LALU melapor — tindak lanjutnya dijalankan di sini, bukan menunggu operator
    // menekan sesuatu. Kegagalan tindakan tak menghentikan denyut: barisnya sudah tercatat, dan
    // sesi tetap berada di keadaan yang sama seperti sebelum lead menyentuhnya.
    if (row.status === "berlaku" && row.action !== "none") {
      try { await deps.apply(row); } catch { /* tindakan gagal; jejaknya tetap ada */ }
    }
  }
  return n;
}

// ── D · backlog yang sudah SELESAI (SPEC-451) ────────────────────────────────────────────────
/**
 * Pintu keberhasilan — pasangan `followUpFinished` di atas, yang hanya mengenal kegagalan.
 *
 * Kenapa ia harus ada sebagai pintu tersendiri: `followUpFinished` digerbangi `s.exited`, dan
 * SPEC-433 sudah membuktikan bahwa **pane sesi sukses tak pernah mati** — agen adalah TUI
 * interaktif yang kembali ke `❯` sesudah fase terakhir + push. Jadi keberhasilan bukan keadaan
 * yang jarang diputuskan, melainkan keadaan yang **secara struktural tak punya pintu sama sekali**:
 * `integrate-main` & `stop-session` sudah lengkap di `apply.ts` sejak ADR-0091 dan tak pernah
 * ditawarkan satu pun dari lima call site `decide()` di server.
 *
 * Harganya nyata: pane yang selesai-tapi-hidup terus dihitung `liveCount()` governor
 * (`scheduler/engine.ts`), jadi `maxConcurrent` sesi yang tuntas mengunci antrean selamanya.
 * Terukur 2026-08-01 di mesin operator: SPEC-450 `stage=done`, fase 5/5, plan 0 kotak, pane
 * `dead=0` menganggur di `❯` — 4 jam 24 menit memegang satu slot, nol baris keputusan.
 *
 * Gerbangnya SALING EKSKLUSIF dengan pintu kegagalan secara konstruksi: `finished` sudah memuat
 * `planComplete` (⇒ `!unfinished`) dan pintu ini menolak `exitCode ≠ 0`, jadi tak ada sesi yang
 * menerima dua pertanyaan — dua giliran agen — untuk satu keadaan.
 *
 * TIDAK digerbangi `Setting.scheduler` (beda dari `orderReadyWork`, yang penataannya memang tak
 * punya pembaca saat antrean tak dikuras): mengintegrasikan pekerjaan yang sudah selesai berharga
 * baik scheduler menyala maupun tidak.
 *
 * Marker keputusan (`decision`, SPEC-196) sengaja TIDAK dikonsultasi — `SessionInfo` yang dilihat
 * pintu ini bahkan tak membawanya. Itu mewarisi aturan SPEC-433 apa adanya: **`complete` menang
 * atas `awaiting`**, karena marker sesi codex menyala juga saat sesi selesai wajar (ADR-0074) dan
 * membiarkan `awaiting` menang akan mengulang bug ini untuk separuh agen. Pintu deteksi (#2) tetap
 * menjawab markernya lewat iramanya sendiri; keduanya tak saling menunggu.
 */
async function followUpComplete(optIn: string[], deps: PulseDeps): Promise<number> {
  let n = 0;
  const opt = new Set(optIn);
  for (const s of await deps.sessions()) {
    if (!s.specId || !opt.has(s.projectId)) continue;
    if ((s.exitCode ?? 0) !== 0) continue;        // yang gagal tetap milik pintu kegagalan
    if (!(await deps.finished(s.id))) continue;           // BUKAN `s.exited` — itulah seluruh temuannya
    // Idempoten lewat JEJAK, bukan Set memori (pane hidup bertahan berhari-hari, dan Set justru
    // kosong sesudah restart). Awalannya deterministik per sesi dan TAK dimiliki pintu lain:
    // pintu kegagalan memulai dengan "Sesi …", pintu tabrakan dengan "Dua pekerjaan menyentuh …".
    // Kuncinya sengaja bukan `kind` — `decide()` menulis ulang `kind` jadi "refusal" untuk
    // tindakan di luar allowlist, jadi kunci ber-`kind` meleset persis pada baris yang sudah
    // ditulis dan sesi yang sama ditanyakan ulang tiap denyut, selamanya (SPEC-432).
    const mark = `Backlog ${s.specId} sudah selesai di sesi ${s.id}`;
    const seen = await prisma.leadDecision.findFirst({
      where: { sessionId: s.id, gate: "pulse", question: { startsWith: mark } },
    });
    if (seen) continue;
    const row = await decideOrSkip(deps, {
      projectId: s.projectId, specId: s.specId, sessionId: s.id,
      gate: "pulse", kind: "quality",
      question: `${mark}: seluruh fasenya tercatat dan plan-nya tak menyisakan kotak \`- [ ]\`. Selama sesinya belum dilepas, ia memegang satu slot concurrency scheduler sehingga backlog lain tak bisa mulai. Integrasikan hasilnya ke main, hentikan sesinya saja, atau biarkan?`,
      options: [
        "integrate-main — merge branch sesi ini ke main; panenya ikut dilepas, worktree tetap utuh",
        "stop-session — lepas panenya tanpa mengintegrasikan (worktree tetap utuh, ADR-0084 masih bisa melanjutkan)",
        "none — biarkan sesinya berdiri, sertakan alasan kenapa slot itu layak ditahan",
      ],
      notes: [
        `Worktree sesi: ${s.cwd}`,
        // Rebase sengaja tak ditawarkan: `LEAD_ACTIONS` adalah konstanta tertutup (AC-31), dan
        // merge adalah yang PALING MUDAH DIBATALKAN dari keduanya — kriteria yang diperintahkan
        // prompt lead sendiri. Rebase tetap tindakan operator lewat POST /specs/:id/integrate.
        "Rebase tidak tersedia untukmu; bila hasilnya menuntut rebase, pilih `none` dan katakan begitu.",
      ],
    });
    if (!row) continue;
    n++;
    if (row.status === "berlaku" && row.action !== "none") {
      try { await deps.apply(row); } catch { /* tindakan gagal; jejaknya tetap ada */ }
    }
  }
  return n;
}

// ── D · tabrakan area kerja ──────────────────────────────────────────────────────────────────
async function detectCollisions(optIn: string[], deps: PulseDeps): Promise<number> {
  const opt = new Set(optIn);
  const live = (await deps.sessions()).filter((s) => !s.exited && s.specId && opt.has(s.projectId));
  if (live.length < 2) return 0;
  const areas: WorkArea[] = [];
  for (const s of live) {
    const paths = await deps.areas({ id: s.id, projectId: s.projectId, specId: s.specId! });
    if (paths.length) areas.push({ specId: s.specId!, sessionId: s.id, projectId: s.projectId, paths });
  }
  let n = 0;
  for (const c of findCollisions(areas)) {
    const key = [c.a.sessionId, c.b.sessionId].sort().join("|");
    // SPEC-432 · tanpa `kind`, alasan yang sama seperti di `followUpFinished`: `decide()` menulis
    // ulang `kind` jadi "refusal" untuk tindakan terkunci, dan pasangan yang sudah diputuskan akan
    // ditanyakan ulang tiap denyut. Kunci `key` di dalam pertanyaan sudah unik per pasangan.
    const seen = await prisma.leadDecision.findFirst({
      where: { gate: "pulse", question: { contains: key } },
    });
    if (seen) continue;
    const row = await decideOrSkip(deps, {
      projectId: c.a.projectId, specId: c.a.specId, sessionId: c.a.sessionId,
      gate: "pulse", kind: "collision",
      question: `Dua pekerjaan menyentuh area yang sama [${key}]: ${c.a.specId} dan ${c.b.specId}. Tunda salah satu, gabungkan, atau biarkan?`,
      options: [
        `hold-work — tunda salah satu sampai yang lain terintegrasi`,
        `none — biarkan berjalan, sertakan alasan kenapa tabrakan ini aman`,
      ],
      notes: [
        c.shared.length ? `Berkas yang sama: ${c.shared.slice(0, 20).join(", ")}` : "",
        c.nearby.length ? `Modul yang sama: ${c.nearby.slice(0, 20).join(", ")}` : "",
      ].filter(Boolean),
    });
    if (row) n++;
  }
  return n;
}

// ── D · urutan kerja ─────────────────────────────────────────────────────────────────────────
/**
 * AC-13 · lead menata, antrean & governor yang mengeksekusi. Urutan diwujudkan sebagai URUTAN
 * ENQUEUE, bukan dengan menulis ulang `Spec.priority`: prioritas adalah pernyataan operator, dan
 * `queued()` mengurutkan prioritas dulu baru FIFO — jadi lead menata DI DALAM setiap pita
 * prioritas. Itu batas yang diterima sadar di versi ini (lihat ADR-0091 §Konsekuensi).
 */
async function orderReadyWork(optIn: string[], deps: PulseDeps): Promise<number> {
  // SPEC-432 · gerbang PALING MURAH lebih dulu: selama subsistem scheduler mati atau dijeda, tak
  // ada yang menguras antrean sama sekali (`scheduler/engine.ts` berhenti sebelum `drain()`), jadi
  // urutan apa pun yang lead putuskan tak punya pembaca. Nol panggilan agen untuk SEMUA project.
  const sched = await deps.scheduler();
  if (!sched.enabled || sched.paused) return 0;
  let total = 0;
  for (const projectId of optIn) total += await orderProject(projectId, deps);
  return total;
}

/**
 * SPEC-432 · satu giliran lead hanya boleh dibeli oleh penataan yang benar-benar bisa berdampak.
 * Tiga syarat, semuanya diperiksa SEBELUM agen dipanggil:
 *
 * 1. Project-nya opt-in scheduler. `leadOptIn` dan `schedulerOptIn` adalah dua kolom berbeda, dan
 *    di mesin operator ada project yang opt-in lead tapi tidak scheduler — menata antreannya berarti
 *    menata sesuatu yang `sources/backlog.ts` & governor takkan pernah sentuh.
 * 2. Ada minimal dua backlog siap-kerja — TIDAK terblokir dependency (SPEC-447/ADR-0093: item
 *    yang menunggu backlog lain takkan pernah diluncurkan governor) — yang BELUM punya baris
 *    antrean. `enqueue()` adalah
 *    `upsert(..., update: {})`: spec yang sudah antre tak berubah sama sekali, termasuk
 *    `enqueuedAt` yang jadi tiebreak FIFO — jadi menata himpunan yang seluruhnya sudah antre
 *    adalah no-op, dan no-op tak berharga satu panggilan agen (8/8 dan 20/20 di mesin operator).
 * 3. Himpunan belum-antre itu berubah sejak terakhir ditata (tanda tangan). Tanda tangan dihitung
 *    atas himpunan BELUM-ANTRE, bukan seluruh himpunan siap-kerja: kalau tidak, satu item yang
 *    masuk antrean lewat jalur lain akan menggeser tanda tangan dan membeli giliran lagi untuk
 *    sisa yang sudah no-op.
 */
async function orderProject(projectId: string, deps: PulseDeps): Promise<number> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { schedulerOptIn: true } });
  if (!project?.schedulerOptIn) return 0;

  // SPEC-431 · "siap dikerjakan" memakai predikat BERSAMA dengan checker backlog. Sebelumnya
  // `baseSha: null` telanjang, jadi lead ikut mengurutkan — dan mengantrekan — pekerjaan yang
  // sudah `done`; item yang selesai sebelum ADR-0030 tak pernah punya `baseSha`.
  const readyRaw = await prisma.spec.findMany({
    where: { ...UNSTARTED_SPEC_WHERE, projectId },
    select: { id: true, projectId: true, title: true, priority: true, objective: true,
      branchFrom: true, dependsOn: true },
    orderBy: { id: "asc" },
  });
  // SPEC-447 · ADR-0093 · item yang dependency-nya belum selesai & ter-merge takkan diluncurkan
  // governor, jadi menatanya adalah no-op yang tetap membakar satu giliran agen — perluasan
  // gerbang aktionabilitas SPEC-432 huruf (B). Nol biaya bila tak ada yang memakai dependency.
  const repoDir = await resolveRepoDir(projectId);
  const ready: typeof readyRaw = [];
  for (const r of readyRaw) if ((await blockersForSpec(r, repoDir)).length === 0) ready.push(r);
  if (ready.length < 2) return 0;
  const already = new Set((await prisma.schedulerQueueItem.findMany({
    where: { specId: { in: ready.map((r) => r.id) } }, select: { specId: true },
  })).map((q) => q.specId));
  const pending = ready.filter((r) => !already.has(r.id));
  if (pending.length < 2) return 0;                   // penataannya no-op → nol panggilan agen

  const sig = pending.map((r) => r.id).join(",");
  if (sig === lastReadySig.get(projectId)) return 0;   // tak berubah → tak ada giliran lead terpakai
  lastReadySig.set(projectId, sig);

  const row = await decideOrSkip(deps, {
    projectId,
    gate: "pulse", kind: "order",
    question: `Ada ${pending.length} backlog siap dikerjakan. Urutkan mana yang lebih dulu berdasarkan isi pekerjaannya, lalu tuliskan urutan id-nya (dipisah koma) di \`decision\`.`,
    options: pending.map((r) => `${r.id} · [${r.priority}] ${r.title}`),
    notes: pending.map((r) => `${r.id}: ${r.objective.slice(0, 200)}`),
  });
  if (!row || row.status !== "berlaku") return 0;

  // Urutan dibaca dari jawabannya; id yang tak dikenal diabaikan, dan sisa yang tak disebut lead
  // tetap masuk antrean di belakang — lead yang lupa satu item tak boleh membuatnya hilang.
  // Yang di-enqueue hanya `pending`: item yang sudah antre tak bisa dipindah oleh `upsert`-nya,
  // jadi menyertakannya cuma menggelembungkan hitungan dan judul notifikasinya.
  const byId = new Map(pending.map((r) => [r.id.toLowerCase(), r]));
  const named: typeof pending = [];
  for (const tok of row.answer.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    const hit = byId.get(tok);
    if (hit && !named.includes(hit)) named.push(hit);
  }
  const ordered = [...named, ...pending.filter((r) => !named.includes(r))];
  for (const r of ordered) {
    await deps.enqueue({ specId: r.id, projectId: r.projectId, source: "lead", priority: r.priority });
  }
  await deps.notify(row.id, `Lead menata ${ordered.length} backlog siap kerja`, projectId, null, null);
  return ordered.length;
}

/** Baris jejak untuk denyut yang dilewati karena lead dijeda — dipakai test & observabilitas. */
export async function recordPaused(projectId: string, why: string): Promise<void> {
  await recordDecision({
    projectId, gate: "pulse", kind: "answer",
    question: "denyut", answer: "dilewati", reason: why,
    refs: [], confidence: "tinggi", action: "none",
  });
}
