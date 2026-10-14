import type { Agent } from "./types";

export const ANTIGRAVITY_ENV_KEYS = ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"] as const;

/** Env runtime baru dibatasi pada pemakainya, tanpa menghapus GOOGLE_* milik project. */
export function agentEnvironment(agent: Agent | null, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  if (agent === "antigravity") {
    delete result.CLAUDE_CODE_OAUTH_TOKEN;
    delete result.ANTHROPIC_API_KEY;
  } else {
    for (const key of ANTIGRAVITY_ENV_KEYS) delete result[key];
  }
  return result;
}
