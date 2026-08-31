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

/** Standalone on purpose: its source is embedded in the temporary hook script below. */
function evaluateReadOnlyPayload(payload: unknown, policy: {
  directTools: readonly string[];
  shellTools: readonly string[];
  deniedTools: readonly string[];
  shellCommands: readonly string[];
  gitCommands: readonly string[];
}): ReadOnlyDecision {
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
  if (/\r|\n|;|&&|\|\||\||[<>]|\$\(|`/.test(trimmed)) {
    return denyReadOnly("operator shell yang dapat merangkai atau menulis dilarang");
  }

  const first = trimmed.split(/\s+/, 1)[0] ?? "";
  const commandName = first.split("/").pop() ?? "";
  if (commandName === "git") {
    const subcommand = trimmed.slice(first.length).trim().split(/\s+/, 1)[0] ?? "";
    return policy.gitCommands.includes(subcommand)
      ? { allowed: true }
      : denyReadOnly(`git ${subcommand || "<kosong>"} bukan operasi baca yang diizinkan`);
  }
  if (!policy.shellCommands.includes(commandName)) {
    return denyReadOnly(`perintah ${commandName || "<kosong>"} tidak terbukti read-only`);
  }
  if (commandName === "sed"
    && /(^|\s)(?:-i\S*|--in-place(?:=\S*)?)(?:\s|$)/.test(trimmed)) {
    return denyReadOnly("sed in-place dapat mengubah berkas");
  }
  return { allowed: true };
}

export function readOnlyDecision(payload: unknown): ReadOnlyDecision {
  return evaluateReadOnlyPayload(payload, POLICY);
}

export function readOnlyHookSource(): string {
  return [
    '"use strict";',
    `const denyReadOnly = ${denyReadOnly.toString()};`,
    `const evaluate = ${evaluateReadOnlyPayload.toString()};`,
    `const policy = ${JSON.stringify(POLICY)};`,
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => { input += chunk; });",
    "process.stdin.on('end', () => {",
    "  let payload;",
    "  try { payload = JSON.parse(input); } catch { payload = null; }",
    "  const decision = evaluate(payload, policy);",
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
  return { path, command: `${shellQuote(process.execPath)} ${shellQuote(path)}` };
}
