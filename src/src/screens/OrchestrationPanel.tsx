import React from "react";
import { Card, Select, Switch } from "../ds";
import {
  EXECUTE_MODE_FLOWS, FLOW_PHASES, ORCHESTRATION_DEFAULTS, ORCHESTRATION_FLOWS, coerceClaudeEffort, coerceCodexEffort,
  type Agent, type FlowOrchestration, type Orchestration, type OrchestrationFlow, type PhaseCell,
} from "@hanoman/shared";
import { runtimeEfforts, runtimeSubagentModels } from "./session-runtime";

// ADR-0164 · matriks model/effort per fase. Satu-satunya penulis `Setting.orchestration` adalah tab
// ini, jadi menulis dari snapshot mount aman (pola `changelog`, bukan baca-ulang lead/telegram).
// Katalog dibaca lewat `session-runtime.ts` — sumber yang sama dengan picker Start.

const FLOW_LABEL: Record<OrchestrationFlow, string> = {
  feature: "Brief (feature)", qa: "QA", scaffold: "Scaffold", reverse: "Reverse docs", prd: "PRD",
  audit: "Audit", breakdown: "Breakdown PRD", goal: "Goal", no_effort: "No effort",
};
const RUNTIMES: { id: Agent; label: string }[] = [
  { id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex CLI" },
];
// Amandemen ADR-0170 P2 · cara fase Execute/Goal (sesi Claude) mengerjakan plan.
const EXECUTE_MODE_OPTIONS = [
  { value: "inline", label: "Inline — agen fase mengerjakan task sendiri (cepat)" },
  { value: "subagent", label: "Subagent per task — implementer + review tiap task (lebih lambat)" },
];
const EMPTY_CELL: PhaseCell = { model: null, effort: null };
const CELL: React.CSSProperties = { padding: "6px 8px", borderTop: "1px solid var(--border-hair)", verticalAlign: "top" };

function CellPicker({ flow, phase, runtime, cell, onPick }: {
  flow: OrchestrationFlow; phase: string; runtime: Agent; cell: PhaseCell;
  onPick: (next: PhaseCell, msg: string) => void;
}) {
  const models = runtimeSubagentModels(runtime);
  const efforts = runtimeEfforts(runtime, cell.model ?? "");
  const coerce = runtime === "codex" ? coerceCodexEffort : coerceClaudeEffort;
  const modelOptions = [
    { value: "", label: "— warisi orchestrator" },
    // Nilai di luar katalog (PUT ber-AgentToken, model lama) tetap tampil supaya picker tak kosong.
    ...(cell.model && !models.some((m) => m.id === cell.model) ? [{ value: cell.model, label: cell.model }] : []),
    ...models.map((m) => ({ value: m.id, label: m.label })),
  ];
  const effortOptions = [
    { value: "", label: "— warisi" },
    ...(cell.effort && !efforts.includes(cell.effort) ? [{ value: cell.effort, label: cell.effort }] : []),
    ...efforts.map((e) => ({ value: e, label: e })),
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <Select size="sm" aria-label={`Model ${flow} ${phase} ${runtime}`} value={cell.model ?? ""}
        style={{ minWidth: 150 }} options={modelOptions}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          const model = e.target.value || null;
          // Cermin picker Start: menukar model menurunkan effort yang tak didukung model baru SEKARANG.
          onPick({ model, effort: model && cell.effort ? coerce(model, cell.effort) : cell.effort },
            `${phase} (${runtime}) → ${model ?? "warisi"}`);
        }} />
      <Select size="sm" aria-label={`Effort ${flow} ${phase} ${runtime}`} value={cell.effort ?? ""}
        style={{ minWidth: 96 }} options={effortOptions}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          onPick({ ...cell, effort: e.target.value || null }, `${phase} (${runtime}) effort → ${e.target.value || "warisi"}`)} />
    </div>
  );
}

export function OrchestrationPanel({ orchestration, onChange }: {
  orchestration: Orchestration | undefined;
  onChange: (next: Orchestration, msg: string) => void;
}) {
  const orch = orchestration ?? ORCHESTRATION_DEFAULTS;
  const flowOf = (flow: OrchestrationFlow): FlowOrchestration => orch[flow] ?? ORCHESTRATION_DEFAULTS[flow];
  const putFlow = (flow: OrchestrationFlow, next: FlowOrchestration, msg: string) =>
    onChange({ ...orch, [flow]: next }, msg);
  return (
    <>
      <Card eyebrow="orkestrasi" title="Orkestrasi subagent per fase">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Sesi utama menjadi <b>orchestrator</b>; setiap fase dikerjakan subagent dengan model &amp; effort di
          bawah. <b>Warisi</b> memakai model/effort orchestrator yang dipilih saat <b>Start</b>. Subagent selalu
          berjalan di runtime orchestrator: sesi claude memakai kolom Claude Code, sesi codex kolom Codex CLI.
          Flow yang dimatikan berjalan sebagai sesi tunggal seperti sebelumnya.
        </div>
      </Card>
      {ORCHESTRATION_FLOWS.map((flow) => {
        const f = flowOf(flow);
        return (
          <div key={flow} data-testid={`orch-flow-${flow}`}>
            <Card eyebrow="flow" title={FLOW_LABEL[flow]}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {f.enabled ? "Fase dikerjakan subagent" : "Sesi tunggal (orkestrasi mati)"}
                </span>
                <Switch checked={f.enabled} aria-label={`Orkestrasi ${flow}`}
                  onChange={(v: boolean) => putFlow(flow, { ...f, enabled: v },
                    `Orkestrasi ${FLOW_LABEL[flow]} · ${v ? "aktif" : "nonaktif"}`)} />
              </div>
              {EXECUTE_MODE_FLOWS.has(flow) && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10, opacity: f.enabled ? 1 : 0.55 }}>
                  <span style={{ fontSize: 12.5, color: "var(--text-strong)", fontWeight: 600 }}>Mode Execute</span>
                  <Select size="sm" aria-label={`Mode Execute ${flow}`} value={f.executeMode ?? "inline"}
                    style={{ minWidth: 260, maxWidth: "100%" }} options={EXECUTE_MODE_OPTIONS}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      const mode = e.target.value === "subagent" ? "subagent" : "inline";
                      putFlow(flow, { ...f, executeMode: mode },
                        `Mode Execute ${FLOW_LABEL[flow]} · ${mode === "subagent" ? "subagent per task" : "inline"}`);
                    }} />
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>khusus sesi Claude · Codex selalu inline</span>
                </div>
              )}
              <div style={{ overflowX: "auto", opacity: f.enabled ? 1 : 0.55 }}>
                <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...CELL, borderTop: "none", textAlign: "left" }}>Fase</th>
                      {RUNTIMES.map((rt) => (
                        <th key={rt.id} style={{ ...CELL, borderTop: "none", textAlign: "left" }}>{rt.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FLOW_PHASES[flow].map((phase) => (
                      <tr key={phase}>
                        <td style={CELL}>{phase}</td>
                        {RUNTIMES.map((rt) => (
                          <td key={rt.id} style={CELL}>
                            <CellPicker flow={flow} phase={phase} runtime={rt.id} cell={f[rt.id][phase] ?? EMPTY_CELL}
                              onPick={(cell, msg) => putFlow(flow, { ...f, [rt.id]: { ...f[rt.id], [phase]: cell } }, msg)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      })}
    </>
  );
}
