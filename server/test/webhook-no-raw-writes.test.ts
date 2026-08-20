import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { WEBHOOK_ENTITIES } from "@hanoman/shared";

// SPEC-481 · tap Prisma tak bisa melihat SQL mentah maupun `createMany` (SQLite tak mengembalikan
// baris). Keduanya tak dipakai untuk model terlacak hari ini; test ini yang menjaga itu tetap
// benar, karena pelanggarannya gagal SENYAP — peristiwa hilang tanpa satu pun error.
const SRC = resolve(import.meta.dirname, "../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
});

const delegates = WEBHOOK_ENTITIES.map((d) => d.model[0]!.toLowerCase() + d.model.slice(1));

describe("penulis yang tak terlihat tap", () => {
  it("tak ada createMany atas model terlacak", () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const d of delegates)
        if (src.includes(`prisma.${d}.createMany`) || src.includes(`tx.${d}.createMany`))
          bad.push(`${f}: ${d}.createMany`);
    }
    expect(bad).toEqual([]);
  });

  // SPEC-857 · ADR-0131 §4 · yang dilarang adalah raw yang bisa MENULIS model terlacak, karena
  // itulah yang menghilangkan peristiwa tanpa jejak. `PRAGMA` tak menyentuh satu baris model pun,
  // jadi ia lolos — tapi hanya di berkas yang disebut namanya, dan hanya berbentuk pragma. Raw
  // dalam bentuk lain tetap ditolak, termasuk di berkas itu sendiri.
  const PRAGMA_ONLY = new Set([join(SRC, "db.ts")]);
  const RAW_CALL = /\$(?:execute|query)Raw(?:Unsafe)?(?:<[^>]*>)?\(\s*[`"']([^`"']*)/g;

  it("tak ada $executeRaw / $queryRaw di server/src, selain PRAGMA yang disebut namanya", () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      const calls = [...src.matchAll(RAW_CALL)];
      if (!calls.length) {
        if (/\$(execute|query)Raw/.test(src)) bad.push(`${f}: raw tanpa literal yang bisa dibaca`);
        continue;
      }
      for (const [, stmt] of calls)
        if (!(PRAGMA_ONLY.has(f) && /^PRAGMA /.test(stmt!))) bad.push(`${f}: ${stmt}`);
    }
    expect(bad).toEqual([]);
  });
});
