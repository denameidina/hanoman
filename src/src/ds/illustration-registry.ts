/// <reference types="vite/client" />

import inventoryData from "../../../internal/assets/illustration/inventory.json";

export const ILLUSTRATION_IDS = [
  "MOD-001",
  "MSC-001",
  "HRO-001",
  "LKN-001",
  "LKN-002",
  "LKN-003",
  "LKN-004",
  "SPT-001",
  "SPT-002",
  "SPT-003",
  "SPT-004",
  "SPT-005",
  "SPT-006",
  "PST-001",
  "PST-002",
  "PST-003",
  "PST-004",
  "PST-005",
  "PST-006",
  "MPS-001",
  "MPS-002",
  "MPS-003",
  "MPS-004",
  "MPS-005",
  "MPS-006",
  "MPS-007",
  "MPS-008",
  "STK-001",
  "STK-002",
  "STK-003",
  "STK-004",
  "STK-005",
  "STK-006",
  "STK-007",
  "STK-008",
  "SOC-001",
  "SOC-002",
  "SOC-003",
  "SOC-004",
  "DGM-001",
  "MTF-001",
] as const;

export type IllustrationId = typeof ILLUSTRATION_IDS[number];
export type ProductStateIllustrationId = Extract<IllustrationId, `PST-${string}`>;
export type MascotIllustrationId = Extract<IllustrationId, `MPS-${string}`>;
export type StickerIllustrationId = Extract<IllustrationId, `STK-${string}`>;
export type SpotIllustrationId = Extract<IllustrationId, `SPT-${string}`>;

export type IllustrationFamily =
  | "model"
  | "hero"
  | "lakon"
  | "spot"
  | "product-state"
  | "mascot-pose"
  | "sticker"
  | "social"
  | "diagram"
  | "motif";

export type IllustrationRatio =
  | "sheet"
  | "16x9"
  | "4x3"
  | "1x1"
  | "4x5"
  | "9x16"
  | "modular"
  | "tile-strip";

type InventoryRecord = {
  id: string;
  family: IllustrationFamily;
  subject: string;
  ratio: IllustrationRatio;
  filename: string;
  transparent: boolean;
  promptIntent: string;
};

export type IllustrationAsset = {
  id: IllustrationId;
  family: IllustrationFamily;
  subject: string;
  ratio: IllustrationRatio;
  filename: string;
  transparent: boolean;
  alt: string;
  src: string;
};

const inventory = inventoryData as InventoryRecord[];
// Sengaja `web/`, BUKAN direktori master. Glob eager menyalin apa pun yang cocok ke `src/dist/assets`
// dan dari situ ke tarball npm; master near-lossless sempat membuat paket `hanoman` melonjak
// 5,5 MB → 46,1 MB. Turunan dirakit `internal/assets/illustration/build-web.mjs` dan di-commit.
const webpModules = import.meta.glob("../../../internal/assets/illustration/web/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function assetFor(id: IllustrationId): IllustrationAsset {
  const record = inventory.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Illustration ${id} is missing from inventory.json`);

  const moduleEntry = Object.entries(webpModules)
    .find(([path]) => path.endsWith(`/${record.filename}`));
  if (!moduleEntry) {
    throw new Error(`Illustration ${id} references missing WebP ${record.filename}`);
  }

  return Object.freeze({
    id,
    family: record.family,
    subject: record.subject,
    ratio: record.ratio,
    filename: record.filename,
    transparent: record.transparent,
    alt: record.promptIntent,
    src: moduleEntry[1],
  });
}

export const ILLUSTRATIONS = Object.freeze(Object.fromEntries(
  ILLUSTRATION_IDS.map((id) => [id, assetFor(id)]),
)) as Readonly<Record<IllustrationId, IllustrationAsset>>;

export function illustrationsByFamily(family: IllustrationFamily): IllustrationAsset[] {
  return ILLUSTRATION_IDS
    .map((id) => ILLUSTRATIONS[id])
    .filter((asset) => asset.family === family);
}
