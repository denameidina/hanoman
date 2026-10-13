import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { fmtMinutes } from "./format";

const SHORT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const label = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return SHORT.format(new Date(y!, m! - 1, d!)).replace(".", "");
};
// Lima tingkat intensitas brass; sel kosong tingkat 0.
const level = (min: number, max: number) => (min <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((min / max) * 4)));

export function PetaPanas({ overview }: { overview: OverviewDTO | null; now: number }) {
  const h = overview?.heatmap ?? null;
  return (
    <section className="hn-ovk-panel hn-ovk-heatwrap" aria-labelledby="ovk-heat">
      <h3 id="ovk-heat" className="hn-ovk-kicker">Jam kerja agen</h3>
      {!h ? <p className="hn-ov-meta">Belum ada riwayat sesi.</p> : (() => {
        const max = Math.max(0, ...h.minutes.flat());
        const total = h.minutes.flat().reduce((a, b) => a + b, 0);
        return (
          <div className="hn-ovk-heat" role="img" aria-label={`Jam kerja agen 7 hari: total ${fmtMinutes(total)}`}>
            {h.days.map((day, di) => (
              <React.Fragment key={day}>
                <span className="hn-ovk-heat-day" aria-hidden="true">{label(day)}</span>
                {h.minutes[di]!.map((m, hr) => (
                  <span key={hr} className={`hn-ovk-heat-cell hn-ovk-heat-cell--${level(m, max)}`}
                    title={m > 0 ? `Sel ${label(day)} ${String(hr).padStart(2, "0")}.00 · ${fmtMinutes(m)}` : undefined} />
                ))}
              </React.Fragment>
            ))}
          </div>
        );
      })()}
    </section>
  );
}
