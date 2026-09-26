import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { PIPELINES, WORK_PHASES, type Flow } from "@hanoman/runner";
import { PLAN_DIRS, PHASE_EVIDENCE_GRACE_MS, phaseAgentName, type Stage } from "@hanoman/shared";
import { STAGES } from "./stage-machine";

export type PhaseState = "done" | "skipped" | "active" | "pending";
// ADR-0164 · bukti agen fase yang ikut frame `phase`. `resultExcerpt` aman di sini: WS terminal
// ber-cookie, sama dengan route metrik yang memuat excerpt (ADR-0159).
export type PhaseInvocation = {
  phase: string; runtimeInvocationId: string; status: string; startedAt: string;
  durationMs: number | null; inputTokens: number | null; outputTokens: number | null;
  cachedTokens: number | null; resultExcerpt: string | null;
  /** ADR-0170 · pemilah agen dalam satu fase (reviewer Execute berbagi `phase` dengan agen Execute). */
  agentName?: string;
};
export type PhaseRosterEntry = { name: string; phase: string; model?: string; effort?: string };
export type PhaseAgent = {
  name: string; model?: string; effort?: string; status?: string; startedAt?: string;
  durationMs?: number | null; attempts: number;
  inputTokens?: number | null; outputTokens?: number | null; cachedTokens?: number | null;
  resultExcerpt?: string | null;
  evidence: "ok" | "pending" | "missing";
};
export type Phase = { name: string; state: PhaseState; agent?: PhaseAgent };

// Di luar worktree: `git add -A` milik agen tak boleh bisa melihatnya. `.worktrees` sudah
// ada di .gitignore, jadi berkas ini tak pernah mendarat di branch mana pun.
export const phaseFilePath = (repoDir: string, sessionId: string): string =>
  `${repoDir}/.worktrees/.phases/${sessionId}`;

// SPEC-184 · marker "menunggu keputusan manusia" per sesi. Sekamar dengan berkas fase, di dalam
// `.worktrees` yang sudah `.gitignore` — tak pernah mendarat di branch mana pun. Kosong = tak
// menunggu; non-kosong (ditulis hook Notification) = butuh keputusan.
export const decisionFilePath = (repoDir: string, sessionId: string): string =>
  `${repoDir}/.worktrees/.decisions/${sessionId}`;

// Satu baris = satu transisi: "<Nama Fase> done" | "<Nama Fase> skipped". Nama fase boleh
// berspasi ("Doc index"), jadi state-nya token TERAKHIR. Baris yang tak dikenali diabaikan —
// berkas ini ditulis agen lewat `echo`, dan tak boleh ada yang bisa menyandera tampilan fase.
function parseRecorded(raw: string): Map<string, PhaseState> {
  const out = new Map<string, PhaseState>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    const i = trimmed.lastIndexOf(" ");
    if (i < 1) continue;
    const state = trimmed.slice(i + 1);
    if (state !== "done" && state !== "skipped") continue;
    out.set(trimmed.slice(0, i).trim(), state);
  }
  return out;
}

function recorded(file: string): Map<string, PhaseState> {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return new Map(); }
  return parseRecorded(raw);
}

// SPEC-1267 · pembacaan asinkron berkas fase, dimemo per (path, mtimeMs, size): jalur periodik
// (overlay stage, poll fase, cek pane selesai) membaca berkas yang sama beberapa kali per tick, dan
// berkas ini hampir tak pernah berubah. `stat` tetap dijalankan tiap panggilan sehingga perubahan
// langsung terlihat.
const phaseFileMemo = new Map<string, { mtimeMs: number; size: number; seen: Map<string, PhaseState> }>();
async function recordedAsync(file: string): Promise<Map<string, PhaseState>> {
  let st: Awaited<ReturnType<typeof stat>>;
  try { st = await stat(file); } catch { phaseFileMemo.delete(file); return new Map(); }
  const hit = phaseFileMemo.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.seen;
  let raw: string;
  try { raw = await readFile(file, "utf8"); } catch { return new Map(); }
  const seen = parseRecorded(raw);
  phaseFileMemo.set(file, { mtimeMs: st.mtimeMs, size: st.size, seen });
  return seen;
}

// Fase aktif diturunkan, tidak disimpan: yang pertama belum tercatat.
const derivePhases = (seen: Map<string, PhaseState>, flow: Flow): Phase[] => {
  let activeTaken = false;
  return PIPELINES[flow].map((name) => {
    const state = seen.get(name);
    if (state) return { name, state };
    if (activeTaken) return { name, state: "pending" as const };
    activeTaken = true;
    return { name, state: "active" as const };
  });
};

export const readPhases = (file: string, flow: Flow): Phase[] => derivePhases(recorded(file), flow);

export async function readPhasesAsync(file: string, flow: Flow): Promise<Phase[]> {
  return derivePhases(await recordedAsync(file), flow);
}

/**
 * ADR-0164 · fase diperkaya agen fasenya. MURNI: roster (tmux), invocation (DB lewat cache pty), dan
 * `doneSeenAt` (kapan server pertama melihat fase `done`) disuntik pemanggil. `missing` = fase tercatat
 * selesai tanpa satu pun invocation lewat tenggang relay — dilabeli "bukti tak diterima", bukan
 * "tidak didelegasikan": hook fail-open dan nol invocation bukan bukti tak dipakai (ADR-0159).
 *
 * I-1 · `bornAt` (ms epoch kelahiran sesi INI; 0 = tak diketahui → perilaku lama, semua invocation
 * dihitung) membatasi status/startedAt/durasi/token/cuplikan/attempts ke invocation SESUDAH lahir:
 * sesi lama yang ditutup di tengah fase lalu dilanjutkan (id sesi tetap, `sessionIdForSpec`)
 * meninggalkan baris `running` yang bukan milik sesi baru — tanpa gerbang ini chip menampilkan
 * "running 2h…"/`↻` dari run yang sudah mati.
 *
 * M-2 · `doneAtBirth` = fase yang SUDAH `done`/`skipped` SAAT SESI LAHIR (dicatat `createSession`
 * dari berkas fase, lihat pty.ts). Fase ini TAK PERNAH `missing`: invocation lama (dari sebelum
 * lahir, mis. run mode tunggal tanpa subagent) boleh jadi bukti `ok`, tapi tak ikut status/
 * attempts — kalau tak ada invocation sama sekali, dibiarkan `pending` (paling jujur: bukan `ok`
 * yang mengarang bukti, bukan pula `missing` yang menuduh "tak diterima" padahal memang belum
 * pernah didelegasikan lewat subagent).
 */
export function enrichPhases(
  phases: Phase[], roster: PhaseRosterEntry[], invocations: PhaseInvocation[],
  doneSeenAt: Map<string, number>, now: number, bornAt: number,
  doneAtBirth: ReadonlySet<string> = new Set(),
): Phase[] {
  return phases.map((p) => {
    // ADR-0170 · satu fase bisa punya lebih dari satu agen di roster (reviewer Execute): chip milik
    // agen fase itu sendiri, dan hanya invocation-nya yang dihitung sebagai percobaan.
    const own = phaseAgentName(p.name);
    const r = roster.find((entry) => entry.phase === p.name && entry.name === own)
      ?? roster.find((entry) => entry.phase === p.name);
    if (!r) return p;
    const all = invocations.filter((i) => i.phase === p.name && (!i.agentName || i.agentName === r.name));
    const mine = all.filter((i) => bornAt === 0 || Date.parse(i.startedAt) >= bornAt)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const last = mine[mine.length - 1];
    const bornDone = doneAtBirth.has(p.name);
    const seen = doneSeenAt.get(p.name);
    const evidence: PhaseAgent["evidence"] = mine.length > 0 ? "ok"
      : bornDone ? (all.length > 0 ? "ok" : "pending")
      : p.state === "done" && seen !== undefined && now - seen >= PHASE_EVIDENCE_GRACE_MS ? "missing"
        : "pending";
    return {
      ...p,
      agent: {
        name: r.name,
        ...(r.model ? { model: r.model } : {}),
        ...(r.effort ? { effort: r.effort } : {}),
        attempts: new Set(mine.map((i) => i.runtimeInvocationId)).size,
        ...(last ? {
          status: last.status, startedAt: last.startedAt, durationMs: last.durationMs,
          inputTokens: last.inputTokens, outputTokens: last.outputTokens, cachedTokens: last.cachedTokens,
          resultExcerpt: last.resultExcerpt,
        } : {}),
        evidence,
      },
    };
  });
}

/** ADR-0164 · catat kapan fase PERTAMA kali terlihat `done`; lupakan fase yang tak lagi `done`
 *  supaya fase yang di-reset lalu selesai lagi mendapat tenggang bukti yang utuh. */
export function trackDoneSeen(phases: Phase[], doneSeenAt: Map<string, number>, now: number): void {
  const byName = new Map(phases.map((p) => [p.name, p.state]));
  for (const name of [...doneSeenAt.keys()])
    if (byName.get(name) !== "done") doneSeenAt.delete(name);
  for (const p of phases)
    if (p.state === "done" && !doneSeenAt.has(p.name)) doneSeenAt.set(p.name, now);
}

// ADR-0008 · Spec.stage cermin fase, hanya maju. `skipped` dihitung sebagai tercapai:
// jalur cepat qa melewati Spec+Plan justru karena pekerjaannya tak diperlukan.
// SPEC-237 · `Laporan` = fase terminal flow audit-only → stage `done` (dokumen ditulis, tak ada
// Execute/plan; `planComplete` true → `stageForRun` tak menahan di `executing`). Nama unik lintas PIPELINES.
const REACHED: Record<string, Stage> = {
  Objective: "objective", Audit: "objective", Spec: "spec-ready", Plan: "planned",
  Laporan: "done", Execute: "done",
  // SPEC-407 · ADR-0089 · flow goal (Goal → Verifikasi): fase kerja mencapai `executing`, fase
  // verifikasi yang mencapai `done`. Kedua nama unik lintas PIPELINES — peta ini berkunci nama.
  Goal: "executing", Verifikasi: "done",
  // SPEC-825 · ADR-0123 · flow no_effort (Kerjakan): satu fase, jadi fase kerjanya sendiri yang
  // mencapai `done` — tak ada fase verifikasi untuk menutupnya.
  Kerjakan: "done",
};
export function stageFor(phases: Phase[]): Stage | null {
  let best = -1;
  for (const p of phases) {
    // Fase KERJA yang sedang berjalan sudah berarti `executing`. SPEC-825 · daftarnya
    // `WORK_PHASES` di runner — sumber yang SAMA dengan gerbang `writesCode`, supaya flow
    // penulis-kode baru tak bisa lahir dengan salah satunya terpasang dan yang lain terlewat.
    if ((WORK_PHASES as readonly string[]).includes(p.name) && p.state === "active")
      best = Math.max(best, STAGES.indexOf("executing"));
    if (p.state !== "done" && p.state !== "skipped") continue;
    const s = REACHED[p.name];
    if (s) best = Math.max(best, STAGES.indexOf(s));
  }
  if (phases[0]?.state === "active") best = Math.max(best, STAGES.indexOf("brainstorming"));
  return best < 0 ? null : STAGES[best]!;
}

// SPEC-173 · ADR-0029 — plan milik spec ini, dibaca dari worktree run-nya: `false` bila ada file
// plan yang cocok segmen spec-id DAN masih memuat task `- [ ]`. Cocokkan sama seperti
// artifactsToRemove — batas kiri non-alnum, kanan non-digit, jadi "spec-16" tak menyerempet
// "spec-167".
//
// SPEC-734 · ADR-0113 · INVARIAN 1 — pindai UNION seluruh `planDir` terdaftar, bukan direktori
// metode terpilih. Direktori satu metode yang tak ada wajib `continue`, BUKAN mengakhiri
// pemindaian: item yang lahir dengan superpowers lalu dilanjutkan dengan metode lain akan melihat
// direktori kosong → `true` hampa → backlog lompat ke `done` padahal plan lama masih penuh `- [ ]`.
//
// ADR-0171 · tak ada plan yang cocok bisa berarti dua hal yang HARUS dibedakan: fast-path yang
// sengaja melewati Plan (qa `skipped`, flow tanpa fase Plan sama sekali — goal/no_effort/audit/
// dokumen) vs plan yang lahir dari skill default TANPA spec-id di namanya (`YYYY-MM-DD-<feature>.md`)
// sehingga regex di atas tak pernah cocok — sebelum ADR ini keduanya sama-sama `true`, jadi kasus
// kedua lolos ke `done` walau isinya masih penuh `- [ ]`. `planPhaseDone` (fase Plan tercatat
// `done`, BUKAN `skipped`) adalah pembedanya: hanya diteruskan pemanggil yang punya `phases`
// (`stageForRun`/`sessionComplete`) — false untuk pemanggil lama (lead `apply.ts`/`pulse.ts`) yang
// tak punya konteks fase di tangan, jadi perilakunya di sana sengaja tak berubah.
export function planComplete(worktree: string, specId: string, planPhaseDone = false): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${specId.toLowerCase()}([^0-9]|$)`);
  let matched = false;
  for (const rel of PLAN_DIRS) {
    const dir = `${worktree}/${rel}`;
    let names: string[];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!re.test(n.toLowerCase())) continue;
      matched = true;
      try { if (/^[ \t]*- \[ \]/m.test(readFileSync(`${dir}/${n}`, "utf8"))) return false; }
      catch { /* file lenyap saat dibaca — abaikan */ }
    }
  }
  if (!matched && planPhaseDone) {
    for (const rel of plansOutsidePlanDirs(gitListSync(worktree), re)) {
      matched = true;
      try { if (/^[ \t]*- \[ \]/m.test(readFileSync(`${worktree}/${rel}`, "utf8"))) return false; }
      catch { /* file lenyap saat dibaca — abaikan */ }
    }
  }
  return matched ? true : !planPhaseDone;
}

// Regresi 0.9.8 · gerbang `planPhaseDone` di atas tak boleh berarti "plan WAJIB di PLAN_DIRS":
// project boleh menaruh plan di tempat lain menurut konvensinya sendiri (erp-tumbuh-ai:
// `internal/docs/superpowers/plans/`, diarsip ke `.../done/plans/`). Tanpa langkah ini setiap
// backlog project semacam itu tertahan di `executing` selamanya walau plan ber-spec-id-nya sudah
// terceklist penuh. Maka, HANYA saat PLAN_DIRS tak memuat plan yang cocok DAN Plan tercatat `done`,
// cari berkas `.md` ber-spec-id di direktori `plans/` mana pun di worktree — lewat `git ls-files`
// (tracked + untracked, hormati .gitignore) supaya node_modules dkk tak ikut dijelajah. Gagal
// menjalankan git (bukan repo, worktree lenyap) → daftar kosong → perilaku ADR-0171 apa adanya.
const GIT_LS = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
const gitListSync = (worktree: string): string[] => {
  try { return execFileSync("git", ["-C", worktree, ...GIT_LS], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).split("\0"); }
  catch { return []; }
};
const execFileP = promisify(execFile);
const gitListAsync = async (worktree: string): Promise<string[]> => {
  try { return (await execFileP("git", ["-C", worktree, ...GIT_LS], { encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024 * 1024 })).stdout.split("\0"); }
  catch { return []; }
};
const plansOutsidePlanDirs = (paths: string[], re: RegExp): string[] =>
  paths.filter((rel) => {
    if (!rel.endsWith(".md") || !/(^|\/)plans\//.test(rel)) return false;
    if (PLAN_DIRS.some((d) => rel.startsWith(`${d}/`) && !rel.slice(d.length + 1).includes("/"))) return false;
    return re.test(rel.slice(rel.lastIndexOf("/") + 1).toLowerCase());
  });

// SPEC-1267 · padanan asinkron `planComplete` untuk jalur periodik: readdirSync/readFileSync
// memblokir event loop yang sama dengan frame terminal. Semantik identik (UNION seluruh PLAN_DIRS,
// gerbang `planPhaseDone` ADR-0171).
export async function planCompleteAsync(worktree: string, specId: string, planPhaseDone = false): Promise<boolean> {
  const re = new RegExp(`(^|[^a-z0-9])${specId.toLowerCase()}([^0-9]|$)`);
  let matched = false;
  for (const rel of PLAN_DIRS) {
    const dir = `${worktree}/${rel}`;
    let names: string[];
    try { names = await readdir(dir); } catch { continue; }
    for (const n of names) {
      if (!re.test(n.toLowerCase())) continue;
      matched = true;
      try { if (/^[ \t]*- \[ \]/m.test(await readFile(`${dir}/${n}`, "utf8"))) return false; }
      catch { /* file lenyap saat dibaca — abaikan */ }
    }
  }
  if (!matched && planPhaseDone) {
    for (const rel of plansOutsidePlanDirs(await gitListAsync(worktree), re)) {
      matched = true;
      try { if (/^[ \t]*- \[ \]/m.test(await readFile(`${worktree}/${rel}`, "utf8"))) return false; }
      catch { /* file lenyap saat dibaca — abaikan */ }
    }
  }
  return matched ? true : !planPhaseDone;
}

// SPEC-433 · "pekerjaan selesai" adalah fakta yang BERDIRI SENDIRI di sebelah "pane mati".
// `exited` (⇐ `#{pane_dead}`) menjawab "prosesnya sudah mati?", dan agen hanoman adalah TUI
// interaktif yang kembali ke prompt-nya sesudah fase terakhir — jadi di jalur sukses pane tak
// pernah mati sendiri dan status "Selesai" di Terminal tak pernah bisa dirender. Kedua fakta
// dipisah, bukan digabung: `exited` tetap menggerbangi re-attach (ADR-0084), tombol "Lanjutkan",
// `startable`, dan penutupan SessionHistory — semuanya memang bertanya soal proses.
//
// Daftar kosong = "tak tahu apa-apa" (flow tak dikenal / sesi tanpa fase) → false, bukan
// vacuous true; kalau tidak, setiap terminal biasa akan lahir dengan label "Selesai".
export const phasesComplete = (phases: Phase[]): boolean =>
  phases.length > 0 && phases.every((p) => p.state === "done" || p.state === "skipped");

// Verdict yang dikirim ke Terminal. Gerbang plan-nya SAMA dengan `stageForRun` (ADR-0029):
// berkas fase bisa berkata `Execute done` sementara plan masih menyisakan `- [ ]`, dan hanoman
// menahan backlog di `executing` justru untuk itu. Tanpa gerbang ini kita cuma menukar "tak
// pernah hijau" dengan "hijau palsu" — kelas kesalahan yang diperbaiki SPEC-402.
//
// Sengaja BUKAN `stageForRun(...) === "done"`: peta `REACHED` berkunci nama fase dan tak
// mengenal fase flow dokumen (`PRD`, `Serah terima`, `Breakdown`), jadi sesi PRD/reverse/
// breakdown yang tuntas akan selamanya terbaca belum selesai. Yang ditanya di sini adalah
// "seluruh pipeline-nya sudah tercatat?", bukan "sudah sampai stage mana?".
//
// `planComplete` (I/O) hanya dijalankan sesudah cek murni di atas lolos — yaitu di ekor sesi,
// bukan sepanjang hidupnya.
export function sessionComplete(phases: Phase[], worktree: string, specId?: string): boolean {
  if (!phasesComplete(phases)) return false;
  return specId ? planComplete(worktree, specId, phases.find((p) => p.name === "Plan")?.state === "done") : true;
}

// Stage turunan untuk run nyata: `Execute done` hanya sah bila plan spec-nya terceklist
// penuh. Selama masih ada `- [ ]`, agen berhenti sebelum semua PR selesai — tahan di
// `executing`, jangan biarkan backlog claim `done`. `stageFor` yang murni tetap dipakai
// langsung oleh test; gerbang I/O hidup di sini, dipanggil kedua jalur persist stage.
export function stageForRun(phases: Phase[], worktree: string, specId: string): Stage | null {
  const s = stageFor(phases);
  const planPhaseDone = phases.find((p) => p.name === "Plan")?.state === "done";
  if (s === "done" && !planComplete(worktree, specId, planPhaseDone)) return "executing";
  return s;
}

export async function stageForRunAsync(phases: Phase[], worktree: string, specId: string): Promise<Stage | null> {
  const s = stageFor(phases);
  const planPhaseDone = phases.find((p) => p.name === "Plan")?.state === "done";
  if (s === "done" && !(await planCompleteAsync(worktree, specId, planPhaseDone))) return "executing";
  return s;
}

export async function sessionCompleteAsync(phases: Phase[], worktree: string, specId?: string): Promise<boolean> {
  if (!phasesComplete(phases)) return false;
  return specId ? planCompleteAsync(worktree, specId, phases.find((p) => p.name === "Plan")?.state === "done") : true;
}
