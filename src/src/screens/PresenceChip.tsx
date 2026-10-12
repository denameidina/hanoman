import React from "react";
import { Badge } from "../ds";

/* SPEC-919 · ADR-0147 · penanda "sedang dikerjakan di <perangkat>". Satu komponen untuk baris
   backlog, kartu board, dan baris project: tiga salinan berarti tiga tempat yang bisa berbeda
   menjawab pertanyaan yang sama.

   Arti chip harus terbaca tanpa hover (audit UI/UX 2026-10): teks yang tampak menyebut perangkatnya,
   dan kalimat penjelas hanya untuk pembaca layar. `title` tetap ada sebagai tambahan, bukan satu-
   satunya tempat arti itu berada.

   Daftar nama kosong/undefined merender NOL elemen — itulah ujung terakhir gerbang requirement 7:
   instance yang `presence.enabled`-nya mati menghasilkan peta kosong, jadi tak ada satu pun chip. */
export function PresenceChip({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return (
    <Badge data-testid="presence-chip" size="sm" tone="ok" icon="monitor"
      title="Ada sesi agen yang sedang berjalan untuk item ini">
      <span>dikerjakan di {names.join(", ")}</span>
      <span className="hn-sr-only"> — ada sesi agen yang sedang berjalan untuk item ini</span>
    </Badge>
  );
}
