// ADR-0205 · bar tab sebuah hub, tampil di atas konten layar anak hub. Tiap tab adalah SECTION (URL)
// sendiri, jadi URL tetap sumber kebenaran: tab yang dipilih diturunkan dari `section`, dan klik tab
// hanya meminta navigasi. Tombol Kembali/Maju browser dan deep link bekerja tanpa kode tambahan.
import React from "react";
import { Tabs } from "./components/ui";
import { NavGate, NavPending } from "./shell";
import { pendingFor } from "@hanoman/shared";
import { hubOf, tabOf, tabsOf } from "../nav-hubs";

/**
 * Bar tab hub yang memuat `section`. Tak tampil bila layar bukan anak hub, atau bila hub hanya
 * punya satu tab yang tampil (mis. Sesi dengan `clients` mati): satu tab tak memberi pilihan apa pun.
 * Tab bergerbang disembunyikan; angka "butuh pengajuan" tiap tab memakai `pendingFor`, sama seperti
 * badge di sidebar.
 */
export function SectionTabs({ section, onNavigate }: { section: string; onNavigate: (key: string) => void }) {
  const gates = React.useContext(NavGate);
  const pending = React.useContext(NavPending);
  const hub = hubOf(section);
  const current = tabOf(section);
  if (!hub || !current) return null;
  const tabs = tabsOf(hub, gates);
  if (tabs.length < 2) return null;
  return (
    <div className="hn-section-tabs">
      <Tabs
        aria-label={hub.label}
        value={current}
        tabs={tabs.map((t) => ({ value: t.section, label: t.label, count: pendingFor(pending, t.section) }))}
        // `section`, bukan `current`: di layar turunan (detail project, review) tab induknya terpilih,
        // dan klik tab itu tetap harus membawa pengguna keluar ke daftarnya.
        onChange={(v) => { if (v !== section) onNavigate(v); }}
      />
    </div>
  );
}
