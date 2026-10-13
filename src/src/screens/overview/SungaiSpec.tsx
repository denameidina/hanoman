import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { fmtDuration } from "./format";

// Lebar arus (unit SVG) sebanding jumlahnya; minimal 4 agar arus nol tetap terbaca sebagai sungai kering.
const width = (n: number, max: number) => 4 + (max > 0 ? (n / max) * 36 : 0);

export function SungaiSpec({ overview }: { overview: OverviewDTO | null; now: number }) {
  const r = overview?.river ?? null;
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-river">
      <h3 id="ovk-river" className="hn-ovk-kicker">Sungai spec</h3>
      {!r ? <p className="hn-ov-meta">Belum ada data spec.</p> : (() => {
        const max = Math.max(r.created, r.started, r.landed);
        const [a, b, c] = [width(r.created, max), width(r.started, max), width(r.landed, max)];
        const y = 26;
        const d = `M0,${y - a / 2} C40,${y - a / 2} 40,${y - b / 2} 80,${y - b / 2} C120,${y - b / 2} 120,${y - c / 2} 160,${y - c / 2}`
          + ` L160,${y + c / 2} C120,${y + c / 2} 120,${y + b / 2} 80,${y + b / 2} C40,${y + b / 2} 40,${y + a / 2} 0,${y + a / 2} Z`;
        return (
          <>
            <svg className="hn-ovk-river" viewBox="0 0 160 52" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={d} /></svg>
            <p className="hn-ovk-river-labels"><span>dibuat {r.created}</span><span>jalan {r.started}</span><span>selesai {r.landed}</span></p>
            {r.leadTimeMedMs !== null && (
              <p className="hn-ov-meta hn-ovk-mono">
                {`lead time ${fmtDuration(r.leadTimeMedMs)}${r.cycleTimeMedMs !== null ? ` · cycle ${fmtDuration(r.cycleTimeMedMs)}` : ""}`}
              </p>
            )}
          </>
        );
      })()}
    </section>
  );
}
