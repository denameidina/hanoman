import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ReadOnlyDecision = { allowed: true } | { allowed: false; reason: string };

const POLICY = {
  directTools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"],
  shellTools: ["Bash", "local_shell", "exec_command"],
  deniedTools: ["Write", "Edit", "Task", "apply_patch", "spawn_agent"],
  shellCommands: ["rg", "sed", "head", "tail", "wc", "ls"],
  gitCommands: ["diff", "show", "status", "log"],
} as const;

/** Kept standalone because its source is embedded alongside the evaluator in the hook file. */
function denyReadOnly(detail: string): ReadOnlyDecision {
  return { allowed: false, reason: `Hanoman read-only policy: ${detail}` };
}

/** Tokenizer kecil untuk memeriksa argv tanpa mengeksekusi shell. Operator shell ditolak lebih dulu. */
function tokenizeReadOnlyCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let escaped = false;
  let active = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (escaped) {
      token += char;
      escaped = false;
      active = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else if (char === "\\" && quote === '"') escaped = true;
      else token += char;
      active = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      active = true;
    } else if (char === "\\") {
      escaped = true;
      active = true;
    } else if (/\s/.test(char)) {
      if (active) {
        tokens.push(token);
        token = "";
        active = false;
      }
    } else {
      token += char;
      active = true;
    }
  }
  if (quote || escaped) return null;
  if (active) tokens.push(token);
  return tokens;
}

/** Standalone on purpose: its source is embedded in the temporary hook script below. */
function evaluateReadOnlyPayload(payload: unknown, policy: {
  directTools: readonly string[];
  shellTools: readonly string[];
  deniedTools: readonly string[];
  shellCommands: readonly string[];
  gitCommands: readonly string[];
}, environment: Record<string, string | undefined>): ReadOnlyDecision {
  if (!payload || typeof payload !== "object") return denyReadOnly("payload hook tidak sah");
  const event = payload as Record<string, unknown>;
  const tool = typeof event.tool_name === "string"
    ? event.tool_name
    : typeof event.toolName === "string" ? event.toolName : "";
  if (!tool) return denyReadOnly("nama tool tidak tersedia");
  if (policy.directTools.includes(tool)) return { allowed: true };
  if (policy.deniedTools.includes(tool) || tool.startsWith("mcp__")) {
    return denyReadOnly(`tool ${tool} dapat mengubah state`);
  }
  if (!policy.shellTools.includes(tool)) return denyReadOnly(`tool ${tool} tidak terbukti read-only`);

  const rawInput = event.tool_input;
  const input = rawInput && typeof rawInput === "object" ? rawInput as Record<string, unknown> : {};
  const command = typeof input.command === "string"
    ? input.command
    : typeof input.cmd === "string" ? input.cmd : "";
  const trimmed = command.trim();
  if (!trimmed) return denyReadOnly("perintah shell kosong atau tidak dikenal");
  if (/\r|\n|;|&&|\|\||\||[<>]|\$|`/.test(trimmed)) {
    return denyReadOnly("operator shell yang dapat merangkai atau menulis dilarang");
  }

  const tokens = tokenizeReadOnlyCommand(trimmed);
  if (!tokens?.length) return denyReadOnly("perintah shell tidak dapat diparse dengan aman");
  const first = tokens[0] ?? "";
  const commandName = first.split("/").pop() ?? "";
  // Hanya executable dari PATH yang boleh lolos. Membolehkan `./rg` atau `/tmp/git` berdasarkan
  // basename memberi repo/pemanggil kesempatan mengganti program baca dengan executable mutatif.
  if (first !== commandName) {
    return denyReadOnly("executable ber-path tidak diizinkan; gunakan command allowlist dari PATH");
  }
  if (commandName === "git") {
    const subcommand = tokens[1] ?? "";
    if (!policy.gitCommands.includes(subcommand)) {
      return denyReadOnly(`git ${subcommand || "<kosong>"} bukan operasi baca yang diizinkan`);
    }
    const args = tokens.slice(2);
    if (args.some((arg) => arg === "--output" || arg.startsWith("--output=")
      || arg === "--ext-diff" || arg === "--textconv")) {
      return denyReadOnly("opsi git dapat menulis atau menjalankan helper eksternal");
    }
    if (subcommand !== "status"
      && (!args.includes("--no-ext-diff") || !args.includes("--no-textconv"))) {
      return denyReadOnly("git diff/show/log wajib menonaktifkan helper eksternal dan textconv");
    }
    return { allowed: true };
  }
  if (!policy.shellCommands.includes(commandName)) {
    return denyReadOnly(`perintah ${commandName || "<kosong>"} tidak terbukti read-only`);
  }
  // ripgrep membaca file ini sebelum menilai argv. Isinya dapat menyuntikkan `--pre <program>`,
  // sehingga command `rg pattern .` yang tampak murni baca sebenarnya mengeksekusi program lain.
  if (commandName === "rg" && environment.RIPGREP_CONFIG_PATH?.trim()) {
    return denyReadOnly("RIPGREP_CONFIG_PATH dapat menyuntikkan preprocessor eksternal");
  }
  if (commandName === "rg" && tokens.slice(1).some((arg) =>
    arg === "--pre" || arg.startsWith("--pre=") || arg === "--pre-glob"
    || arg.startsWith("--pre-glob=") || arg === "--hostname-bin"
    || arg.startsWith("--hostname-bin="))) {
    return denyReadOnly("opsi rg dapat menjalankan helper eksternal");
  }
  if (commandName === "sed") {
    const quiet = tokens[1] === "-n" || tokens[1] === "--quiet" || tokens[1] === "--silent";
    const printOnly = /^\d+(?:,\d+)?p$/.test(tokens[2] ?? "");
    const files = tokens.slice(3);
    if (!quiet || !printOnly || files.length === 0 || files.some((arg) => arg.startsWith("-"))) {
      return denyReadOnly("hanya sed -n '<baris>[,<baris>]p' <berkas> yang diizinkan");
    }
  }
  return { allowed: true };
}

export function readOnlyDecision(
  payload: unknown,
  environment: Record<string, string | undefined> = process.env,
): ReadOnlyDecision {
  return evaluateReadOnlyPayload(payload, POLICY, environment);
}

export function readOnlyHookSource(): string {
  return [
    '"use strict";',
    `const denyReadOnly = ${denyReadOnly.toString()};`,
    `const tokenizeReadOnlyCommand = ${tokenizeReadOnlyCommand.toString()};`,
    `const evaluate = ${evaluateReadOnlyPayload.toString()};`,
    `const policy = ${JSON.stringify(POLICY)};`,
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => { input += chunk; });",
    "process.stdin.on('end', () => {",
    "  let payload;",
    "  try { payload = JSON.parse(input); } catch { payload = null; }",
    "  const decision = evaluate(payload, policy, process.env);",
    "  if (!decision.allowed) { process.stderr.write(decision.reason + '\\n'); process.exitCode = 2; }",
    "});",
    "process.stdin.resume();",
    "",
  ].join("\n");
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function writeReadOnlyHook(dir: string): { path: string; command: string } {
  const path = join(dir, "custom-agent-readonly.cjs");
  writeFileSync(path, readOnlyHookSource(), { mode: 0o600 });
  chmodSync(path, 0o600);
  // Resolve lewat PATH child. process.execPath adalah path host (mis. Homebrew macOS) yang tidak
  // ada di image Podman Linux walau direktori hook sudah di-mount.
  return { path, command: `node ${shellQuote(path)}` };
}
