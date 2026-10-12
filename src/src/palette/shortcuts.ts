// Peta shortcut global (Audit UI/UX 2026-10 · Fase 2C). Murni: state chord `g` + huruf dihitung di
// sini, DOM dan listener ada di useGlobalShortcuts.ts.
//
// Shortcut:
//   ⌘K / Ctrl K   palet perintah (tak aktif di dalam terminal xterm — Ctrl+K milik readline shell)
//   g lalu huruf  pindah layar, jendela CHORD_WINDOW_MS (1 dtk) setelah `g`
//   /             fokus kotak cari di topbar; bila halaman tak punya, buka palet
//   ?             bantuan shortcut
//   Esc           tutup dialog (ditangani Modal DS)
// Shortcut huruf tunggal TIDAK aktif saat fokus di input/textarea/select/contenteditable/xterm, saat
// tombol modifier ditekan, atau saat dialog lain sedang terbuka. Ctrl+Shift+Esc (lepas fokus terminal)
// tak pernah dipakai di sini.

export const CHORD_WINDOW_MS = 1000;

/** Huruf → kunci nav (`HN_NAV.key`). Setiap entri HN_NAV harus punya huruf; ditegakkan oleh test. */
export const CHORD_KEYS: Readonly<Record<string, string>> = {
  o: "overview",
  d: "dalang",
  p: "projects",
  r: "prd",
  b: "backlog",
  m: "team",
  q: "qa",
  e: "triage",
  j: "scheduler",
  l: "lead",
  t: "terminal",
  i: "ide",
  a: "skills",
  v: "vps",
  k: "clients",
  f: "docs",
  s: "settings",
};

export type ChordState = { armedAt: number | null };
export const CHORD_IDLE: ChordState = { armedAt: null };

export type ChordStep = {
  state: ChordState;
  /** Kunci nav yang dituju bila chord selesai. */
  target?: string;
  /** Tombol ini dipakai chord (jangan diteruskan ke penangan lain). */
  consumed: boolean;
};

/**
 * Satu langkah mesin chord. `g` menyalakan chord; huruf berikutnya dalam jendela memilih layar bila
 * kunci navnya ada di `navKeys` (layar bergerbang yang tak aktif tak pernah dituju). Huruf lain
 * membatalkan chord dan TIDAK dikonsumsi, sehingga `?` dan `/` tetap bekerja sesudahnya.
 */
export function stepChord(state: ChordState, key: string, now: number, navKeys: readonly string[]): ChordStep {
  const k = key.length === 1 ? key.toLowerCase() : key;
  const armed = state.armedAt !== null && now - state.armedAt <= CHORD_WINDOW_MS;
  if (armed) {
    const target = CHORD_KEYS[k];
    if (target && navKeys.includes(target)) return { state: CHORD_IDLE, target, consumed: true };
    if (k !== "g") return { state: CHORD_IDLE, consumed: false };
  }
  if (k === "g") return { state: { armedAt: now }, consumed: true };
  return { state: CHORD_IDLE, consumed: false };
}

export function isMacPlatform(
  nav: { platform?: string; userAgent?: string } | undefined =
    typeof navigator !== "undefined" ? navigator : undefined,
): boolean {
  const s = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  return /mac|iphone|ipad/i.test(s);
}

/** Petunjuk di tombol topbar: "⌘K" di Mac, "Ctrl K" di lainnya. */
export function paletteShortcutLabel(mac: boolean): string {
  return mac ? "⌘K" : "Ctrl K";
}

/** Nama baris bantuan untuk layar yang berbeda dari label nav-nya (ADR-0205: Dalang di luar sidebar). */
const NAV_ROW_LABEL: Readonly<Record<string, string>> = { dalang: "Buka panggung" };

export type ShortcutRow = { keys: string[]; label: string };
export type ShortcutSection = { title: string; rows: ShortcutRow[] };

/** Isi dialog bantuan shortcut. `nav` = layar yang tampil di sidebar (sudah tersaring gerbangnya). */
export function shortcutSections(mac: boolean, nav: readonly { key: string; label: string }[]): ShortcutSection[] {
  const mod = mac ? "⌘" : "Ctrl";
  const letterOf = new Map(Object.entries(CHORD_KEYS).map(([letter, key]) => [key, letter] as const));
  return [
    {
      title: "Global",
      rows: [
        { keys: [mod, "K"], label: "Buka palet perintah" },
        { keys: ["/"], label: "Fokus kotak cari (bila halaman tak punya, buka palet)" },
        { keys: ["?"], label: "Tampilkan bantuan shortcut ini" },
        { keys: ["Esc"], label: "Tutup dialog atau palet" },
      ],
    },
    {
      title: "Pindah layar: tekan g, lalu huruf",
      rows: nav.flatMap((n) => {
        const letter = letterOf.get(n.key);
        // ADR-0205 · Dalang di luar sidebar; baris bantuannya memakai nama aksinya, sama dengan palet.
        return letter ? [{ keys: ["g", letter], label: NAV_ROW_LABEL[n.key] ?? n.label }] : [];
      }),
    },
  ];
}
