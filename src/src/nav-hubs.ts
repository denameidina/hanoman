// ADR-0205 · 8 hub bergrup. Menimpa sebagian ADR-0160 (DAFTAR menu sidebar, bukan bentuk URL).
//
// Modul ini MURNI (tanpa React, tanpa DOM, tanpa router) supaya aturan "tak ada section yatim" bisa
// diuji langsung (nav-hubs.test.ts). URL tidak berubah: setiap tab adalah section yang sama dengan
// entri `HN_NAV` (`/projects`, `/prd`, `/settings`, …), dan hub hanya menentukan di mana section itu
// duduk di sidebar. `HN_NAV` (ds/shell.tsx) tetap daftar SEMUA rute yang valid; modul ini daftar apa
// yang tampil sebagai menu, dan section yang sengaja hanya lewat palet (`PALETTE_ONLY_SECTIONS`).
import { pendingFor, type PendingCounts } from "@hanoman/shared";

export type HubGroupKey = "kerja" | "otomasi" | "sistem";

/** Grup sidebar, berurutan. Setiap hub menempati tepat satu grup. */
export const HN_GROUPS: readonly { key: HubGroupKey; label: string }[] = [
  { key: "kerja", label: "Kerja" },
  { key: "otomasi", label: "Otomasi" },
  { key: "sistem", label: "Sistem" },
];

/** Tab sebuah hub. `gate` memakai kunci yang sama dengan `HN_NAV` (mis. `clients`). */
export type HubChild = { section: string; label: string; gate?: string };

/** Route turunan: milik sebuah hub, tetapi BUKAN tab. Hanya lewat URL-nya atau palet. */
export type HubDerived = { section: string; under: string };

export type NavHub = {
  key: string;
  label: string;
  /** Nama ikon yang sudah terdaftar di icon-registry (dipakai ulang dari entri HN_NAV). */
  icon: string;
  group: HubGroupKey;
  /** Tab, berurutan. Tab pertama yang tampil = fallback bila `default` bergerbang. */
  children: readonly HubChild[];
  /** Section yang dibuka klik hub bila belum ada riwayat tab di hub itu. Harus salah satu `children`. */
  default: string;
  /** Route turunan (lihat `HubDerived`). Tidak pernah tampil sebagai tab. */
  derived?: readonly HubDerived[];
};

export const HN_HUBS: readonly NavHub[] = [
  { key: "overview", label: "Overview", icon: "layout-dashboard", group: "kerja",
    children: [{ section: "overview", label: "Overview" }], default: "overview" },
  { key: "projects", label: "Projects", icon: "layout-grid", group: "kerja",
    children: [
      { section: "projects", label: "Daftar" },
      { section: "prd", label: "PRD" },
      { section: "docs", label: "Docs" },
      { section: "qa", label: "QA" },
      { section: "ide", label: "Kode" },
    ],
    derived: [{ section: "project", under: "projects" }],
    default: "projects" },
  { key: "backlog", label: "Backlog", icon: "list-checks", group: "kerja",
    children: [
      { section: "backlog", label: "Spec" },
      { section: "team", label: "Tugas manusia" },
    ],
    derived: [{ section: "review", under: "backlog" }],
    default: "backlog" },
  { key: "triage", label: "Triase", icon: "inbox", group: "kerja",
    children: [{ section: "triage", label: "Triase" }], default: "triage" },
  { key: "sesi", label: "Sesi", icon: "terminal", group: "kerja",
    children: [
      { section: "terminal", label: "Terminal" },
      { section: "clients", label: "Perangkat", gate: "clients" },
    ],
    default: "terminal" },
  { key: "otonom", label: "Otonom", icon: "calendar-clock", group: "otomasi",
    children: [
      { section: "scheduler", label: "Scheduler" },
      { section: "lead", label: "Lead" },
    ],
    default: "scheduler" },
  { key: "skills", label: "Skills", icon: "sparkles", group: "sistem",
    children: [{ section: "skills", label: "Skills" }], default: "skills" },
  { key: "pengaturan", label: "Pengaturan", icon: "settings", group: "sistem",
    children: [
      { section: "settings", label: "Pengaturan" },
      { section: "vps", label: "Server (VPS)" },
    ],
    default: "settings" },
];

/**
 * Section `HN_NAV` yang SENGAJA tidak punya tempat di sidebar. Tetap bisa dicapai lewat palet
 * (`Pindah ke` + `Buka panggung`) dan shortcut `g d`. Daftar pendek dan eksplisit: menambah entri
 * di sini adalah keputusan, bukan kelalaian.
 */
export const PALETTE_ONLY_SECTIONS: readonly string[] = ["dalang"];

/** Hub yang memuat `section`, baik sebagai tab maupun sebagai turunan. `undefined` = tak ada hub. */
export function hubOf(section: string | null | undefined): NavHub | undefined {
  if (!section) return undefined;
  return HN_HUBS.find((h) =>
    h.children.some((c) => c.section === section) || (h.derived ?? []).some((d) => d.section === section));
}

/** Tab yang mewakili `section` di bar tab hub-nya: tab itu sendiri, atau induk turunannya. */
export function tabOf(section: string | null | undefined): string | undefined {
  const hub = hubOf(section);
  if (!hub) return undefined;
  if (hub.children.some((c) => c.section === section)) return section!;
  return (hub.derived ?? []).find((d) => d.section === section)?.under;
}

/** Semua section yang dimiliki hub: tab lalu turunan. Menerima hub atau kuncinya. */
export function sectionsOf(hub: NavHub | string): string[] {
  const h = typeof hub === "string" ? HN_HUBS.find((x) => x.key === hub) : hub;
  if (!h) return [];
  return [...h.children.map((c) => c.section), ...(h.derived ?? []).map((d) => d.section)];
}

/** Tab yang tampil untuk gerbang yang aktif, berurutan. */
export function tabsOf(hub: NavHub, gates: Readonly<Record<string, boolean>>): HubChild[] {
  return hub.children.filter((c) => !c.gate || gates[c.gate]);
}

/**
 * Section yang dibuka klik pada hub: tab terakhir yang dikunjungi di hub itu bila masih tampil,
 * lalu `default`, lalu tab pertama yang tampil. `lastTab` = hub key → section.
 */
export function hubTarget(hub: NavHub, lastTab: Readonly<Record<string, string>>, gates: Readonly<Record<string, boolean>>): string {
  const shown = new Set(tabsOf(hub, gates).map((c) => c.section));
  const remembered = lastTab[hub.key];
  if (remembered && shown.has(remembered)) return remembered;
  if (shown.has(hub.default)) return hub.default;
  return [...shown][0] ?? hub.default;
}

/**
 * Angka badge hub = jumlah "butuh pengajuan" dari tab-tab yang tampil. `undefined` bila nol, sama
 * seperti `pendingFor` untuk satu entri: nol tak dirender.
 */
export function hubBadge(hub: NavHub, counts: PendingCounts | null, gates: Readonly<Record<string, boolean>>): number | undefined {
  let total = 0;
  for (const c of tabsOf(hub, gates)) total += pendingFor(counts, c.section) ?? 0;
  return total > 0 ? total : undefined;
}
