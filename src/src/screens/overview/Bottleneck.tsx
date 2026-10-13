import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { ProgressBar } from "../../ds";
import { Delta } from "./Delta";
import { fmtClock } from "./format";

const startOfToday = (now: number) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

export function Bottleneck({ overview, now }: { overview: OverviewDTO | null; now: number }) {
  const w = overview?.wait ?? null;
  const since = overview ? Date.parse(overview.recordingSince) : Number.NaN;
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-wait">
      <h3 id="ovk-wait" className="hn-ovk-kicker">Kamu bottleneck-nya?</h3>
      {!w ? <p className="hn-ov-meta">Belum ada data menunggu.</p> : (
        <>
          <p className="hn-ovk-figure"><span className="hn-ovk-big">{w.todayMin}</span><span className="hn-ovk-unit">menit</span>
            <Delta now={w.todayMin} prev={w.yesterdayMin} goodWhen="down" /></p>
          {w.pctOfLive !== null && (
            <>
              <ProgressBar value={w.pctOfLive} tone="err" size="sm" aria-label="Porsi waktu agen menunggu" valueText={`${w.pctOfLive}%`} />
              <p className="hn-ov-meta">{w.pctOfLive}% waktu agen hari ini menganggur menunggu jawaban</p>
            </>
          )}
          {since > startOfToday(now) && <p className="hn-ov-meta">tercatat sejak {fmtClock(since)}</p>}
        </>
      )}
    </section>
  );
}
