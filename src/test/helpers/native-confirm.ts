// SPEC-847 · ADR-0125 · AC-4 ditegakkan atas SUMBER, bukan DOM: `window.confirm` tak punya
// jejak di pohon render aplikasi, jadi tak ada test render yang akan menangkap call site baru.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type ConfirmHit = { file: string; line: number; exemptReason?: string };

const files = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if ((p.endsWith(".tsx") || p.endsWith(".ts")) && !p.includes(".test.")) out.push(p);
    }
  };
  walk(root);
  return out.sort();
};

export function scanConfirmSource(file: string, src: string): ConfirmHit[] {
  const out: ConfirmHit[] = [];
  const re = /window\.confirm\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const line = src.slice(0, m.index).split("\n").length;
    // Alasan dicari di 400 karakter sebelum call site — cukup untuk komentar dua-tiga baris
    // di atasnya, tak cukup untuk mencuri alasan milik call site sebelumnya.
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    out.push({ file, line, exemptReason: before.match(/confirm-exempt:\s*([^\n*}]+)/)?.[1]?.trim() });
  }
  return out;
}

export const scanConfirmDir = (root: string): ConfirmHit[] =>
  files(root).flatMap((f) => scanConfirmSource(f, readFileSync(f, "utf8")));

const count = (src: string, needle: string) => src.split(needle).length - 1;

export function scanHookBalance(root: string) {
  return files(root)
    .map((f) => {
      const src = readFileSync(f, "utf8");
      // `= useConfirm(` menghitung CALL SITE, bukan deklarasi hook-nya sendiri di ds/useConfirm.tsx.
      return { file: f, hooks: count(src, "= useConfirm("), dialogs: count(src, "{dialog}") };
    })
    .filter((r) => r.hooks > 0);
}

export const scannedFileCount = (root: string): number => files(root).length;
