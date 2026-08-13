import React from "react";
// Impor komponen DS langsung dari berkasnya, BUKAN dari barrel `../ds`: barrel itu
// mengekspor `Shell`, dan `Shell` mengimpor `useScrollRestore` dari modul ini — lewat
// barrel keduanya jadi lingkaran impor yang mati saat inisialisasi modul.
import { Badge } from "../ds/components/feedback";
import { Button } from "../ds/components/forms";
import { resetUiState } from "./store";

// SPEC-740 · ADR-0115 · dua syarat sekaligus dalam satu kontrol: filter yang DIPULIHKAN
// harus terlihat menyala (kalau tidak, daftar yang tampak kosong terbaca sebagai data
// kosong), dan pengguna harus punya jalan keluar dari filter lama yang tak ia sadari.
// `active` dihitung layar — hanya layar itu yang tahu default field-nya.
export function ResetViewButton({ screen, active, onReset, label = "Reset tampilan" }:
  { screen: string; active: number; onReset?: () => void; label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {active > 0 && <Badge tone="warn" size="sm" icon="filter">{active} filter aktif</Badge>}
      <Button size="sm" variant="ghost" leftIcon="rotate-ccw" disabled={active === 0}
        onClick={() => { resetUiState(screen); onReset?.(); }}>{label}</Button>
    </div>
  );
}
