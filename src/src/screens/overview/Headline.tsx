import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { Skeleton } from "../../ds";

export function Headline({ overview }: { overview: OverviewDTO | null }) {
  if (!overview) return <p className="hn-ovk-headline"><Skeleton width="70%" /></p>;
  return (
    <p className="hn-ovk-headline">
      {overview.headline.parts.map((p, i) => p.tone
        ? <span key={i} className={`hn-ovk-tone--${p.tone}`}>{p.text}</span>
        : <React.Fragment key={i}>{p.text}</React.Fragment>)}
    </p>
  );
}
