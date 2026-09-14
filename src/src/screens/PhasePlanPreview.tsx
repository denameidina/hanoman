import React from "react";
import {
  CODEX_NATIVE_AGENTS_MIN_CLIENT, codexNativeAgentsSupported, resolvePhasePlan,
  type Agent, type Orchestration, type OrchestrationFlow,
} from "@hanoman/shared";
import { modelLabel } from "./phase-chip";

// ADR-0164 · pratinjau read-only. Memanggil resolver yang SAMA dengan server (`resolvePhasePlan`),
// dengan gerbang versi codex yang sama — dua salinan aturan akan membuat pratinjau berbohong.
const NOTE: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, marginBottom: 12, color: "var(--text-muted)" };

export function PhasePlanPreview({ flow, agent, model, effort, orchestration, codexVersion }: {
  flow: OrchestrationFlow; agent: Agent; model: string; effort: string;
  orchestration: Orchestration | undefined; codexVersion: string | null;
}) {
  const cfg = orchestration?.[flow];
  if (cfg?.enabled === false) {
    return <div data-testid="phase-plan-preview" style={NOTE}>Orkestrasi mati untuk flow ini — sesi tunggal.</div>;
  }
  const nativeAgents = agent === "claude" || codexNativeAgentsSupported(codexVersion);
  const plan = resolvePhasePlan({ flow, runtime: agent, orchestration, orchestrator: { model, effort }, nativeAgents });
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
          const inherited = !cell?.model && !cell?.effort;
          return (
            <li key={p.phase} style={{ overflowWrap: "anywhere" }}>
              {p.phase} · {modelLabel(p.model)} · {p.effort}{inherited ? " (warisi)" : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
