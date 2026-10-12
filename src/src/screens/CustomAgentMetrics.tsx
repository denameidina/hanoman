import type React from "react";
import type { AgentMetricsView } from "@hanoman/shared";
import { Badge } from "../ds";
import "./styles/skills.css";

const durationText = (value: number | null): string => value === null ? "—"
  : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} dtk`;
const tokenText = (value: number | null | undefined): string =>
  value == null ? "—" : value.toLocaleString("id-ID");

/** Angka + keterangan yang terlihat di bawahnya, supaya arti metrik tak bergantung pada hover. */
function Stat({ caption, testId, children }: { caption: string; testId?: string; children: React.ReactNode }) {
  return (
    <span data-testid={testId} className="hn-agent-stat">
      <span>{children}</span>
      <span className="hn-agent-stat-caption">{caption}</span>
    </span>
  );
}

export function CustomAgentMetrics({ name, metrics }: { name: string; metrics: AgentMetricsView | null }) {
  const metric = metrics?.agents.find((entry) => entry.agentName === name);
  const variants = (metrics?.variants ?? []).filter((entry) => entry.agentName === name);
  const evaluated = metric?.evaluatedCount ?? (metric ? metric.invocationCount - metric.dispositions.pending : 0);
  return <>
    <div data-testid={`metrics-${name}`} className="hn-agent-metrics">
      <Stat caption="Jumlah pemanggilan agen ini yang terekam dalam 30 hari terakhir.">
        {metrics ? metric?.invocationCount ?? 0 : "—"} invocation tercatat · 30 hari
      </Stat>
      <Stat caption="Separuh pemanggilan selesai lebih cepat dari angka ini.">
        Durasi median: {durationText(metric?.medianDurationMs ?? null)}
      </Stat>
      <Stat caption="Token yang dibaca agen, yang ditulisnya, dan yang dilayani dari cache; dihitung terpisah.">
        Token masuk: {tokenText(metric?.inputTokens)} · keluar: {tokenText(metric?.outputTokens)} · cache: {tokenText(metric?.cachedTokens)}
      </Stat>
      <Stat testId={`precision-${name}`} caption="Hasil diterima atau parsial dibagi seluruh hasil yang dinilai; bukan akurasi menemukan semua bug.">
        Diterima/parsial: {metric?.operationalPrecision == null
          ? "—" : `${Math.round(metric.operationalPrecision * 100)}%`}
        {` · ${evaluated} dinilai · ${metric?.dispositions.pending ?? 0} belum dinilai`}
      </Stat>
      {metric && <span className="hn-agent-stat-line">
        Diterima {metric.dispositions.accepted} · Parsial {metric.dispositions.partial}
        {" · "}Ditolak {metric.dispositions.rejected} · False-positive {metric.dispositions.falsePositive}
      </span>}
      {metric?.rework && <span className="hn-agent-stat-line">Perlu kerja ulang: {metric.rework.required}
        {` · tidak perlu: ${metric.rework.notRequired} · belum dinilai: ${metric.rework.unknown}`}</span>}
      {metric?.workspaceChanged && <Badge tone="err" size="sm">workspace berubah</Badge>}
    </div>
    {variants.length > 0 && <details className="hn-agent-variants">
      <summary>Bukti menurut runtime, model, dan versi instruksi</summary>
      <ul>
        {variants.map((entry) => <li key={JSON.stringify([entry.runtime, entry.model, entry.definitionHash])}>
          {entry.runtime} · {entry.model ?? "model tidak tercatat"}
          {" · "}<span title={entry.definitionHash ?? "Definisi historis tidak diketahui"}>
            {entry.definitionHash?.slice(0, 12) ?? "versi tidak tercatat"}
          </span>
          {` · ${entry.invocationCount} invocation · ${entry.evaluatedCount} dinilai`}
          {` · diterima ${entry.dispositions.accepted} · parsial ${entry.dispositions.partial}`}
          {` · false-positive ${entry.dispositions.falsePositive} · perlu kerja ulang ${entry.rework.required}`}
          {` · median ${durationText(entry.medianDurationMs)} · token masuk ${tokenText(entry.inputTokens)}`}
          {` / keluar ${tokenText(entry.outputTokens)} / cache ${tokenText(entry.cachedTokens)}`}
        </li>)}
      </ul>
    </details>}
  </>;
}
