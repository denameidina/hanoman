// State tampilan tiap layar — filter, paginasi, scroll, seleksi — yang bertahan lintas
// navigasi & refresh (SPEC-740 · ADR-0115).
//
// Murni & bebas React: satu-satunya sentuhan platform adalah `localStorage`, yang SELALU
// dibungkus try/catch — di mode privat ia melempar saat DIAKSES, bukan hanya saat ditulis.
//
// Versi hidup DI DALAM kunci, bukan di dalam nilai: menaikkan UI_VERSION membuat seluruh
// state lama tak terlihat tanpa satu baris migrasi, dan `pruneUiState()` menyapu sisanya.

export const UI_PREFIX = "hn.ui";
export const UI_VERSION = "v1";

/** Screen key ber-scope project. Scope kosong = tak ber-scope (bukan "screen@"). */
export const scoped = (screen: string, scope?: string | null): string =>
  (scope ? `${screen}@${scope}` : screen);

/** `hn.ui.v1.backlog.q` · ber-scope: `hn.ui.v1.changelog@erp.q` */
export const uiKey = (screen: string, field: string): string =>
  `${UI_PREFIX}.${UI_VERSION}.${screen}.${field}`;

/** Prefix seluruh kunci milik satu screen key — berakhiran titik agar `backlog.` tak
    ikut mencocoki `backlogX.`. */
export const uiScreenPrefix = (screen: string): string =>
  `${UI_PREFIX}.${UI_VERSION}.${screen}.`;

export type Accept<T> = (v: unknown) => v is T;

export const isStr = (v: unknown): v is string => typeof v === "string";
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isBool = (v: unknown): v is boolean => typeof v === "boolean";
export const nullableStr = (v: unknown): v is string | null => v === null || typeof v === "string";
export const strList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
export const oneOf = <T extends string>(...opts: T[]): Accept<T> =>
  ((v: unknown): v is T => typeof v === "string" && (opts as string[]).includes(v));

// Guard bawaan: bentuk nilai tersimpan wajib sama dengan bentuk default. Tanpa ini
// `page: "abc"` yang tertinggal dari bentuk lama membuat Pager menghitung NaN. Field
// nullable tak punya informasi tipe di default-nya → pemanggilnya menyebut `nullableStr`.
function sameShape(v: unknown, fallback: unknown): boolean {
  if (fallback === null) return v === null;
  if (Array.isArray(fallback)) return Array.isArray(v);
  if (typeof fallback === "number") return isNum(v);
  if (v === null) return false;
  return typeof v === typeof fallback;
}

export function readUiState<T>(key: string, fallback: T, accept?: Accept<T>): T {
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  if (raw === null) return fallback;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fallback; }
  const ok = accept ? accept(parsed) : sameShape(parsed, fallback);
  return ok ? (parsed as T) : fallback;
}

export function writeUiState(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* mode privat / kuota penuh */ }
}

function allKeys(): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null) out.push(k);
    }
    return out;
  } catch { return []; }
}

function removeKeys(match: (k: string) => boolean): void {
  for (const k of allKeys()) {
    if (!match(k)) continue;
    try { localStorage.removeItem(k); } catch { /* mode privat */ }
  }
}

type ResetListener = (prefix: string) => void;
const resetListeners = new Set<ResetListener>();

/** Dengarkan reset layar. Mengembalikan fungsi pelepas (dipakai sebagai cleanup effect). */
export function onUiReset(fn: ResetListener): () => void {
  resetListeners.add(fn);
  return () => { resetListeners.delete(fn); };
}

// Menghapus kunci saja tak cukup: komponen yang sedang ter-mount memegang nilainya di
// useState. Peristiwa ini yang mengembalikannya ke nilai awal — tanpa prop drilling, dan
// layar baru ikut dapat perilakunya.
export function resetUiState(screen: string): void {
  const prefix = uiScreenPrefix(screen);
  removeKeys((k) => k.startsWith(prefix));
  for (const fn of [...resetListeners]) fn(prefix);
}

/** Buang state dari versi kunci yang sudah tak dibaca siapa pun. Dipanggil sekali saat App mount. */
export function pruneUiState(): void {
  const live = `${UI_PREFIX}.${UI_VERSION}.`;
  removeKeys((k) => k.startsWith(`${UI_PREFIX}.`) && !k.startsWith(live));
}
