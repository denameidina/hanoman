import {
  MODELS, claudeEfforts, coerceClaudeEffort, CODEX_MODELS, codexEfforts, coerceCodexEffort,
  modelSelectOptions, subagentClaudeModels, ANTIGRAVITY_MODELS, ANTIGRAVITY_CHILD_TIERS, antigravityEfforts, AGENT_RUNTIMES, AGENT_RUNTIME_LABELS, type Agent,
  builtinAccountId, type AccountLimitsDTO,
} from "@hanoman/shared";
import { resetPassed } from "../lib/limit-reset";

/** Default per agen sebagaimana dibaca dari `GET /settings` (blok setiap runtime). */
export type RuntimeDefs = Record<Agent, { model: string; effort: string }>;

/**
 * SPEC-517 · aturan katalog runtime dipakai DUA picker: "Mulai sesi" backlog (ADR-0061) dan
 * "Sesi baru" terminal. Ia hidup di satu berkas supaya keduanya tak bisa berselisih pendapat —
 * pola yang sama dengan `codexClientTooOld` yang menyatukan Settings & picker Start (SPEC-339).
 */
export function runtimeModels(agent: Agent): readonly { id: string; label: string; resolved?: string }[] {
  return agent === "antigravity" ? ANTIGRAVITY_MODELS : agent === "codex" ? CODEX_MODELS : MODELS;
}

/** Katalog untuk model SUBAGENT per fase — tanpa alias `default` yang hanya sah untuk `--model`. */
export function runtimeSubagentModels(agent: Agent): readonly { id: string; label: string }[] {
  return agent === "antigravity" ? ANTIGRAVITY_CHILD_TIERS.map((id) => ({ id, label: id })) : agent === "codex" ? CODEX_MODELS : subagentClaudeModels();
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
  return agent === "antigravity" ? antigravityEfforts(model) : agent === "codex" ? codexEfforts(model) : claudeEfforts(model);
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
    effort: runtimeCoerceEffort(agent, d.model, d.effort),
  };
}

export const runtimeOptions = AGENT_RUNTIMES.map((value) => ({ value, label: AGENT_RUNTIME_LABELS[value] }));

export function runtimeCoerceEffort(agent: Agent, model: string, effort: string): string {
  if (agent === "antigravity") return antigravityEfforts(model)[0] ?? effort;
  return agent === "codex" ? coerceCodexEffort(model, effort) : coerceClaudeEffort(model, effort);
}

// ADR-0234 · pemilihan akun runtime — dipakai picker Start DAN form "Sesi baru" (satu sumber).
export const accountsFor = (list: readonly AccountLimitsDTO[], agent: Agent): AccountLimitsDTO[] =>
  list.filter((a) => a.runtime === agent);

export function defaultAccountId(list: readonly AccountLimitsDTO[], agent: Agent): string {
  return accountsFor(list, agent).find((a) => a.isDefault)?.accountId ?? builtinAccountId(agent);
}

/** Persen terburuk di antara window yang belum reset; null = tak ada data. */
export function accountWorstPct(a: AccountLimitsDTO, now: number = Date.now()): number | null {
  if (!a.limits.windows.length) return null;
  const live = a.limits.windows.filter((w) => !resetPassed(w, a.limits.status, now));
  return live.length ? Math.max(...live.map((w) => w.usedPct)) : 0;
}

/** Penanda teks (bukan warna saja): ⚠ ≥70%, ‼ ≥90%. Tak pernah memilih akun otomatis. */
export const accountMarker = (pct: number): string => (pct >= 90 ? " ‼" : pct >= 70 ? " ⚠" : "");

export function accountOptionLabel(a: AccountLimitsDTO, now: number = Date.now()): string {
  if (a.loginStatus !== "aktif") return `${a.label} · ${a.loginStatus === "belum-login" ? "belum login" : "perlu login ulang"}`;
  const all = a.limits.windows;
  if (all.length && all.every((w) => resetPassed(w, a.limits.status, now))) return `${a.label} · sudah reset`;
  const pct = accountWorstPct(a, now);
  return pct === null ? a.label : `${a.label} · ${pct}%${accountMarker(pct)}`;
}

/** Kirim `account` hanya bila field Akun memang tampil (runtime punya ≥2 akun). */
export const accountChoice = (list: readonly AccountLimitsDTO[], agent: Agent, value: string): { account?: string } =>
  value && accountsFor(list, agent).length >= 2 ? { account: value } : {};

