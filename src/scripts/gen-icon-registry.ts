// ADR-0160 · registry ikon STATIS. `import { icons } from "lucide-react"` membawa seluruh ±1 500 ikon
// (±1 MB sebelum gzip) ke chunk utama karena `<Icon name>` mencari komponennya lewat string saat
// runtime — Rollup tak bisa memangkas apa yang tak bisa ia lihat. Skrip ini memindai SETIAP literal
// string kebab-case di `src/src` (prop `icon=`, `leftIcon=`, argumen `showToast`, peta seperti
// `STATUS_ICON`, `HN_NAV`), menyaringnya ke nama yang memang ada di lucide, dan menulis
// `src/src/ds/icon-registry.ts` berisi impor bernama satu per satu. Kata biasa yang kebetulan sama
// dengan nama ikon (`box`, `list`, `search`) ikut masuk — biaya beberapa ratus byte, bukan bug.
//
//   pnpm --filter ./src gen:icons          # tulis ulang registry
//   src/test/icon-registry.test.ts         # gagal bila registry basi terhadap sumber
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { icons } from "lucide-react";
import { pascalCandidates } from "../src/ds/icon-names";

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LITERAL = /"([a-z][a-z0-9-]*)"|'([a-z][a-z0-9-]*)'|`([a-z][a-z0-9-]*)`/g;

export function collectIconNames(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mts)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith("icon-registry.ts")) files.push(p);
    }
  };
  walk(root);
  const names = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(LITERAL)) {
      const lit = m[1] ?? m[2] ?? m[3] ?? "";
      if (KEBAB.test(lit)) names.add(lit);
    }
  }
  return [...names].sort();
}

export function renderRegistry(root: string): string {
  const known = icons as Record<string, unknown>;
  const exportsNeeded = new Set<string>(["Circle"]);   // fallback `Icon` untuk nama tak dikenal
  for (const name of collectIconNames(root)) {
    const hit = pascalCandidates(name).find((c) => c in known);
    if (hit) exportsNeeded.add(hit);
  }
  const list = [...exportsNeeded].sort();
  return [
    "// DIBANGKITKAN oleh src/scripts/gen-icon-registry.ts — JANGAN disunting tangan.",
    "// Jalankan `pnpm --filter ./src gen:icons` sesudah memakai nama ikon baru; test",
    "// `icon-registry.test.ts` menolak registry yang basi. Alasannya di kepala skrip itu (ADR-0160).",
    "import {",
    ...list.map((n) => `  ${n},`),
    "} from \"lucide-react\";",
    "import type { LucideIcon } from \"lucide-react\";",
    "",
    "export const ICONS: Record<string, LucideIcon> = {",
    ...list.map((n) => `  ${n},`),
    "};",
    "",
  ].join("\n");
}

const here = dirname(fileURLToPath(import.meta.url));
export const SRC_ROOT = resolve(here, "../src");
export const REGISTRY_PATH = resolve(SRC_ROOT, "ds/icon-registry.ts");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = renderRegistry(SRC_ROOT);
  writeFileSync(REGISTRY_PATH, out);
  console.log(`icon-registry.ts · ${out.split("\n").filter((l) => l.startsWith("  ")).length / 2} ikon`);
}
