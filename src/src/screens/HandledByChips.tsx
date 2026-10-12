import React from "react";
import { Badge } from "../ds";
import type { HandledByView } from "@hanoman/shared";

/* SPEC-880 · ADR-0135 · chip "ditangani oleh" — satu komponen untuk daftar DAN detail: dua salinan
   berarti dua tempat yang bisa berbeda menjawab "perangkat ini sudah dicabut atau belum".
   `list` boleh undefined: view dari instance/mock yang lebih tua tak membawanya. */
export function HandledByChips({ list, size = "sm" }:
  { list?: HandledByView[]; size?: "sm" | "md" }) {
  if (!list?.length) {
    return (
      <span data-testid="handled-by-empty"
        style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", fontFamily: "var(--font-ui)" }}>
        belum ditetapkan
      </span>
    );
  }
  return (
    // minWidth 0 + flex-wrap: chip memakan lebar yang tersedia dan MEMBUNGKUS, bukan mendorong
    // tetangganya keluar layar (pelajaran SPEC-879).
    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, minWidth: 0 }}>
      {list.map((h) => (
        <Badge key={h.deviceId} size={size} icon="monitor"
          tone={h.revoked ? "warn" : "brass"}
          title={h.revoked ? "Perangkat ini sudah dicabut aksesnya. Riwayatnya sengaja tetap disimpan." : undefined}
          data-testid={`handled-by-${h.deviceId}`}>
          {h.revoked ? `${h.name} · dicabut` : h.name}
        </Badge>
      ))}
    </span>
  );
}
