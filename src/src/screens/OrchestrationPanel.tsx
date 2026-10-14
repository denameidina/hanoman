import React from "react";
import { Card, LocalOverflow, Select, Switch } from "../ds";
import {
  EXECUTE_MODE_FLOWS, FLOW_PHASES, ORCHESTRATION_DEFAULTS, ORCHESTRATION_FLOWS, coerceClaudeEffort, coerceCodexEffort,
  ANTIGRAVITY_CHILD_TIERS, type Agent, type FlowOrchestration, type Orchestration, type OrchestrationFlow, type PhaseCell,
} from "@hanoman/shared";
import { runtimeEfforts, runtimeSubagentModels } from "./session-runtime";
import { FLOW_LABEL, RUNTIME_LABEL } from "../lib/labels";
import "./styles/scheduler.css";

// ADR-0164 · matriks model/effort per fase. Satu-satunya penulis `Setting.orchestration` adalah tab
// ini, jadi menulis dari snapshot mount aman (berbeda dari baca-ulang lead/telegram).
// Katalog dibaca lewat `session-runtime.ts` — sumber yang sama dengan picker Start.

// Diekspor: layar Scheduler memakai nama flow yang sama dengan matriks ini (satu istilah baku dari lib/labels.ts).
export { FLOW_LABEL };
const RUNTIMES: { id: Agent; label: string }[] = [
  { id: "claude", label: RUNTIME_LABEL.claude }, { id: "codex", label: RUNTIME_LABEL.codex },
  { id: "antigravity", label: RUNTIME_LABEL.antigravity },
];
// Amandemen ADR-0170 P2 · cara fase Execute/Goal (sesi Claude) mengerjakan plan.
const EXECUTE_MODE_OPTIONS = [
  { value: "inline", label: "Inline — agen fase mengerjakan task sendiri (cepat)" },
  { value: "subagent", label: "Subagen per task — implementer + review tiap task (lebih lambat)" },
];
const EMPTY_CELL: PhaseCell = { model: null, effort: null };

function CellPicker({ flow, phase, runtime, cell, disabled, onPick }: {
  flow: OrchestrationFlow; phase: string; runtime: Agent; cell: PhaseCell; disabled: boolean;
  onPick: (next: PhaseCell, msg: string) => void;
}) {
  const nativeTier = runtime === "antigravity";
  const models = runtimeSubagentModels(runtime);
  const efforts = runtimeEfforts(runtime, cell.model ?? "");
  const coerce = runtime === "codex" ? coerceCodexEffort : coerceClaudeEffort;
  const modelOptions = nativeTier ? ANTIGRAVITY_CHILD_TIERS.map((value) => ({ value, label: value })) : [
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
    <div className="hn-sched-picks">
      <Select size="sm" aria-label={`Model ${flow} ${phase} ${runtime}`} value={cell.model ?? (nativeTier ? "inherit" : "")}
        className="hn-sched-pick-model" options={modelOptions} disabled={disabled}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          const model = e.target.value || null;
          // Cermin picker Start: menukar model menurunkan effort yang tak didukung model baru SEKARANG.
          onPick({ model, effort: nativeTier ? null : model && cell.effort ? coerce(model, cell.effort) : cell.effort },
            `${phase} (${runtime}) → ${model ?? "warisi"}`);
        }} />
      <Select size="sm" aria-label={`Effort ${flow} ${phase} ${runtime}`} value={cell.effort ?? ""}
        className="hn-sched-pick-effort" options={nativeTier ? [{ value: "", label: "Tidak tersedia · effort native tidak diketahui" }] : effortOptions} disabled={disabled || nativeTier}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          onPick({ ...cell, effort: e.target.value || null }, `${phase} (${runtime}) effort → ${e.target.value || "warisi"}`)} />
      {nativeTier && <span>Effort child tidak diketahui; invoke/recall asynchronous ditunggu melalui protokol. Reviewer read-only instruksional, tanpa enforcement native.</span>}
    </div>
  );
}

type PutFlow = (flow: OrchestrationFlow, next: FlowOrchestration, msg: string) => void;

// Isi satu flow: saklar, mode Execute, dan matriks fase × runtime. Dipakai oleh kartu (Settings) dan
// baris yang bisa dibuka (hub Otonom). Kontrolnya tak berubah di kedua tampilan.
function FlowBody({ flow, f, putFlow }: { flow: OrchestrationFlow; f: FlowOrchestration; putFlow: PutFlow }) {
  return (
    <>
      <div className="hn-sched-flow-row">
        <span className="hn-sched-flow-status">
          {f.enabled ? "Fase dikerjakan subagen" : "Satu sesi biasa (subagen nonaktif)"}
        </span>
        <Switch checked={f.enabled} aria-label={`Orkestrasi ${flow}`}
          onChange={(v: boolean) => putFlow(flow, { ...f, enabled: v },
            `Orkestrasi ${FLOW_LABEL[flow]} · ${v ? "aktif" : "nonaktif"}`)} />
      </div>
      {EXECUTE_MODE_FLOWS.has(flow) && (
        <div className="hn-sched-flow-mode">
          <span className="hn-sched-flow-mode-label">Cara mengerjakan rencana</span>
          <Select size="sm" aria-label={`Mode Execute ${flow}`} value={f.executeMode ?? "inline"}
            className="hn-sched-flow-mode-select" options={EXECUTE_MODE_OPTIONS} disabled={!f.enabled}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const mode = e.target.value === "subagent" ? "subagent" : "inline";
              putFlow(flow, { ...f, executeMode: mode },
                `Mode Execute ${FLOW_LABEL[flow]} · ${mode === "subagent" ? "subagen per task" : "inline"}`);
            }} />
          <span className="hn-sched-flow-mode-note">khusus sesi Claude · Codex dan Antigravity selalu inline</span>
        </div>
      )}
      {/* Kontrol flow yang dimatikan benar-benar `disabled` (tak bisa difokus atau diubah), bukan
          hanya diredupkan; kolom tabel yang lebih lebar dari layar digulir di dalam wadahnya. */}
      <LocalOverflow>
        <table className="hn-sched-matrix">
          <thead>
            <tr>
              <th>Fase</th>
              {RUNTIMES.map((rt) => (
                <th key={rt.id}>{rt.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FLOW_PHASES[flow].map((phase) => (
              <tr key={phase}>
                <td>{phase}</td>
                {RUNTIMES.map((rt) => (
                  <td key={rt.id}>
                    <CellPicker flow={flow} phase={phase} runtime={rt.id} cell={f[rt.id][phase] ?? EMPTY_CELL}
                      disabled={!f.enabled}
                      onPick={(cell, msg) => putFlow(flow, { ...f, [rt.id]: { ...f[rt.id], [phase]: cell } }, msg)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </LocalOverflow>
    </>
  );
}

// Satu flow sebagai baris yang bisa dibuka. Tertutup secara default: progressive disclosure, dan
// keadaan aktif/nonaktif tetap terbaca di barisnya tanpa membuka.
function FlowAccordion({ flow, f, putFlow }: { flow: OrchestrationFlow; f: FlowOrchestration; putFlow: PutFlow }) {
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  return (
    <div className="hn-sched-flow" data-testid={`orch-flow-${flow}`}>
      <button type="button" className="hn-sched-flow-head hn-touch-target" aria-expanded={open} aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}>
        <span>{FLOW_LABEL[flow]}</span>
        <span className="hn-sched-flow-state">{f.enabled ? "aktif" : "nonaktif"}</span>
      </button>
      <div id={bodyId} className="hn-sched-flow-body" hidden={!open}>
        <FlowBody flow={flow} f={f} putFlow={putFlow} />
      </div>
    </div>
  );
}

/**
 * Matriks orkestrasi. `cards` (default, dipakai Settings): satu kartu per flow. `accordion` (hub
 * Otonom · Setelan): satu baris per flow yang bisa dibuka. Keduanya menulis lewat `onChange` yang sama.
 */
export function OrchestrationPanel({ orchestration, onChange, variant = "cards" }: {
  orchestration: Orchestration | undefined;
  onChange: (next: Orchestration, msg: string) => void;
  variant?: "cards" | "accordion";
}) {
  const orch = orchestration ?? ORCHESTRATION_DEFAULTS;
  const flowOf = (flow: OrchestrationFlow): FlowOrchestration => orch[flow] ?? ORCHESTRATION_DEFAULTS[flow];
  const putFlow: PutFlow = (flow, next, msg) => onChange({ ...orch, [flow]: next }, msg);
  const intro = (
    <div className="hn-sched-group-hint">
      Sesi utama berperan sebagai <b>pengatur</b>; setiap fase dikerjakan subagen dengan model &amp; effort di
      bawah. <b>Warisi</b> memakai pengaturan sesi utama yang dipilih saat <b>Start</b>. Subagen selalu berjalan di
      runtime yang sama dengan sesi utama: sesi Claude memakai kolom Claude Code, sesi Codex kolom Codex CLI, sesi Antigravity kolom Antigravity CLI.
      Flow yang dimatikan berjalan sebagai satu sesi biasa seperti sebelumnya.
    </div>
  );
  if (variant === "accordion") {
    return (
      <div className="hn-sched-panel">
        {intro}
        {ORCHESTRATION_FLOWS.map((flow) => (
          <FlowAccordion key={flow} flow={flow} f={flowOf(flow)} putFlow={putFlow} />
        ))}
      </div>
    );
  }
  return (
    <>
      <Card eyebrow="orkestrasi" title="Orkestrasi subagen per fase">
        {intro}
      </Card>
      {ORCHESTRATION_FLOWS.map((flow) => (
        <div key={flow} data-testid={`orch-flow-${flow}`}>
          <Card eyebrow="flow" title={FLOW_LABEL[flow]}>
            <FlowBody flow={flow} f={flowOf(flow)} putFlow={putFlow} />
          </Card>
        </div>
      ))}
    </>
  );
}
