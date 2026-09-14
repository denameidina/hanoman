import React from "react";
import {
  CODEX_NATIVE_AGENTS_MIN_CLIENT, codexNativeAgentsSupported, resolvePhasePlan,
  type Agent, type Orchestration, type OrchestrationFlow,
} from "@hanoman/shared";
import { modelLabel } from "./phase-chip";

// ADR-0164 · pratinjau read-only. Memanggil resolver yang SAMA dengan server (`resolvePhasePlan`),
// dengan gerbang versi codex yang sama — dua salinan aturan akan membuat pratinjau berbohong.
const NOTE: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, marginBottom: 12, color: "var(--text-muted)" };

export function PhasePlanPreview({ flow, agent, model, effort, orchestration, codexVersion, loading }: {
  flow: OrchestrationFlow; agent: Agent; model: string; effort: string;
  orchestration: Orchestration | undefined; codexVersion: string | null; loading: boolean;
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
          const modelInherited = !cell?.model;
          const effortInherited = !cell?.effort;
          // Tanda per bagian: sel bisa diisi separuh (model tanpa effort atau sebaliknya) — tandai
          // bagian yang benar-benar mewarisi orchestrator, bukan seluruh sel sekaligus.
          const suffix = modelInherited && effortInherited ? " (warisi)"
            : modelInherited ? " (model warisi)"
            : effortInherited ? " (effort warisi)" : "";
          return (
            <li key={p.phase} style={{ overflowWrap: "anywhere" }}>
              {p.phase} · {modelLabel(p.model)} · {p.effort}{suffix}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
