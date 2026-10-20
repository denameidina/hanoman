import { prisma } from "../../db";
import type { Lead, LeadEventKind, Scheduler } from "@hanoman/shared";
import { listSessionsAsync, sessionFinishedAsync } from "../pty";
import { planCompleteAsync } from "../session-phases";
import { resolveRepoDir } from "../local-binding";
import { specReview } from "../spec-review";
import { UNSTARTED_SPEC_WHERE } from "../scheduler/queue";
import { blockersForSpec } from "../spec-deps";
import { getScheduler } from "../scheduler/config";
import { getLead, leadActive, leadProjects, pauseLeadProject } from "./config";
import type { DecideRequest } from "./decide";
import { postDecision, hasOpenPosted } from "./post";
import { launchBudget, type Budget } from "./budget";
import { leadProjectConfig } from "./project-config";

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
  /**
   * ADR-0228 · denyut MEMBUKA event tanpa penunggu dan langsung kembali; eksekusinya (apply,
   * enqueue, event `integrate-failed`) terjadi di `post.ts` saat pane lead menjawab atau izinnya
   * disetujui. Tick lead tak pernah menunggu pane.
   */
  post: (req: DecideRequest, kind?: LeadEventKind) => Promise<{ id: string } | null>;
  /** Event denyut dengan awalan pertanyaan ini masih menunggu jawaban? (dedupe selama terbuka) */
  openPosted: (projectId: string, questionPrefix: string) => Promise<boolean>;
  /** ADR-0228 · jatah peluncuran proyek (`budget.ts`). */
  budget: (projectId: string) => Promise<Budget>;
  /** ADR-0228 · pemutus beruntun: jeda proyek + notifikasi (sekali). */
  pauseProject: (projectId: string, why: string) => Promise<void>;
  optIn: () => Promise<string[]>;
  cfg: () => Promise<Lead>;
  /** SPEC-432 · ambil backlog hanya berarti bila antrean memang dikuras — lihat `pickProject`. */
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
  post: (req, kind) => postDecision(req, kind),
  openPosted: hasOpenPosted,
  budget: (p) => launchBudget(p),
  pauseProject: pauseLeadProject,
  optIn: leadProjects,
  cfg: getLead,
  scheduler: getScheduler,
};

/** Jumlah EVENT yang dibuka denyut ini per pintu (eksekusinya menyusul saat pane menjawab). */
export type PulseResult = { ordered: number; collisions: number; quality: number };

/**
 * Sudah diputuskan, atau masih menunggu jawaban? Idempotensi lewat JEJAK (SPEC-432: pane mati
 * bertahan berhari-hari dan Set memori kosong sesudah restart) DITAMBAH event yang masih terbuka
 * (ADR-0228): selama pane lead belum menjawab, denyut berikutnya tak boleh membuka event kembaran.
 */
async function alreadyAsked(deps: PulseDeps, projectId: string, where: { sessionId?: string; mark: string; contains?: boolean }): Promise<boolean> {
  const seen = await prisma.leadDecision.findFirst({
    where: {
      gate: "pulse", ...(where.sessionId ? { sessionId: where.sessionId } : {}),
      question: where.contains ? { contains: where.mark } : { startsWith: where.mark },
    },
    select: { id: true },
  });
  return !!seen || await deps.openPosted(projectId, where.mark);
}

/** Satu denyut. Tak pernah melempar: satu bagian gagal tak boleh menghentikan yang lain. */
export async function pulse(deps: PulseDeps = prodPulseDeps): Promise<PulseResult> {
  const res: PulseResult = { ordered: 0, collisions: 0, quality: 0 };
  const cfg = await deps.cfg();
  if (!cfg.enabled || cfg.paused) return res;
  const optIn = (await deps.optIn()).filter((p) => leadActive(cfg, p));
  if (!optIn.length) return res;

  try { res.quality = await followUpFinished(optIn, deps); } catch { /* satu bagian gagal tak menghentikan sisanya */ }
  try { res.quality += await followUpComplete(cfg, optIn, deps); } catch { /* idem */ }
  try { res.collisions = await detectCollisions(optIn, deps); } catch { /* idem */ }
  try { res.ordered = await pickReadyWork(optIn, deps); } catch { /* idem */ }
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
async function followUpFinished(optIn: string[], deps: PulseDeps): Promise<number> {
  let n = 0;
  const opt = new Set(optIn);
  for (const s of await deps.sessions()) {
    if (!s.exited || !s.specId || !opt.has(s.projectId)) continue;
    const bad = (s.exitCode ?? 0) !== 0;
    const unfinished = !(await deps.planDone(s.cwd, s.specId));
    if (!bad && !unfinished) continue;
    // SPEC-432 · kuncinya BUKAN `kind` (`decide()` menulis ulang `kind` jadi "refusal" untuk
    // tindakan di luar allowlist); yang stabil adalah awalan pertanyaannya — deterministik per sesi
    // dan tak dimiliki pintu lain (pertanyaan tabrakan berbunyi "Dua pekerjaan menyentuh …").
    const mark = `Sesi ${s.id} untuk backlog ${s.specId}`;
    if (await alreadyAsked(deps, s.projectId, { sessionId: s.id, mark })) continue;
    const why = [bad ? `berakhir dengan kode keluar ${s.exitCode}` : null,
      unfinished ? "plan-nya masih menyisakan kotak `- [ ]`" : null].filter(Boolean).join(" dan ");
    // ADR-0228 · dibuka tanpa penunggu; tindak lanjut pilihan lead dijalankan `post.ts` saat ia menjawab.
    const e = await deps.post({
      projectId: s.projectId, specId: s.specId, sessionId: s.id,
      gate: "pulse", kind: "quality",
      question: `${mark} ${why}. Tindak lanjutnya apa: lanjutkan pekerjaan yang terputus, ulangi dari awal, hentikan, atau biarkan?`,
      options: [
        "resume-session — lanjutkan dari keadaan worktree sekarang (ADR-0084)",
        "restart-session — ulangi dari awal",
        "stop-session — hentikan sesinya; worktree tetap utuh",
        "none — terima apa adanya, sertakan alasannya",
      ],
      notes: [`Worktree sesi: ${s.cwd}`],
    }, "session-ended");
    if (e) n++;
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
async function followUpComplete(cfg: Lead, optIn: string[], deps: PulseDeps): Promise<number> {
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
    if (await alreadyAsked(deps, s.projectId, { sessionId: s.id, mark })) continue;
    // ADR-0228 · branch target per proyek, bukan `main` terpatok; server memverifikasi sebelum merge.
    const target = leadProjectConfig(cfg, s.projectId).targetBranch;
    const e = await deps.post({
      projectId: s.projectId, specId: s.specId, sessionId: s.id,
      gate: "pulse", kind: "quality",
      question: `${mark}: seluruh fasenya tercatat dan plan-nya tak menyisakan kotak \`- [ ]\`. Selama sesinya belum dilepas, ia memegang satu slot concurrency scheduler sehingga backlog lain tak bisa mulai. Integrasikan hasilnya ke ${target}, lanjutkan sesinya, hentikan sesinya saja, atau biarkan?`,
      options: [
        `integrate-main — merge branch sesi ini ke ${target}; server menjalankan verifikasi lebih dulu, panenya dilepas, worktree tetap utuh`,
        "resume-session — lanjutkan sesi: masih ada yang perlu dikerjakan sebelum integrasi (tulis apa di `decision`)",
        "stop-session — lepas panenya tanpa mengintegrasikan (worktree tetap utuh, ADR-0084 masih bisa melanjutkan)",
        "none — biarkan sesinya berdiri, sertakan alasan kenapa slot itu layak ditahan",
      ],
      notes: [
        `Worktree sesi: ${s.cwd}`,
        // Rebase sengaja tak ditawarkan: `LEAD_ACTIONS` adalah konstanta tertutup (AC-31), dan
        // merge adalah yang PALING MUDAH DIBATALKAN dari keduanya. Rebase tetap tindakan operator
        // lewat POST /specs/:id/integrate, atau pekerjaan sesi pekerja yang dilanjutkan.
        "Rebase tidak tersedia untukmu; bila hasilnya menuntut rebase, pilih `resume-session` dan minta sesi pekerja melakukannya.",
        "Periksa dulu diff & hasil test sesi ini (git log/diff di worktree-nya) sebelum memilih integrate-main.",
      ],
    }, "session-ended");
    if (e) n++;
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
    if (await alreadyAsked(deps, c.a.projectId, { mark: `Dua pekerjaan menyentuh area yang sama [${key}]`, contains: true })) continue;
    const e = await deps.post({
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
    }, "session-ended");
    if (e) n++;
  }
  return n;
}

// ── D · ambil backlog (ADR-0228) ─────────────────────────────────────────────────────────────
/**
 * ADR-0228 · server menentukan BERAPA (jatah `budget.ts`), lead memilih YANG MANA. Sebelumnya lead
 * hanya diminta MENGURUTKAN seluruh himpunan siap-kerja lalu semuanya diantrekan — 2026-10-20:
 * 7 backlog crm diluncurkan dalam 30 dtk dan 7/7 gagal. Kini denyut membuka satu event "pilih
 * paling banyak N" hanya bila jatah ≥ 1, dan hanya pilihan lead yang lolos guard yang diantrekan
 * (`post.ts`). Pemutus beruntun yang menyala menjeda proyek.
 */
async function pickReadyWork(optIn: string[], deps: PulseDeps): Promise<number> {
  // SPEC-432 · gerbang PALING MURAH lebih dulu: selama subsistem scheduler mati atau dijeda, tak
  // ada yang menguras antrean sama sekali, jadi pilihan apa pun tak punya pembaca.
  const sched = await deps.scheduler();
  if (!sched.enabled || sched.paused) return 0;
  let total = 0;
  for (const projectId of optIn) total += await pickProject(projectId, deps);
  return total;
}

const PICK_MARK = "Jatah peluncuran";

async function pickProject(projectId: string, deps: PulseDeps): Promise<number> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { schedulerOptIn: true } });
  if (!project?.schedulerOptIn) return 0;
  if (await deps.openPosted(projectId, PICK_MARK)) return 0;     // pilihan sebelumnya belum dijawab

  const budget = await deps.budget(projectId);
  if (budget.tripped) { await deps.pauseProject(projectId, budget.reasons.join("; ")); return 0; }
  if (budget.n < 1) return 0;

  // SPEC-431 · predikat "siap dikerjakan" BERSAMA dengan checker backlog.
  const readyRaw = await prisma.spec.findMany({
    where: { ...UNSTARTED_SPEC_WHERE, projectId },
    select: { id: true, projectId: true, title: true, priority: true, objective: true,
      branchFrom: true, dependsOn: true },
    orderBy: { id: "asc" },
  });
  // SPEC-447 · ADR-0093 · item yang dependency-nya belum siap tak ditawarkan.
  const repoDir = await resolveRepoDir(projectId);
  const ready: typeof readyRaw = [];
  for (const r of readyRaw) if ((await blockersForSpec(r, repoDir)).length === 0) ready.push(r);
  const already = new Set((await prisma.schedulerQueueItem.findMany({
    where: { specId: { in: ready.map((r) => r.id) } }, select: { specId: true },
  })).map((q) => q.specId));
  const pending = ready.filter((r) => !already.has(r.id)).slice(0, 30);
  if (!pending.length) return 0;

  const e = await deps.post({
    projectId, gate: "pulse", kind: "order",
    question: `${PICK_MARK} ${budget.n}. Pilih paling banyak ${budget.n} backlog yang paling layak diluncurkan SEKARANG — baca spec/plan/dependensinya dulu — atau pilih action \`none\` bila tak ada yang layak. Untuk meluncurkan: action \`start-session\`, isi \`choices\` dengan label opsi persis, dan sebut id spec yang kamu baca di \`evidence\`.`,
    options: pending.map((r) => `${r.id} · [${r.priority}] ${r.title}`),
    select: { mode: "multi", min: 0, max: budget.n },
    notes: [
      ...(budget.reasons.length ? [`Pembatas jatah: ${budget.reasons.join("; ")}`] : []),
      ...pending.map((r) => `${r.id}: ${r.objective.slice(0, 200)}`),
    ],
  }, "pulse");
  return e ? 1 : 0;
}
