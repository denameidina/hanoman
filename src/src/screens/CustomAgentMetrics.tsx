import type { AgentMetricsView } from "@hanoman/shared";
import { Badge } from "../ds";

const durationText = (value: number | null): string => value === null ? "—"
  : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} dtk`;
const tokenText = (value: number | null | undefined): string =>
  value == null ? "—" : value.toLocaleString("id-ID");

export function CustomAgentMetrics({ name, metrics }: { name: string; metrics: AgentMetricsView | null }) {
  const metric = metrics?.agents.find((entry) => entry.agentName === name);
  const variants = (metrics?.variants ?? []).filter((entry) => entry.agentName === name);
  const evaluated = metric?.evaluatedCount ?? (metric ? metric.invocationCount - metric.dispositions.pending : 0);
  return <>
    <div data-testid={`metrics-${name}`} style={{
      display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10,
      paddingTop: 9, borderTop: "1px solid var(--border-hair)",
      fontSize: "var(--text-xs)", color: "var(--text-subtle)",
    }}>
      <span>{metrics ? metric?.invocationCount ?? 0 : "—"} invocation tercatat · 30 hari</span>
      <span>Durasi median: {durationText(metric?.medianDurationMs ?? null)}</span>
      <span>Token masuk: {tokenText(metric?.inputTokens)} · keluar: {tokenText(metric?.outputTokens)} · cache: {tokenText(metric?.cachedTokens)}</span>
      <span data-testid={`precision-${name}`} title="Hasil diterima atau parsial dibagi seluruh hasil yang dinilai; bukan akurasi menemukan semua bug.">
        Diterima/parsial: {metric?.operationalPrecision == null
          ? "—" : `${Math.round(metric.operationalPrecision * 100)}%`}
        {` · ${evaluated} dinilai · ${metric?.dispositions.pending ?? 0} belum dinilai`}
      </span>
      {metric && <span>
        Diterima {metric.dispositions.accepted} · Parsial {metric.dispositions.partial}
        {" · "}Ditolak {metric.dispositions.rejected} · False-positive {metric.dispositions.falsePositive}
      </span>}
      {metric?.rework && <span>Perlu kerja ulang: {metric.rework.required}
        {` · tidak perlu: ${metric.rework.notRequired} · belum dinilai: ${metric.rework.unknown}`}</span>}
      {metric?.workspaceChanged && <Badge tone="err" size="sm">workspace berubah</Badge>}
    </div>
    {variants.length > 0 && <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer", fontSize: "var(--text-xs)" }}>Bukti menurut runtime, model, dan versi instruksi</summary>
      <ul style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", paddingLeft: 20 }}>
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
