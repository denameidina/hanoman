import React from "react";

/** ↑/↓ vs kemarin. `goodWhen` menentukan arah yang diwarnai baik; "neutral" tak diwarnai.
 *  `format` opsional untuk angka besar (mis. token) supaya selisihnya terbaca, bukan angka mentah. */
export function Delta({ now, prev, goodWhen, format }: {
  now: number; prev: number; goodWhen: "up" | "down" | "neutral"; format?: (n: number) => string;
}) {
  const diff = now - prev;
  if (diff === 0) return <span className="hn-ovk-delta">= kemarin</span>;
  const up = diff > 0;
  const tone = goodWhen === "neutral" ? "" : (up === (goodWhen === "up") ? " hn-ovk-tone--good" : " hn-ovk-tone--bad");
  return <span className={`hn-ovk-delta${tone}`}>{up ? "↑" : "↓"}{format ? format(Math.abs(diff)) : Math.abs(diff)} vs kemarin</span>;
}
