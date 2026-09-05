import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveStr } from "../config";
import { sandboxArgvFromEnv } from "./session-sandbox";
import { parseClaudeModels, parseCodexModels } from "./model-catalog-parser";

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export const CLAUDE_CATALOG_ARGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config",
  "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}',
];

export function catalogCommand(agent: "claude" | "codex", cwd: string, env: NodeJS.ProcessEnv) {
  const bin = env[agent === "claude" ? "HANOMAN_CLAUDE_BIN" : "HANOMAN_CODEX_BIN"] ?? agent;
  const args = agent === "claude" ? CLAUDE_CATALOG_ARGS : ["debug", "models"];
  const sandbox = sandboxArgvFromEnv({ command: [bin, ...args].map(quote).join(" "),
    worktree: cwd, worktreeMode: "ro", env });
  if (!sandbox) return { bin, args };
  // Control request is streamed over stdin; the sandbox otherwise shares the session boundary.
  sandbox.splice(2, 0, "-i");
  return { bin: sandbox[0]!, args: sandbox.slice(1) };
}

export function runCatalogCommand(
  command: { bin: string; args: string[] }, agent: "claude" | "codex",
  cwd: string, env: NodeJS.ProcessEnv, timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.bin, command.args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "", bytes = 0, settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error: Error | null, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
        killTimer.unref();
      }
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("Pemeriksaan model melewati batas waktu")), timeoutMs);
    child.on("error", () => finish(new Error("CLI model tidak dapat dijalankan")));
    child.stdin.on("error", () => finish(new Error("Kanal katalog CLI terputus")));
    child.stderr.on("data", () => { /* Never surface CLI diagnostics: may include credentials. */ });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) return finish(new Error("Katalog CLI melebihi batas ukuran"));
      buffer += chunk;
      if (agent !== "claude") return;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.type !== "control_response" || msg.response?.request_id !== "hanoman-models") continue;
          if (msg.response.subtype !== "success") return finish(new Error("CLI menolak pemeriksaan model"));
          return finish(null, msg.response.response?.models);
        } catch { return finish(new Error("Katalog CLI bukan JSON yang sah")); }
      }
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (settled) return;
      if (code !== 0 || agent === "claude") return finish(new Error("CLI tidak mengembalikan katalog model"));
      try { finish(null, JSON.parse(buffer)); }
      catch { finish(new Error("Katalog CLI bukan JSON yang sah")); }
    });
    if (agent === "claude") child.stdin.write(JSON.stringify({
      type: "control_request", request_id: "hanoman-models", request: { subtype: "initialize" },
    }) + "\n");
    else child.stdin.end();
  });
}

export async function probeModelCatalog(agent: "claude" | "codex") {
  const cwd = await mkdtemp(join(tmpdir(), "hanoman-models-"));
  const env = { ...process.env };
  for (const key of ["HANOMAN_CLAUDE_BIN", "HANOMAN_CODEX_BIN", "HANOMAN_PODMAN_BIN"]) {
    const value = effectiveStr(key);
    if (value) env[key] = value;
  }
  delete env.CLAUDECODE;
  if (env.HANOMAN_CODEX_HOME) env.CODEX_HOME = env.HANOMAN_CODEX_HOME;
  if (env.HANOMAN_CLAUDE_HOME) env.CLAUDE_CONFIG_DIR = env.HANOMAN_CLAUDE_HOME;
  try {
    const raw = await runCatalogCommand(catalogCommand(agent, cwd, env), agent, cwd, env);
    return agent === "claude" ? parseClaudeModels(raw) : parseCodexModels(raw);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
