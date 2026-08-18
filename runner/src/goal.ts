import type { Flow } from "./types";
import { PLAN_DIRS, isGoalShapedFlow } from "@hanoman/shared";
import { PIPELINES } from "./prompt";
import { readGoalPayload } from "./goal-spec";

// SPEC-332 · ADR-0073 — mode goal. Claude Code memasang `/goal` sebagai Stop hook bertipe `prompt`
// dan menolak kondisi > 4000 karakter; angka ini menyalin batas itu.
export const GOAL_MAX = 4000;

// SPEC-407 · `spec` hanya dibaca untuk flow "goal": kondisinya diturunkan dari ISI backlog item,
// bukan dari DoD generik. Opsional supaya seluruh pemanggil lama tetap sah.
export type GoalArgs = {
  flow: Flow; specId: string; branchTo: string;
  spec?: { payload?: unknown; objective?: string };
};

// SPEC-407 · ADR-0089 · kondisi sesi goal. Klausa 2 & 3 bukan hiasan: tanpa baris fase, board tak
// pernah melihat item ini selesai (ADR-0008); tanpa push, hasilnya hilang bersama worktree-nya.
// SPEC-825 · daftar fase datang dari `PIPELINES[flow]`, bukan `PIPELINES.goal` hardcode — flow
// `no_effort` memakai kondisi yang sama dengan daftar fasenya sendiri.
function goalFlowCondition(
  flow: Flow, specId: string, branchTo: string, spec?: { payload?: unknown; objective?: string },
): string {
  const g = readGoalPayload(spec?.payload);
  const goal = g?.goal || (spec?.objective ?? "").trim() || "(goal tak tercatat di backlog item)";
  const bukti = g?.done || goal;
  return [
    `Sesi goal hanoman ${specId}. GOAL: ${goal}`,
    "Sesi ini hanya boleh berhenti bila transkrip TERBARU memuat bukti langsung semua hal berikut:",
    `1. goal tercapai — ${bukti};`,
    `2. output \`cat "$HANOMAN_PHASE_FILE"\` yang memuat satu baris untuk SETIAP fase `
      + `${PIPELINES[flow].join(" → ")}, masing-masing berakhiran \`done\` atau \`skipped\`;`,
    `3. output \`git push origin HEAD:refs/heads/${branchTo}\` yang SUKSES sesudah commit terakhir.`,
    "Bila salah satu bukti tak ada di transkrip terbaru, kondisi BELUM terpenuhi: jalankan "
      + "perintah verifikasinya, tuntaskan yang masih kurang, lalu lanjutkan — jangan berhenti.",
  ].join("\n");
}

// Evaluator hook `prompt` berjalan dengan instruksi "Answer based on transcript evidence only" —
// ia TIDAK punya tool, dan transkrip Stop yang panjang DIPOTONG (bukti di prefix yang dibuang
// dianggap tak cukup). Karena itu kondisi ini menuntut BUKTI SEGAR: output perintah verifikasi di
// transkrip terbaru, bukan klaim agen bahwa pekerjaannya sudah selesai.
export function defaultGoalCondition({ flow, specId, branchTo, spec }: GoalArgs): string {
  // SPEC-407 · flow goal punya kondisinya sendiri: goal item, bukan DoD pipeline.
  // SPEC-825 · berlaku sama untuk `no_effort` — satu predikat (`isGoalShapedFlow`), bukan dua.
  if (isGoalShapedFlow(flow)) return goalFlowCondition(flow, specId, branchTo, spec);
  const phases = PIPELINES[flow];
  // Gate plan hanya berlaku untuk flow ber-fase Plan+Execute (cermin phaseInstruction & ADR-0029).
  const planGate = phases.includes("Plan") && phases.includes("Execute");
  const clauses = [
    `1. output \`cat "$HANOMAN_PHASE_FILE"\` yang memuat satu baris untuk SETIAP fase `
      + `${phases.join(" → ")}, masing-masing berakhiran \`done\` atau \`skipped\`;`,
  ];
  if (planGate) {
    // SPEC-734 · INVARIAN 1 · gerbang ini menuntut hasil grep KOSONG sebagai bukti, jadi direktori
    // yang salah justru MEMUASKANNYA. Seluruh planDir terdaftar disebut.
    const dirs = PLAN_DIRS.map((d) => `${d}/`).join(" ");
    clauses.push(
      `2. output \`grep -rn -- "- \\[ \\]" ${dirs}\` yang KOSONG untuk plan backlog `
      + `ini — tak ada task yang masih \`- [ ]\` (atau bukti bahwa backlog ini memang tak berplan);`,
    );
  }
  clauses.push(
    `${planGate ? 3 : 2}. output \`git push origin HEAD:refs/heads/${branchTo}\` yang SUKSES `
    + `sesudah commit terakhir.`,
  );
  return [
    `Sesi backlog hanoman ${specId} (flow ${flow}) hanya boleh berhenti bila transkrip TERBARU `
      + `memuat bukti langsung semua hal berikut:`,
    ...clauses,
    `Bila salah satu bukti tak ada di transkrip terbaru, kondisi BELUM terpenuhi: jalankan perintah `
      + `verifikasinya, tuntaskan yang masih kurang, lalu lanjutkan — jangan berhenti.`,
  ].join("\n");
}

// Presedens: override per sesi → template global → default bawaan. String kosong/hanya-spasi
// dianggap tak ada. Dipangkas ke GOAL_MAX supaya Claude Code tak menolak kondisinya.
export function resolveGoalCondition(
  a: GoalArgs, override?: string | null, template?: string | null,
): string {
  const picked = [override, template].find((c) => typeof c === "string" && c.trim() !== "");
  return (picked ? picked.trim() : defaultGoalCondition(a)).slice(0, GOAL_MAX);
}

// tmux `send-keys`: satu Enter = submit. Kondisi multi-baris harus diratakan sebelum diketik ke
// TUI, kalau tidak ia terkirim separuh dan sisanya jadi pesan liar.
export const goalOneLine = (cond: string): string => cond.replace(/\s+/g, " ").trim();

// SPEC-397 · ADR-0085 — TUI codex mengubah masukan yang datang dalam SATU burst ≥ 1024 karakter
// menjadi lampiran `[Pasted Content N chars]`. Begitu itu terjadi isi composer bukan lagi teks yang
// dimulai `/goal`, jadi slash-dispatch TAK jalan: kondisinya terkirim sebagai pesan chat biasa —
// tanpa error, tanpa goal, tanpa jejak kegagalan. Terukur di codex-cli 0.146.0: 1023 masih literal,
// 1024 sudah paste.
export const GOAL_TUI_PASTE_LIMIT = 1024;

// Deteksi paste itu PER-BURST PTY, bukan per-invokasi `send-keys`: potongan yang dikirim tanpa jeda
// digabung ulang oleh satu `read()` dan tetap kena (terukur: 4×500 tanpa jeda → paste 1500 char).
// Karena itu 500, bukan 1023 — bila jeda gagal sekali dan dua potongan menyatu, 2×500 = 1000 MASIH
// di bawah batas. Potongan 1023 tak punya margin sama sekali.
export const GOAL_CHUNK = 500;

/** Potong kondisi satu-baris jadi potongan yang aman dikirim sebagai keystroke tmux. */
export function goalChunks(line: string, size = GOAL_CHUNK): string[] {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += size) out.push(line.slice(i, i + size));
  return out;
}
