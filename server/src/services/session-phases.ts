import { readFileSync, readdirSync } from "node:fs";
import { PIPELINES, WORK_PHASES, type Flow } from "@hanoman/runner";
import { PLAN_DIRS, PHASE_EVIDENCE_GRACE_MS, type Stage } from "@hanoman/shared";
import { STAGES } from "./stage-machine";

export type PhaseState = "done" | "skipped" | "active" | "pending";
// ADR-0164 · bukti agen fase yang ikut frame `phase`. `resultExcerpt` aman di sini: WS terminal
// ber-cookie, sama dengan route metrik yang memuat excerpt (ADR-0159).
export type PhaseInvocation = {
  phase: string; runtimeInvocationId: string; status: string; startedAt: string;
  durationMs: number | null; inputTokens: number | null; outputTokens: number | null;
  cachedTokens: number | null; resultExcerpt: string | null;
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

/**
 * ADR-0164 · fase diperkaya agen fasenya. MURNI: roster (tmux), invocation (DB lewat cache pty), dan
 * `doneSeenAt` (kapan server pertama melihat fase `done`) disuntik pemanggil. `missing` = fase tercatat
 * selesai tanpa satu pun invocation lewat tenggang relay — dilabeli "bukti tak diterima", bukan
 * "tidak didelegasikan": hook fail-open dan nol invocation bukan bukti tak dipakai (ADR-0159).
 */
export function enrichPhases(
  phases: Phase[], roster: PhaseRosterEntry[], invocations: PhaseInvocation[],
  doneSeenAt: Map<string, number>, now: number,
): Phase[] {
  return phases.map((p) => {
    const r = roster.find((entry) => entry.phase === p.name);
    if (!r) return p;
    const mine = invocations.filter((i) => i.phase === p.name)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const last = mine[mine.length - 1];
    const seen = doneSeenAt.get(p.name);
    const evidence: PhaseAgent["evidence"] = mine.length > 0 ? "ok"
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
