import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cmpVersion } from "@hanoman/shared";
import { agentDelegationClause, agentPromptOf, type AgentDef } from "./custom-agents";
import { resolveHardening } from "./runtime-profile";

/** Versi pertama yang benar-benar diverifikasi membawa custom agents + hooks stabil. */
export const CODEX_NATIVE_AGENTS_MIN_CLIENT = "0.151.0";

export function codexNativeAgentsSupported(version: string | null): boolean {
  const parsed = version ? /(\d+)\.(\d+)\.(\d+)/.exec(version)?.[0] : null;
  return parsed ? cmpVersion(parsed, CODEX_NATIVE_AGENTS_MIN_CLIENT) >= 0 : false;
}

type VersionProbeEnv = Record<string, string | undefined>;
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Command that observes the same Codex executable context a session will actually use. */
export function codexNativeVersionProbe(
  env: VersionProbeEnv,
  codexBin = env.HANOMAN_CODEX_BIN ?? "codex",
): { bin: string; args: string[] } {
  const sandbox = env.HANOMAN_SESSION_SANDBOX ?? (resolveHardening(env) ? "required" : "off");
  if (sandbox !== "podman") return { bin: codexBin, args: ["--version"] };
  return {
    bin: env.HANOMAN_PODMAN_BIN ?? "podman",
    args: [
      "run", "--rm", "--read-only", "--cap-drop=ALL", "--userns=keep-id",
      "--network", "none", env.HANOMAN_SESSION_IMAGE ?? "hanoman-agent:latest",
      "/bin/sh", "-lc", `${shellQuote(codexBin)} --version`,
    ],
  };
}

const tomlString = (value: string): string => JSON.stringify(value);
const tomlKey = (value: string): string => JSON.stringify(value);

export type CodexMaterializationWarning = { agentName: string; reason: string };
export type CodexMaterialization = {
  args: string[];
  delegationClause: string;
  configPaths: string[];
  warnings: CodexMaterializationWarning[];
  liveDefs: AgentDef[];
};

type RenderOptions = { readOnlyHookCommand?: string; promptSuffix?: string };

export function renderCodexAgentToml(
  def: AgentDef,
  roster: AgentDef[],
  options: RenderOptions = {},
): string {
  const lines = [
    `name = ${tomlString(def.name)}`,
    `description = ${tomlString(def.description)}`,
    `developer_instructions = ${tomlString(agentPromptOf(def, roster, "codex") + (options.promptSuffix ?? ""))}`,
    ...(def.model ? [`model = ${tomlString(def.model)}`] : []),
    ...(def.effort ? [`model_reasoning_effort = ${tomlString(def.effort)}`] : []),
    ...(def.workspacePolicy === "read-only" ? ['sandbox_mode = "read-only"'] : []),
  ];
  if (def.workspacePolicy === "read-only" && options.readOnlyHookCommand) {
    lines.push(
      "",
      "[[hooks.PreToolUse]]",
      "",
      "[[hooks.PreToolUse.hooks]]",
      'type = "command"',
      `command = ${tomlString(options.readOnlyHookCommand)}`,
      "timeout = 5",
    );
  }
  return `${lines.join("\n")}\n`;
}

type MaterializeOptions = RenderOptions & {
  /** Absen = pemanggil sudah menjamin kompatibilitas; null = probe gagal, jadi jangan mengarang. */
  clientVersion?: string | null;
  writeFile?: (path: string, content: string) => void;
  chmod?: (path: string, mode: number) => void;
};

const safeFilename = (name: string): string => name.replace(/[^a-z0-9-]/gi, "-");

export function materializeCodexAgents(
  defs: AgentDef[],
  tempDir: string,
  options: MaterializeOptions = {},
): CodexMaterialization {
  if (defs.length === 0) {
    return { args: [], delegationClause: "", configPaths: [], warnings: [], liveDefs: [] };
  }
  if ("clientVersion" in options && !codexNativeAgentsSupported(options.clientVersion ?? null)) {
    const seen = options.clientVersion ?? "tak terdeteksi";
    return {
      args: [], delegationClause: "", configPaths: [], liveDefs: [],
      warnings: defs.map((def) => ({
        agentName: def.name,
        reason: `Codex ${seen} tidak mendukung custom agent native; butuh >= ${CODEX_NATIVE_AGENTS_MIN_CLIENT}`,
      })),
    };
  }
  const write = options.writeFile
    ?? ((path: string, content: string) => writeFileSync(path, content, { mode: 0o600 }));
  const chmod = options.chmod ?? chmodSync;
  const successful: Array<{ def: AgentDef; path: string }> = [];
  const warnings: CodexMaterializationWarning[] = [];

  for (const [index, def] of defs.entries()) {
    if (def.workspacePolicy === "isolated-worktree") {
      warnings.push({
        agentName: def.name,
        reason: "isolated-worktree belum tersedia untuk subagent Codex",
      });
      continue;
    }
    const path = join(tempDir, `${String(index).padStart(2, "0")}-${safeFilename(def.name)}.toml`);
    try {
      write(path, renderCodexAgentToml(def, defs, options));
      chmod(path, 0o600);
      successful.push({ def, path });
    } catch (error) {
      warnings.push({
        agentName: def.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (successful.length === 0) {
    return { args: [], delegationClause: "", configPaths: [], warnings, liveDefs: [] };
  }

  const args = [
    "-c", "agents.enabled=true",
    "-c", "agents.max_concurrent_threads_per_session=3",
  ];
  for (const { def, path } of successful) {
    const key = `agents.${tomlKey(def.name)}`;
    args.push("-c", `${key}.description=${tomlString(def.description)}`);
    args.push("-c", `${key}.config_file=${tomlString(path)}`);
  }
  const liveDefs = successful.map((entry) => entry.def);
  return {
    args,
    delegationClause: agentDelegationClause(liveDefs, "codex"),
    configPaths: successful.map((entry) => entry.path),
    warnings,
    liveDefs,
  };
}
