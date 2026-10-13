import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { Delta } from "./Delta";
import { fmtTokens } from "./format";

export function EkonomiToken({ overview }: { overview: OverviewDTO | null; now: number }) {
  const t = overview?.tokens ?? null;
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-token">
      <h3 id="ovk-token" className="hn-ovk-kicker">Ekonomi token</h3>
      {!t || t.total === 0 ? <p className="hn-ov-meta">Belum ada agen tercatat hari ini.</p> : (
        <>
          <p className="hn-ovk-figure"><span className="hn-ovk-big">{fmtTokens(t.total)}</span>
            {t.cacheHitPct !== null && <span className="hn-ovk-tone--good">cache {t.cacheHitPct}%</span>}</p>
          <Delta now={t.total} prev={t.yesterdayTotal} goodWhen="neutral" format={fmtTokens} />
          {t.perLanded !== null && <p className="hn-ov-meta hn-ovk-mono">{fmtTokens(t.perLanded)} per spec mendarat</p>}
          {t.topAgent && <p className="hn-ov-meta hn-ovk-mono">paling boros: {t.topAgent.name}</p>}
          <p className="hn-ov-meta">token agen tercatat</p>
        </>
      )}
    </section>
  );
}
