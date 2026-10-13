import React from "react";
import type { OverviewBensin, OverviewDTO } from "@hanoman/shared";
import { Tabs } from "../../ds";
import { fmtClock } from "./format";

function verdictText(b: OverviewBensin): string {
  if (b.verdict === "habis" && b.exhaustAt) return `habis ±${fmtClock(b.exhaustAt)}`;
  if (b.verdict === "aman") return "aman sampai reset";
  if (b.verdict === "stabil") return "laju stabil";
  return "mengumpulkan data…";
}

// Garis sampel 60 menit terakhir; bila habis, garis putus-putus memproyeksikan ke 100% di exhaustAt.
function Spark({ b }: { b: OverviewBensin }) {
  if (b.samples.length < 2) return null;
  const pts = b.samples.map((p) => ({ x: Date.parse(p.at), y: p.pct }));
  const end = b.exhaustAt ? Date.parse(b.exhaustAt) : pts.at(-1)!.x;
  const x0 = pts[0]!.x;
  const span = Math.max(1, end - x0);
  const sx = (x: number) => ((x - x0) / span) * 140;
  const sy = (y: number) => 40 - (y / 100) * 38;
  const line = pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const last = pts.at(-1)!;
  return (
    <svg className="hn-ovk-spark" viewBox="0 0 140 42" aria-hidden="true" focusable="false">
      <line className="hn-ovk-spark-limit" x1="0" y1={sy(100)} x2="140" y2={sy(100)} />
      <polyline points={line} />
      {b.exhaustAt && <line className="hn-ovk-spark-proj" x1={sx(last.x)} y1={sy(last.y)} x2="140" y2={sy(100)} />}
    </svg>
  );
}

export function Bensin({ overview }: { overview: OverviewDTO | null; now: number }) {
  const all = overview?.bensin ?? [];
  const hasCodex = all.some((b) => b.source === "codex");
  const [tab, setTab] = React.useState<"claude" | "codex">("claude");
  const src = hasCodex ? tab : "claude";
  const list = all.filter((b) => b.source === src);
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-bensin">
      <h3 id="ovk-bensin" className="hn-ovk-kicker">Bensin</h3>
      {hasCodex && (
        <Tabs aria-label="Sumber limit" value={src}
          tabs={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }]}
          onChange={(v) => setTab(v === "codex" ? "codex" : "claude")} />
      )}
      {list.length === 0 ? <p className="hn-ov-meta">Belum ada data limit.</p> : list.map((b) => (
        <div key={`${b.source}:${b.key}`} className="hn-ovk-bensin">
          <p className="hn-ov-meta">{b.label}</p>
          <p className="hn-ovk-figure"><span className="hn-ovk-big">{b.usedPct}%</span>
            <span className={`hn-ovk-pill${b.verdict === "habis" ? " hn-ovk-pill--bad" : ""}`}>{verdictText(b)}</span></p>
          <Spark b={b} />
          {b.resetsAt && <p className="hn-ov-meta">reset {fmtClock(b.resetsAt)}</p>}
        </div>
      ))}
    </section>
  );
}
