import React from "react";
import type { OverviewDTO } from "@hanoman/shared";

const SHORT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const shortDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return SHORT.format(new Date(y!, m! - 1, d!)).replace(".", "");
};

export function Rekor({ overview }: { overview: OverviewDTO | null; now: number }) {
  const r = overview?.records ?? null;
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-rekor">
      <h3 id="ovk-rekor" className="hn-ovk-kicker">Rekor</h3>
      {!r ? <p className="hn-ov-meta">Belum ada riwayat sesi.</p> : (
        <>
          <p className="hn-ovk-lede">{r.streakDays} hari tanpa sesi tumbang</p>
          <p className="hn-ov-meta">
            {[`rekor ${r.bestStreak} hari`, r.bestLandedDay && `terbanyak ${r.bestLandedDay.count} spec (${shortDate(r.bestLandedDay.date)})`]
              .filter(Boolean).join(" · ")}
          </p>
          {r.landedRecordToday && <p className="hn-ovk-tone--good">Rekor baru hari ini.</p>}
        </>
      )}
    </section>
  );
}
