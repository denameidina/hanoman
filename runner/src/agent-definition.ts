import { createHash } from "node:crypto";
import { renderAgentsJson, type AgentDef } from "./custom-agents";
import { renderCodexAgentToml } from "./codex-agent-config";
import { readOnlyHookSource } from "./agent-readonly";
import type { Agent } from "./types";

/** Freeze the executed prompt/profile at session birth, independent of later catalog edits. */
export function agentDefinitionHash(
  def: AgentDef, roster: AgentDef[], runtime: Agent,
  inherited: { model?: string | null; effort?: string | null; promptSuffix?: string } = {},
): string {
  // Temp paths vary every session; the stable hook slot plus its source identifies the policy.
  const options = { readOnlyHookCommand: "<hanoman-read-only-hook>", promptSuffix: inherited.promptSuffix };
  const liveRoster = [def, ...roster.filter((entry) => entry.name !== def.name)];
  const native = runtime === "codex"
    ? renderCodexAgentToml(def, liveRoster, options)
    : JSON.parse(renderAgentsJson(liveRoster, options))[def.name] as { tools: string[] };
  if (typeof native !== "string") native.tools.sort();
  return createHash("sha256").update(JSON.stringify({
    version: 1, runtime, native, activation: def.activation ?? "always",
    model: def.model ?? inherited.model ?? null,
    effort: def.effort ?? inherited.effort ?? null,
    readOnlyPolicy: def.workspacePolicy === "read-only" ? readOnlyHookSource() : null,
  })).digest("hex");
}
