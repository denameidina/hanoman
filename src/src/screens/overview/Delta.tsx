import React from "react";

/** ↑/↓ vs kemarin. `goodWhen` menentukan arah yang diwarnai baik; "neutral" tak diwarnai. */
export function Delta({ now, prev, goodWhen }: { now: number; prev: number; goodWhen: "up" | "down" | "neutral" }) {
  const diff = now - prev;
  if (diff === 0) return <span className="hn-ovk-delta">= kemarin</span>;
  const up = diff > 0;
  const tone = goodWhen === "neutral" ? "" : (up === (goodWhen === "up") ? " hn-ovk-tone--good" : " hn-ovk-tone--bad");
  return <span className={`hn-ovk-delta${tone}`}>{up ? "↑" : "↓"}{Math.abs(diff)} vs kemarin</span>;
}
