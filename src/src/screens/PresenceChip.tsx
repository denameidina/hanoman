import React from "react";
import { Badge } from "../ds";

/* SPEC-919 · ADR-0147 · penanda "sedang dikerjakan di <device>". Satu komponen untuk baris
   backlog, kartu board, dan baris project: tiga salinan berarti tiga tempat yang bisa berbeda
   menjawab pertanyaan yang sama.

   Daftar nama kosong/undefined merender NOL elemen — itulah ujung terakhir gerbang requirement 7:
   instance yang `presence.enabled`-nya mati menghasilkan peta kosong, jadi tak ada satu pun chip. */
export function PresenceChip({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return (
    <Badge data-testid="presence-chip" size="sm" tone="ok" icon="monitor"
      title="Ada sesi agen yang hidup untuk item ini">
      dikerjakan di {names.join(", ")}
    </Badge>
  );
}
