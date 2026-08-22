/// <reference types="vite/client" />
// Pet hidup (spec A) · manifest atlas PET-001 dan pemetaan pose → baris. Atlas satu berkas WebP
// 8 kolom × N baris (sel 192×208); frontend memilih baris lewat `--row` dan frame lewat
// `steps(8)` atas `translateX(-100%)`, jadi yang dibutuhkan dari sini hanya indeks, durasi, dan
// rantai `then` untuk baris sekali-putar. Validasi ditulis tangan: `zod` tak bisa di-resolve dari
// paket `src` (hanya dependency `shared`).
import manifestJson from "../../../internal/assets/pet/pet.json";
import atlasUrl from "../../../internal/assets/pet/hnm-pet-anoman-atlas-v02.webp?url";
import type { PetPose } from "./pet-state";

export const PET_ROW_KEYS = [
  "idle", "walk-right", "walk-left", "working", "waiting", "blocked", "review", "shipped",
  // SPEC-897 · dua baris baru di EKOR: indeks baris lama tak bergeser, diff atlas minimal.
  "docs-updated", "wave", "deciding", "sleep",
  // SPEC-898 · reaksi elus. BUKAN pose — `POSE_ROW` tak menyentuhnya.
  "thanks",
  // SPEC-904 · pet yang diseret: terangkat, jatuh perlahan, pusing sesaat. Di EKOR seperti dua
  // preseden di atas. Juga BUKAN pose — interaksinya dibangun backlog penerus, bukan `POSE_ROW`.
  "held", "falling", "dizzy",
] as const;
export type PetRowKey = typeof PET_ROW_KEYS[number];

export type PetRow = {
  key: PetRowKey;
  fps: number;
  loop: boolean;
  then?: PetRowKey;
  dir?: "right" | "left";
};

export type PetManifest = {
  id: string;
  version: number;
  cell: { w: number; h: number };
  columns: number;
  anchor: { x: number; baseline: number };
  character: { h: number };
  rows: PetRow[];
  sources: Record<string, string>;
};

const isRowKey = (v: unknown): v is PetRowKey => typeof v === "string" && (PET_ROW_KEYS as readonly string[]).includes(v);
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parsePetManifest(raw: unknown): PetManifest {
  const fail = (why: string): never => { throw new Error(`pet.json tidak sah: ${why}`); };
  if (!rec(raw)) return fail("bukan objek");
  const { id, version, cell, columns, anchor, character, rows, sources } = raw;
  if (typeof id !== "string" || !id) return fail("id");
  if (!posInt(version)) return fail("version");
  if (!rec(cell) || !posInt(cell.w) || !posInt(cell.h)) return fail("cell");
  if (!posInt(columns)) return fail("columns");
  if (!rec(anchor) || typeof anchor.x !== "number" || !(anchor.x > 0 && anchor.x < 1)
    || !posInt(anchor.baseline) || anchor.baseline > cell.h) return fail("anchor");
  if (!rec(character) || !posInt(character.h) || character.h > cell.h) return fail("character");
  if (!Array.isArray(rows) || rows.length !== PET_ROW_KEYS.length) return fail(`rows: butuh ${PET_ROW_KEYS.length} baris`);
  const parsed: PetRow[] = rows.map((r, i) => {
    const key = PET_ROW_KEYS[i]!;
    if (!rec(r) || r.key !== key) return fail(`rows[${i}]: harus "${key}"`);
    if (!posInt(r.fps)) return fail(`rows[${i}].fps`);
    if (typeof r.loop !== "boolean") return fail(`rows[${i}].loop`);
    const row: PetRow = { key, fps: r.fps, loop: r.loop };
    if (r.then !== undefined) {
      if (!isRowKey(r.then) || r.loop) return fail(`rows[${i}].then hanya untuk baris loop:false`);
      row.then = r.then;
    } else if (!r.loop) return fail(`rows[${i}] loop:false tanpa then`);
    if (r.dir !== undefined) {
      if (r.dir !== "right" && r.dir !== "left") return fail(`rows[${i}].dir`);
      row.dir = r.dir;
    }
    return row;
  });
  if (!rec(sources) || PET_ROW_KEYS.some((k) => typeof sources[k] !== "string")) return fail("sources");
  return {
    id, version, cell: { w: cell.w, h: cell.h }, columns,
    anchor: { x: anchor.x, baseline: anchor.baseline }, character: { h: character.h },
    rows: parsed, sources: sources as Record<string, string>,
  };
}

export const PET_MANIFEST: PetManifest = parsePetManifest(manifestJson);
export const PET_ATLAS_URL: string = atlasUrl;

// `ready` dan `offline` adalah pose yang namanya berbeda dari barisnya. `offline` sengaja menumpang
// `idle`: yang dikatakan pet saat terputus adalah "aku tak tahu", dan itu diucapkan oleh pudar +
// kalimat — satu baris atlas lagi berarti ±70 KB (SPEC-904: 1 165 556 B untuk 16 baris) untuk
// informasi yang sudah tersampaikan.
export const POSE_ROW: Record<PetPose, PetRowKey> = {
  ready: "idle",
  sleeping: "sleep",
  offline: "idle",
  working: "working",
  deciding: "deciding",
  waiting: "waiting",
  blocked: "blocked",
  review: "review",
  shipped: "shipped",
  "docs-updated": "docs-updated",
};

export function rowOf(key: PetRowKey, manifest: PetManifest = PET_MANIFEST): PetRow {
  const row = manifest.rows.find((r) => r.key === key);
  if (!row) throw new Error(`baris ${key} tak ada di manifest`);
  return row;
}

export const rowIndex = (key: PetRowKey, manifest: PetManifest = PET_MANIFEST): number =>
  manifest.rows.findIndex((r) => r.key === key);

// Satu putaran = `columns` frame; `steps(columns)` membagi durasi ini rata per frame.
export const durationMs = (key: PetRowKey, manifest: PetManifest = PET_MANIFEST): number =>
  Math.round((manifest.columns / rowOf(key, manifest).fps) * 1000);

export const thenOf = (key: PetRowKey, manifest: PetManifest = PET_MANIFEST): PetRowKey | null =>
  rowOf(key, manifest).then ?? null;
