import { PLAN_DIRS } from "@hanoman/shared";
import { PIPELINES } from "./prompt";
import type { Flow } from "./types";

// SPEC-338 · ADR-0074 — padanan `guardSettings()` milik claude untuk Codex CLI.
//
// Tiga perbedaan mekanis yang menentukan bentuk berkas ini (diverifikasi di codex-cli 0.142.5,
// dengan menjalankan `codex exec` sungguhan, bukan dari ingatan):
//   1. Codex tak punya `--settings <json>`. Hook disuntik lewat `-c hooks.<Event>=<toml>`,
//      satu flag `-c` per event; nilainya di-parse sebagai TOML.
//   2. Codex TIDAK punya event `Notification`. Padanan "sesi menunggu manusia" yang tersedia
//      adalah `Stop` (right before Codex ends its turn) — turn berakhir = giliran manusia.
//   3. Handler bertipe `prompt` DIDIAMKAN codex; hanya `type="command"` yang benar-benar
//      terpasang. Karena itu mode goal di sini deterministik (skrip sh), bukan evaluator prosa.
//
// BUKAN guardrail deny: ADR-0037 tetap dicabut. Tak satu pun hook di sini menolak tool call —
// yang satu menandai marker keputusan, yang satu menahan sesi BERHENTI sebelum DoD terbukti.

// Kutip aman untuk string di dalam TOML (nilai hook = perintah shell).
const tq = (s: string): string => `"${s.split("\\").join("\\\\").split('"').join('\\"')}"`;
// Kutip aman untuk path di dalam perintah shell.
const shq = (s: string): string => `'${s.split("'").join("'\\''")}'`;

const group = (commands: string[]): string =>
  `[{hooks=[${commands.map((c) => `{type="command",command=${tq(c)}}`).join(",")}]}]`;

/**
 * Argumen argv hook codex — daftar datar `["-c", "hooks.X=…", "-c", "hooks.Y=…"]`.
 * Pemanggil (pty) yang mengutipnya untuk tmux. Kosong bila tak ada yang perlu dipasang.
 */
export function codexHookArgs(o: { decisionFile?: string; goalGate?: string }): string[] {
  const stop: string[] = [];
  const submit: string[] = [];
  // SPEC-184 · marker keputusan. Berbeda dari claude, tak ada teks notifikasi untuk di-grep:
  // Stop SELALU berarti turn berakhir, jadi marker langsung ditulis.
  if (o.decisionFile) {
    stop.push(`echo waiting >> ${shq(o.decisionFile)}`);
    submit.push(`: > ${shq(o.decisionFile)}`);
  }
  // SPEC-332/338 · gate mode goal — entri Stop kedua, berdampingan dengan marker.
  if (o.goalGate) stop.push(`sh ${shq(o.goalGate)}`);
  const args: string[] = [];
  if (stop.length) args.push("-c", `hooks.Stop=${group(stop)}`);
  if (submit.length) args.push("-c", `hooks.UserPromptSubmit=${group(submit)}`);
  return args;
}

// Pagar anti-loop. Gate deterministik tak pernah "cukup puas" seperti evaluator prosa claude:
// bila agen benar-benar mentok (mis. plan mustahil diselesaikan), memaksa terus hanya membakar
// token tanpa kemajuan. Sesudah sekian penolakan, gate melepas dan menyerahkan ke manusia.
export const GOAL_MAX_BLOCKS = 25;

/** Isi skrip sh gate mode goal untuk sesi codex. Dipasang sebagai Stop hook. */
export function codexGoalScript(o: {
  flow: Flow; specId: string; phaseFile: string; worktree: string;
  condition: string; stateFile: string; maxBlocks?: number;
}): string {
  const phases = PIPELINES[o.flow];
  // Gate plan hanya berlaku untuk flow ber-fase Plan+Execute (cermin ADR-0029 & defaultGoalCondition).
  const planGate = phases.includes("Plan") && phases.includes("Execute");
  const max = o.maxBlocks ?? GOAL_MAX_BLOCKS;
  const lines = [
    "#!/bin/sh",
    "# hanoman SPEC-338 · ADR-0074 — gate mode goal sesi codex (deterministik).",
    "# exit 0 = boleh berhenti; exit 2 = stderr jadi continuation prompt, codex lanjut.",
    `PF=${shq(o.phaseFile)}`,
    `ST=${shq(o.stateFile)}`,
    "missing=''",
  ];
  for (const p of phases) {
    lines.push(
      `grep -qE ${shq(`^${p} (done|skipped)[[:space:]]*$`)} "$PF" 2>/dev/null || `
      + `missing="$missing\\n- fase ${p} belum tercatat di \\$HANOMAN_PHASE_FILE"`,
    );
  }
  if (planGate) {
    // Cermin planComplete() di server: hanya berkas plan yang cocok id spec ini yang digerbang.
    // SPEC-734 · INVARIAN 1 · loop atas UNION seluruh planDir terdaftar, bukan satu direktori:
    // item yang lahir dengan satu metode lalu dilanjutkan dengan metode lain akan menemukan
    // direktori metode barunya kosong dan berhenti dengan plan lama yang masih penuh `- [ ]`.
    for (const dir of PLAN_DIRS) {
      lines.push(
        `for f in ${shq(`${o.worktree}/${dir}`)}/*${o.specId.toLowerCase()}*; do`,
        `  [ -f "$f" ] || continue`,
        `  grep -qE '^[ \t]*- \\[ \\]' "$f" && `
        + `missing="$missing\\n- plan $f masih punya task - [ ] yang belum selesai"`,
        "done",
      );
    }
  }
  lines.push(
    'if [ -z "$missing" ]; then exit 0; fi',
    // Pagar anti-loop: hitung penolakan, lepaskan sesudah batas.
    'n=$(cat "$ST" 2>/dev/null || echo 0)',
    "n=$((n+1))",
    'echo "$n" > "$ST" 2>/dev/null || true',
    `if [ "$n" -gt ${max} ]; then`,
    `  echo "hanoman: gate mode goal dilepas sesudah ${max} penolakan — butuh manusia." >&2`,
    "  exit 0",
    "fi",
    // `%b` untuk $missing, BUKAN `%s`: di sh POSIX `\n` di dalam kutip ganda tetap literal
    // backslash-n, jadi hanya %b yang memulihkannya jadi baris beneran.
    `printf '%s\\n\\n' ${shq(o.condition)} >&2`,
    `printf 'Belum terpenuhi:%b\\n' "$missing" >&2`,
    `printf '%s\\n' 'Kerjakan yang masih kurang lalu lanjutkan — jangan berhenti.' >&2`,
    "exit 2",
  );
  return lines.join("\n") + "\n";
}
