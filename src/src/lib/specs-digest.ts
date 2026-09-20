import type { SpecListItem, SpecSlim } from "@hanoman/shared";

type Digestible = Pick<SpecSlim, "id" | "stage" | "version" | "updatedAt">;

// SPEC-1267 · dedup frame siar `specs` di klien: sidik jari dari kolom yang berubah bila item
// berubah (`version`/`updatedAt` ditulis server, stage live ikut). Isi sama → tak ada refetch/re-render.
export const specsDigestOf = (specs: readonly Digestible[]): string =>
  specs.map((s) => `${s.id}:${s.stage}:${s.version ?? ""}:${s.updatedAt ?? ""}`).join("|");

// Kolom ringan yang dimiliki frame siar; sisanya (payload, objective, sourceHistory) hanya ada di HTTP.
const SLIM_KEYS = ["stage", "status", "version", "updatedAt", "blockedBy", "dependsOn", "title", "priority"] as const;

// Daftar HTTP (`SpecListItem`) bisa lebih basi daripada frame siar terbaru, jadi kolom siar
// menimpanya — bukan sebaliknya.
export function mergeSlim<T extends SpecListItem>(http: T, slim: SpecSlim | undefined): T {
  if (!slim) return http;
  const out = { ...http } as Record<string, unknown>;
  for (const k of SLIM_KEYS) if (k in slim) out[k] = (slim as Record<string, unknown>)[k];
  return out as T;
}

export const toSlim = ({ objective: _objective, ...rest }: SpecListItem): SpecSlim => rest;
