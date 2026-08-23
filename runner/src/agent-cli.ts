import type { Agent } from "./types";
import { guardSettings } from "./settings";
import { codexHookArgs } from "./codex-settings";

// SPEC-338 · ADR-0074 — satu tempat yang tahu bentuk argv tiap agen. pty.ts hanya mengutip &
// merangkai; perbedaan CLI (claude vs codex) tak bocor ke lapis proses/tmux. Murni & tanpa I/O
// supaya bisa dites tanpa men-spawn apa pun.
export type AgentFlagsOpts = {
  agent: Agent;
  model?: string;
  effort?: string;
  decisionFile?: string;
  /** claude: kondisi prosa untuk Stop hook `prompt`. codex: dipakai lewat `goalGate`. */
  goal?: string;
  /** codex: path skrip gate mode goal (ditulis pemanggil). */
  goalGate?: string;
  /** SPEC-909 · ADR-0146 · pasang hook pengirim event pertanyaan sesi. Sesi agen saja. */
  eventHook?: boolean;
};

/** Flag agen TANPA binary dan TANPA prompt positional — pemanggil yang mengutip tiap elemen. */
export function agentFlags(o: AgentFlagsOpts): string[] {
  if (o.agent === "codex") {
    return [
      ...(o.model ? ["-m", o.model] : []),
      // Codex tak punya flag effort; ia knob config. Nilai diapit kutip ganda agar di-parse TOML.
      ...(o.effort ? ["-c", `model_reasoning_effort="${o.effort}"`] : []),
      // Padanan --dangerously-skip-permissions (ADR-0037: agen dipercaya, isolasi = worktree).
      "--dangerously-bypass-approvals-and-sandbox",
      // Hook kita disuntik saat lahir, jadi ia belum pernah "di-trust" manusia. Tanpa flag ini
      // TUI berhenti di layar "Hooks need review" dan sesi tak pernah mulai.
      "--dangerously-bypass-hook-trust",
      ...codexHookArgs({ decisionFile: o.decisionFile, goalGate: o.goalGate, eventHook: o.eventHook }),
    ];
  }
  // SPEC-450 · ADR-0094 · `--agents` SENGAJA tidak dirakit di sini: seluruh keluaran fungsi ini
  // dikutip `sq()` oleh pemanggil, sementara `--agents` harus tetap berbentuk `"$(cat <file>)"`
  // agar di-expand shell saat sesi lahir. Ia disisipkan di `createSession`, sejajar `promptArg`.
  return [
    ...(o.model ? ["--model", o.model] : []),
    ...(o.effort ? ["--effort", o.effort] : []),
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify(guardSettings(o.decisionFile, o.goal, o.eventHook)),
  ];
}
