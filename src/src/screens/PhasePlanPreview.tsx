import React from "react";
import {
  CODEX_NATIVE_AGENTS_MIN_CLIENT, ORCHESTRATION_DEFAULTS, codexNativeAgentsSupported, resolvePhasePlan,
  coerceClaudeEffort, coerceCodexEffort, type Agent, type Orchestration, type OrchestrationFlow,
  type PhaseOverrides,
} from "@hanoman/shared";
import { modelLabel } from "./phase-chip";
import { runtimeEfforts, runtimeSubagentModels } from "./session-runtime";

// ADR-0164 · pratinjau read-only. Memanggil resolver yang SAMA dengan server (`resolvePhasePlan`),
// dengan gerbang versi codex yang sama — dua salinan aturan akan membuat pratinjau berbohong.
const NOTE: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, marginBottom: 12, color: "var(--text-muted)" };

export function PhasePlanPreview({ flow, agent, model, effort, orchestration, codexVersion, loading,
  phaseOverrides, onPhaseOverridesChange, loadError, remoteTarget,
}: {
  flow: OrchestrationFlow; agent: Agent; model: string; effort: string;
  orchestration: Orchestration | undefined; codexVersion: string | null; loading: boolean;
  phaseOverrides?: PhaseOverrides;
  onPhaseOverridesChange?: (next: PhaseOverrides) => void;
  /** S4a · GET Setting gagal: rencana TAK diketahui — tampilkan galat, jangan mengarang rencana. */
  loadError?: boolean;
  /** S4b · nama device target bila sesi lahir di device lain (SPEC-1216); null/absen = hub ini. */
  remoteTarget?: string | null;
}) {
  // ADR-0164 · gerbang muat: ketiadaan data BELUM dimuat ≠ orkestrasi mati/codex tak mendukung —
  // sama seperti `codexVer` null (tak terdeteksi) berbeda dari "belum sempat dicek" (SPEC-339).
  // Tanpa gerbang ini pratinjau sempat berbohong "sesi tunggal" sebelum respons Settings/versi tiba.
  if (loading) {
    return <div data-testid="phase-plan-preview" style={NOTE}>Memuat rencana fase…</div>;
  }
  // S4b · sesi lahir di device target dengan Setting LOCAL-only & versi codex miliknya sendiri. Tak
  // ada jalur relay baca Setting remote yang sah, jadi pratinjau hub hanya perkiraan — katakan itu.
  const remoteNote = remoteTarget ? (
    <div data-testid="phase-plan-remote-note" style={NOTE}>
      Sesi lahir di <b>{remoteTarget}</b>: rencana fase final ditentukan Setting device itu (orkestrasi,
      model &amp; effort, versi codex). Pratinjau ini memakai Setting hub ini; override fase ikut dikirim,
      tetapi bisa diabaikan device versi lama.
    </div>
  ) : null;
  if (loadError) {
    return (
      <>
        {remoteNote}
        <div data-testid="phase-plan-preview" role="alert" style={NOTE}>
          Gagal memuat Setting — rencana fase tak bisa dipratinjau. Sesi tetap memakai Setting server
          saat lahir; tutup lalu buka lagi modal ini untuk mencoba ulang.
        </div>
      </>
    );
  }
  // S4a · blok absen (respons Setting lama) = matriks bawaan, sama dengan `.default()` di server.
  const cfg = (orchestration ?? ORCHESTRATION_DEFAULTS)[flow];
  if (cfg?.enabled === false) {
    return <>{remoteNote}<div data-testid="phase-plan-preview" style={NOTE}>Orkestrasi mati untuk flow ini — sesi tunggal.</div></>;
  }
  const nativeAgents = agent === "claude" || codexNativeAgentsSupported(codexVersion);
  const plan = resolvePhasePlan({ flow, runtime: agent, orchestration, orchestrator: { model, effort },
    phaseOverrides, nativeAgents });
  if (!plan) {
    return (
      <>
        {remoteNote}
        <div data-testid="phase-plan-preview" style={NOTE}>
          Codex CLI {codexVersion ?? "tak terdeteksi"} belum mendukung subagent native (butuh ≥
          {" "}{CODEX_NATIVE_AGENTS_MIN_CLIENT}) — sesi tunggal.
        </div>
      </>
    );
  }
  return (
    <>
    {remoteNote}
    <div data-testid="phase-plan-preview" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fase — dikerjakan subagent</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>
        {plan.phases.map((p) => {
          const cell = cfg?.[agent]?.[p.phase];
          const override = phaseOverrides?.[p.phase];
          const modelInherited = !cell?.model;
          const effortInherited = !cell?.effort;
          // Tanda per bagian: sel bisa diisi separuh (model tanpa effort atau sebaliknya) — tandai
          // bagian yang benar-benar mewarisi orchestrator, bukan seluruh sel sekaligus.
          const suffix = override?.model || override?.effort ? " (override sesi)"
            : modelInherited && effortInherited ? " (warisi)"
            : modelInherited ? " (model warisi)"
            : effortInherited ? " (effort warisi)" : "";
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
                  <select aria-label={`Model subagent ${p.phase}`} value={override?.model ?? ""}
                    onChange={(e) => updateOverride("model", e.target.value)} style={controlStyle}>
                    <option value="">Warisi rekomendasi</option>
                    {runtimeSubagentModels(agent).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <select aria-label={`Effort subagent ${p.phase}`} value={override?.effort ?? ""}
                    onChange={(e) => updateOverride("effort", e.target.value)} style={controlStyle}>
                    <option value="">Warisi rekomendasi</option>
                    {runtimeEfforts(agent, p.model).map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
    </>
  );
}

const controlStyle: React.CSSProperties = {
  width: "100%", minWidth: 0, height: 30, padding: "0 6px", borderRadius: 6,
  border: "1px solid var(--border-hair)", background: "var(--surface-card)",
  color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-ui)",
};
