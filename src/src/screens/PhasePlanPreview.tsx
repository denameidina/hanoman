import React from "react";
import {
  CLAUDE_SUBAGENT_INHERIT, CODEX_NATIVE_AGENTS_MIN_CLIENT, codexNativeAgentsSupported, resolvePhasePlan,
  coerceClaudeEffort, coerceCodexEffort, modelSelectOptions, type Agent, type Orchestration,
  type OrchestrationFlow, type PhaseOverrides,
} from "@hanoman/shared";
import { Select } from "../ds";
import { modelLabel } from "./phase-chip";
import { runtimeEfforts, runtimeSubagentModels } from "./session-runtime";

// ADR-0164 · pratinjau read-only. Memanggil resolver yang SAMA dengan server (`resolvePhasePlan`),
// dengan gerbang versi codex yang sama — dua salinan aturan akan membuat pratinjau berbohong.
const NOTE: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, marginBottom: 12, color: "var(--text-muted)" };

export function PhasePlanPreview({ flow, agent, model, effort, orchestration, codexVersion, loading,
  phaseOverrides, onPhaseOverridesChange,
}: {
  flow: OrchestrationFlow; agent: Agent; model: string; effort: string;
  orchestration: Orchestration | undefined; codexVersion: string | null; loading: boolean;
  phaseOverrides?: PhaseOverrides;
  onPhaseOverridesChange?: (next: PhaseOverrides) => void;
}) {
  // ADR-0164 · gerbang muat: ketiadaan data BELUM dimuat ≠ orkestrasi mati/codex tak mendukung —
  // sama seperti `codexVer` null (tak terdeteksi) berbeda dari "belum sempat dicek" (SPEC-339).
  // Tanpa gerbang ini pratinjau sempat berbohong "sesi tunggal" sebelum respons Settings/versi tiba.
  if (loading) {
    return <div data-testid="phase-plan-preview" style={NOTE}>Memuat rencana fase…</div>;
  }
  const cfg = orchestration?.[flow];
  if (cfg?.enabled === false) {
    return <div data-testid="phase-plan-preview" style={NOTE}>Orkestrasi mati untuk flow ini — sesi tunggal.</div>;
  }
  const nativeAgents = agent === "claude" || codexNativeAgentsSupported(codexVersion);
  const resolveWith = (overrides: PhaseOverrides | undefined) => resolvePhasePlan({
    flow, runtime: agent, orchestration, orchestrator: { model, effort }, phaseOverrides: overrides, nativeAgents,
  });
  const plan = resolveWith(phaseOverrides);
  // Audit R6 · nilai yang dipakai bila SATU bagian override fase dilepas — isi opsi kosong Select,
  // supaya "warisi" menyebut sumber & nilainya (sel Settings, atau orchestrator), bukan rekomendasi kabur.
  const inheritedOf = (phase: string, key: "model" | "effort"): string => {
    const rest = { ...(phaseOverrides ?? {}) };
    const own = { ...(rest[phase] ?? {}) };
    delete own[key];
    if (Object.keys(own).length) rest[phase] = own;
    else delete rest[phase];
    return resolveWith(rest)?.phases.find((x) => x.phase === phase)?.[key] ?? "";
  };
  if (!plan) {
    return (
      <div data-testid="phase-plan-preview" style={NOTE}>
        Codex CLI {codexVersion ?? "tak terdeteksi"} belum mendukung subagent native (butuh ≥
        {" "}{CODEX_NATIVE_AGENTS_MIN_CLIENT}) — sesi tunggal.
      </div>
    );
  }
  return (
    <div data-testid="phase-plan-preview" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fase — dikerjakan subagent</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>
        {plan.phases.map((p) => {
          const cell = cfg?.[agent]?.[p.phase];
          const override = phaseOverrides?.[p.phase];
          const modelInherited = !cell?.model;
          const effortInherited = !cell?.effort;
          // Tanda per bagian: sel bisa diisi separuh (model tanpa effort atau sebaliknya) — tandai
          // bagian yang benar-benar mewarisi orchestrator, bukan seluruh sel sekaligus. Audit R6: override
          // sesi pun per bagian — override model tak boleh menyembunyikan effort yang masih mewarisi.
          const modelTag = override?.model ? "override" : modelInherited ? "warisi" : "";
          const effortTag = override?.effort ? "override" : effortInherited ? "warisi" : "";
          const tags = modelTag && modelTag === effortTag
            ? [modelTag === "override" ? "override sesi" : "warisi"]
            : [modelTag && `model ${modelTag}`, effortTag && `effort ${effortTag}`].filter(Boolean);
          const suffix = tags.length ? ` (${tags.join(" · ")})` : "";
          const modelSource = cell?.model ? "Settings" : "orchestrator";
          const effortSource = cell?.effort ? "Settings" : "orchestrator";
          const efforts = runtimeEfforts(agent, p.model);
          // Nilai tersimpan tetap jadi opsi walau model hasil resolusi tak mendukungnya (pola
          // `modelSelectOptions`) — tanpa ini Select tampil "warisi" padahal override masih terkirim.
          const effortOptions = [
            ...(override?.effort && !efforts.includes(override.effort)
              ? [{ value: override.effort, label: `${override.effort} (dikoersi → ${p.effort})` }] : []),
            ...efforts.map((v) => ({ value: v, label: v })),
          ];
          const updateOverride = (key: "model" | "effort", value: string) => {
            if (!onPhaseOverridesChange) return;
            const current = { ...(phaseOverrides?.[p.phase] ?? {}) };
            if (value) current[key] = value;
            else delete current[key];
            const selectedModel = current.model ?? cell?.model ?? model;
            if (key === "model" && current.effort) {
              current.effort = agent === "codex"
                ? coerceCodexEffort(selectedModel, current.effort)
                : coerceClaudeEffort(selectedModel, current.effort);
            }
            const next = { ...(phaseOverrides ?? {}) };
            if (Object.keys(current).length) next[p.phase] = current;
            else delete next[p.phase];
            onPhaseOverridesChange(next);
          };
          return (
            <li key={p.phase} style={{ overflowWrap: "anywhere", marginBottom: onPhaseOverridesChange ? 8 : 0 }}>
              <div>{p.phase} · {modelLabel(p.model)} · {p.effort}{suffix}</div>
              {onPhaseOverridesChange && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, .65fr)", gap: 6, marginTop: 4 }}>
                  <Select size="sm" aria-label={`Model subagent ${p.phase}`} value={override?.model ?? ""}
                    onChange={(e) => updateOverride("model", e.target.value)} style={controlStyle}
                    options={[
                      { value: "", label: inheritLabel(modelSource, inheritedOf(p.phase, "model")) },
                      ...modelSelectOptions(runtimeSubagentModels(agent), override?.model ?? ""),
                    ]} />
                  <Select size="sm" aria-label={`Effort subagent ${p.phase}`} value={override?.effort ?? ""}
                    onChange={(e) => updateOverride("effort", e.target.value)} style={controlStyle}
                    options={[
                      { value: "", label: `Warisi ${effortSource} · ${inheritedOf(p.phase, "effort")}` },
                      ...effortOptions,
                    ]} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const controlStyle: React.CSSProperties = { width: "100%", minWidth: 0 };

// `inherit` = orchestrator ber-`default` (alias yang tak sah di `--agents`): cukup sebut sumbernya.
const inheritLabel = (source: string, id: string): string =>
  !id || id === CLAUDE_SUBAGENT_INHERIT ? `Warisi ${source}` : `Warisi ${source} · ${modelLabel(id)}`;
