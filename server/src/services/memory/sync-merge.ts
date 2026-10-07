// ADR-0180 · merge record memori untuk sync. Murni. Field selain `status`/`updatedAt` tak pernah
// berubah setelah record lahir (ADR-0178 §2), jadi dua salinan yang berbeda HANYA di status bisa
// digabung tanpa manusia: lattice monoton, yang lebih tinggi menang, seri → yang sudah ada.
import type { MemoryStatus } from "@hanoman/shared";
import { mergeStatus } from "./rules";

const MUTABLE = new Set(["status", "updatedAt"]);
type Data = Record<string, unknown>;

export function mergeMemoryRecord(current: Data, incoming: Data):
  { kind: "same" } | { kind: "merged"; data: Data } | { kind: "conflict" } {
  for (const k of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
    if (MUTABLE.has(k)) continue;
    if (JSON.stringify(current[k] ?? null) !== JSON.stringify(incoming[k] ?? null)) return { kind: "conflict" };
  }
  const merged = mergeStatus(current.status as MemoryStatus, incoming.status as MemoryStatus);
  return merged === current.status ? { kind: "same" } : { kind: "merged", data: { ...current, status: merged } };
}
