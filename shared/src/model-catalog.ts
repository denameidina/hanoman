import { MODELS, CODEX_MODELS, type ClaudeModel, type CodexModel } from "./entities";

export type ModelProviderStatus = {
  source: "bundled" | "cache" | "cli";
  checkedAt: string | null;
  updatedAt: string | null;
  error: string | null;
};
export type ModelCatalog = {
  claude: readonly ClaudeModel[];
  codex: readonly CodexModel[];
  providers: Record<"claude" | "codex", ModelProviderStatus>;
};

// Captured before any runtime snapshot is installed. Never used as a model allowlist.
export const BUNDLED_CLAUDE_MODELS = MODELS;
export const BUNDLED_CODEX_MODELS = CODEX_MODELS;
export function bundledModelCatalog(): ModelCatalog {
  const status: ModelProviderStatus = { source: "bundled", checkedAt: null, updatedAt: null, error: null };
  return {
    claude: BUNDLED_CLAUDE_MODELS, codex: BUNDLED_CODEX_MODELS,
    providers: { claude: { ...status }, codex: { ...status } },
  };
}
