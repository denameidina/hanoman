import React from "react";
import { fmtClock, longDate } from "./format";

export function Masthead({ now, projectCount }: { now: number; projectCount: number }) {
  return (
    <header className="hn-ovk-masthead">
      <p className="hn-ovk-title">Kabar Hanoman</p>
      <div className="hn-ovk-dateline">
        <span>{longDate(now)}</span>
        <span>Edisi langsung · {fmtClock(now)}</span>
        <span>{projectCount} project</span>
      </div>
    </header>
  );
}
