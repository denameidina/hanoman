// Audit UI/UX 2026-10 · Fase 3C · "Cari pengaturan". Dua lapis:
//  1. Di dalam bagian yang sedang tampil: baris & kartu yang judul/penjelasannya (atribut `data-search`)
//     tak memuat kueri disembunyikan. Kartu yang judulnya cocok menampilkan seluruh barisnya.
//  2. Lintas bagian: daftar bagian yang labelnya atau kata kuncinya cocok, supaya "telegram" dari
//     "Sesi harian" tetap bisa dibuka. Tombol ⌘K tak dipakai untuk ini (pencarian lokal di layar).
import React from "react";
import { Input } from "../../ds";
import { SETTINGS_INTENTS, sectionPath, type SectionKey } from "./model";

/** Hasil pencarian lintas bagian. `path` = "Integrasi & akses · Telegram". */
export interface SectionHit { key: SectionKey; path: string }

export function searchSections(query: string): SectionHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_INTENTS.flatMap((intent) => intent.sections)
    .filter((sec) => `${sec.label} ${sec.keywords}`.toLowerCase().includes(q))
    .map((sec) => ({ key: sec.key, path: sectionPath(sec.key) }));
}

const matches = (haystack: string | null, q: string) => (haystack ?? "").toLowerCase().includes(q);

/**
 * Terapkan kueri ke DOM bagian yang sedang tampil. Mengembalikan jumlah baris & kartu tanpa-baris yang
 * tampil; nol berarti tak ada yang cocok di bagian ini. Hanya atribut `hidden` yang diubah, jadi React
 * tetap memegang struktur dan isinya.
 */
export function applySettingsFilter(root: HTMLElement | null, query: string): number {
  if (!root) return 0;
  const q = query.trim().toLowerCase();
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-setting-row]"));
  const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-setting-card]"));
  const cardOf = (el: HTMLElement) => el.parentElement?.closest<HTMLElement>("[data-setting-card]") ?? null;
  let visible = 0;
  if (!q) {
    rows.forEach((r) => { r.hidden = false; });
    cards.forEach((c) => { c.hidden = false; });
    return rows.length + cards.filter((c) => !c.querySelector("[data-setting-row]")).length;
  }
  cards.forEach((card) => {
    const cardMatch = matches(card.getAttribute("data-search"), q);
    const own = Array.from(card.querySelectorAll<HTMLElement>("[data-setting-row]")).filter((r) => cardOf(r) === card);
    if (own.length === 0) {
      card.hidden = !cardMatch;
      if (cardMatch) visible++;
      return;
    }
    let anyRow = false;
    own.forEach((r) => {
      const m = cardMatch || matches(r.getAttribute("data-search"), q);
      r.hidden = !m;
      if (m) { anyRow = true; visible++; }
    });
    card.hidden = !(cardMatch || anyRow);
  });
  rows.forEach((r) => {
    if (cardOf(r)) return;
    const m = matches(r.getAttribute("data-search"), q);
    r.hidden = !m;
    if (m) visible++;
  });
  return visible;
}

/**
 * Jalankan filter setiap kueri berubah dan setiap kali DOM bagian berubah (daftar yang baru dimuat
 * async ikut tersaring). Mengembalikan jumlah yang tampil untuk pesan "tak ada yang cocok".
 */
export function useSettingsFilter(rootRef: React.RefObject<HTMLElement | null>, query: string, section: SectionKey): number {
  const [count, setCount] = React.useState(0);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const run = () => setCount(applySettingsFilter(root, query));
    run();
    if (!root || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(run);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [query, section, rootRef]);
  return count;
}

export function SettingsSearch({ value, onChange, hits, onPick }: {
  value: string;
  onChange: (next: string) => void;
  hits: SectionHit[];
  onPick: (key: SectionKey) => void;
}) {
  return (
    <div className="hn-set-search" role="search">
      <Input type="search" aria-label="Cari pengaturan" placeholder="mis. notifikasi, telegram, token"
        value={value} leftIcon="search" className="hn-set-full"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Escape" && value) onChange(""); }} />
      {value.trim() !== "" && hits.length > 0 && (
        <ul className="hn-set-search-hits" aria-label="Bagian yang cocok">
          {hits.map((hit) => (
            <li key={hit.key}>
              <button type="button" className="hn-set-search-hit" onClick={() => onPick(hit.key)}>{hit.path}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
