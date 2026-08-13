import { readFileSync, readdirSync } from "node:fs";
import { PIPELINES, type Flow } from "@hanoman/runner";
import { PLAN_DIRS, type Stage } from "@hanoman/shared";
import { STAGES } from "./stage-machine";

export type PhaseState = "done" | "skipped" | "active" | "pending";
export type Phase = { name: string; state: PhaseState };

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
function recorded(file: string): Map<string, PhaseState> {
  const out = new Map<string, PhaseState>();
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return out; }
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

// Fase aktif diturunkan, tidak disimpan: yang pertama belum tercatat.
export function readPhases(file: string, flow: Flow): Phase[] {
  const seen = recorded(file);
  let activeTaken = false;
  return PIPELINES[flow].map((name) => {
    const state = seen.get(name);
    if (state) return { name, state };
    if (activeTaken) return { name, state: "pending" as const };
    activeTaken = true;
    return { name, state: "active" as const };
  });
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
};
export function stageFor(phases: Phase[]): Stage | null {
  let best = -1;
  for (const p of phases) {
    // Fase KERJA yang sedang berjalan sudah berarti `executing` — berlaku untuk `Execute`
    // (feature/qa) maupun `Goal` (SPEC-407, flow tanpa fase perencanaan sama sekali).
    if ((p.name === "Execute" || p.name === "Goal") && p.state === "active")
      best = Math.max(best, STAGES.indexOf("executing"));
    if (p.state !== "done" && p.state !== "skipped") continue;
    const s = REACHED[p.name];
    if (s) best = Math.max(best, STAGES.indexOf(s));
  }
  if (phases[0]?.state === "active") best = Math.max(best, STAGES.indexOf("brainstorming"));
  return best < 0 ? null : STAGES[best]!;
}

// SPEC-173 · ADR-0029 — plan milik spec ini, dibaca dari worktree run-nya: `false` hanya jika ada
// file plan yang cocok segmen spec-id DAN masih memuat task `- [ ]`. Tak ada plan yang cocok
// (fast-path qa yang melewati Plan, atau worktree tanpa docs) → `true`: tak ada checklist untuk
// digerbang. Cocokkan sama seperti artifactsToRemove — batas kiri non-alnum, kanan non-digit, jadi
// "spec-16" tak menyerempet "spec-167".
//
// SPEC-734 · ADR-0113 · INVARIAN 1 — pindai UNION seluruh `planDir` terdaftar, bukan direktori
// metode terpilih. Direktori satu metode yang tak ada wajib `continue`, BUKAN mengakhiri
// pemindaian: item yang lahir dengan superpowers lalu dilanjutkan dengan metode lain akan melihat
// direktori kosong → `true` hampa → backlog lompat ke `done` padahal plan lama masih penuh `- [ ]`.
export function planComplete(worktree: string, specId: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${specId.toLowerCase()}([^0-9]|$)`);
  for (const rel of PLAN_DIRS) {
    const dir = `${worktree}/${rel}`;
    let names: string[];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!re.test(n.toLowerCase())) continue;
      try { if (/^[ \t]*- \[ \]/m.test(readFileSync(`${dir}/${n}`, "utf8"))) return false; }
      catch { /* file lenyap saat dibaca — abaikan */ }
    }
  }
  return true;
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
  return specId ? planComplete(worktree, specId) : true;
}

// Stage turunan untuk run nyata: `Execute done` hanya sah bila plan spec-nya terceklist
// penuh. Selama masih ada `- [ ]`, agen berhenti sebelum semua PR selesai — tahan di
// `executing`, jangan biarkan backlog claim `done`. `stageFor` yang murni tetap dipakai
// langsung oleh test; gerbang I/O hidup di sini, dipanggil kedua jalur persist stage.
export function stageForRun(phases: Phase[], worktree: string, specId: string): Stage | null {
  const s = stageFor(phases);
  if (s === "done" && !planComplete(worktree, specId)) return "executing";
  return s;
}
