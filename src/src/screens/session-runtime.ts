import {
  MODELS, claudeEfforts, coerceClaudeEffort, CODEX_MODELS, codexEfforts, coerceCodexEffort,
  modelSelectOptions, subagentClaudeModels, type Agent,
} from "@hanoman/shared";

/** Default per agen sebagaimana dibaca dari `GET /settings` (blok claude & blok codex). */
export type RuntimeDefs = Record<Agent, { model: string; effort: string }>;

/**
 * SPEC-517 · aturan katalog runtime dipakai DUA picker: "Mulai sesi" backlog (ADR-0061) dan
 * "Sesi baru" terminal. Ia hidup di satu berkas supaya keduanya tak bisa berselisih pendapat —
 * pola yang sama dengan `codexClientTooOld` yang menyatukan Settings & picker Start (SPEC-339).
 */
export function runtimeModels(agent: Agent): readonly { id: string; label: string; resolved?: string }[] {
  return agent === "codex" ? CODEX_MODELS : MODELS;
}

/** Katalog untuk model SUBAGENT per fase — tanpa alias `default` yang hanya sah untuk `--model`. */
export function runtimeSubagentModels(agent: Agent): readonly { id: string; label: string }[] {
  return agent === "codex" ? CODEX_MODELS : subagentClaudeModels();
}

/**
 * Opsi picker "Model" — `runtimeModels(agent)` plus jaminan `current` tetap jadi opsi walau
 * katalog sudah tak menyebutnya (model pensiun di CLI). Satu implementasi dipakai "Mulai sesi"
 * (App.tsx) dan "Sesi baru" (NewTerminalModal.tsx) supaya keduanya tak berselisih pendapat.
 */
export function runtimeModelOptions(agent: Agent, current: string): { value: string; label: string }[] {
  return modelSelectOptions(runtimeModels(agent), current);
}

/** SPEC-339 · effort adalah properti MODEL untuk codex; untuk claude ia properti CLI. */
export function runtimeEfforts(agent: Agent, model: string): readonly string[] {
  return agent === "codex" ? codexEfforts(model) : claudeEfforts(model);
}

/**
 * Model & effort default untuk `agent`, diambil dari blok agen ITU. Menukar agen tanpa menukar
 * model melahirkan `codex -m claude-opus-5` — bug SPEC-377. Effort codex dikoreksi sekarang juga
 * supaya perubahannya TERLIHAT di picker, bukan terjadi diam-diam saat sesi lahir.
 */
export function runtimeFor(defs: RuntimeDefs, agent: Agent): { model: string; effort: string } {
  const d = defs[agent];
  return {
    model: d.model,
    effort: agent === "codex" ? coerceCodexEffort(d.model, d.effort) : coerceClaudeEffort(d.model, d.effort),
  };
}
