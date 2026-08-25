// ADR-0099 · pembantu katalog MCP. Dipindahkan APA ADANYA dari `shared/src/mcp-catalog.ts`
// saat berkas itu dipecah per domain; tak satu baris pun berubah selain `export`.
import { paginateLocal } from "../mcp-shape";
import type { Args } from "./types";

export const s = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const n = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
export const enc = encodeURIComponent;

/** Query dari argumen: hanya yang terisi ikut. `undefined` tak pernah jadi string "undefined". */
export function query(pairs: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) if (v !== undefined) out[k] = v;
  return out;
}

/** Amplop daftar dari server (`{items,total,page,pageSize}`) → item dipadatkan, amplop dijaga. */
export function reshapePage(raw: unknown, fn: (r: Record<string, unknown>) => unknown): unknown {
  const p = raw as { items?: unknown[] };
  if (!Array.isArray(p?.items)) return raw;
  return { ...(raw as object), items: p.items.map((i) => fn(i as Record<string, unknown>)) };
}

/** Daftar mentah (`{items:[…]}` tanpa paginasi server) → dipadatkan lalu dipaginasi di wrapper. */
export function localPage(
  raw: unknown,
  a: Args,
  fn: (r: Record<string, unknown>) => unknown,
  extra?: (raw: Record<string, unknown>) => object,
): unknown {
  const items = Array.isArray((raw as { items?: unknown[] })?.items)
    ? (raw as { items: unknown[] }).items
    : Array.isArray(raw) ? (raw as unknown[]) : [];
  return {
    ...paginateLocal(items.map((i) => fn(i as Record<string, unknown>)), n(a.page), n(a.limit)),
    ...(extra?.((raw ?? {}) as Record<string, unknown>) ?? {}),
  };
}

export const ID_HINT = "Id backlog, mis. `SPEC-482` (huruf besar, dengan tanda hubung).";
