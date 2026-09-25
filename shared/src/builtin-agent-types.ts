export type BuiltinAgentDef = {
  readonly name: string;
  /** Dibaca claude untuk MEMILIH subagent. Mulai dengan "Gunakan saat …" — ini pintunya. */
  readonly description: string;
  readonly instructions: string;
  /** Himpunan bagian DEFAULT_AGENT_TOOLS. Nama MCP dilarang: berbeda per mesin. */
  readonly tools: readonly string[];
  readonly enabledByDefault: boolean;
  readonly activation: "smart";
  readonly effort: "low" | "medium" | "high";
  readonly workspacePolicy: "read-only" | "isolated-worktree";
  readonly maxTurns: number | null;
  readonly timeoutSeconds: number | null;
  readonly models: Readonly<Record<"claude" | "codex", string>>;
  /**
   * Amandemen ADR-0094 (2026-09-25) · agen yang boleh dipanggil agen ini. HANYA pengerja
   * isolated-worktree → auditor read-only pasangannya (kedalaman 1, auditor selalu daun), dikunci
   * `shared/test/builtin-agents.test.ts`. Absen = tak boleh mendelegasikan (`Task` dicabut).
   */
  readonly mentions?: readonly string[];
};
