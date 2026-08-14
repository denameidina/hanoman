// SPEC-398 · ADR-0087 · aset dashboard bisa berada di dua tempat: `web/` di dalam paket npm
// (bersebelahan dengan dist) atau `src/dist` di checkout. Pemilihannya murni supaya bisa dites
// tanpa filesystem; `HANOMAN_WEB_DIR` yang di-set tapi salah MELEMPAR, karena "dashboard hilang
// tanpa pesan" adalah gejala yang mahal didiagnosis.
import { resolve } from "node:path";
import type { EnvLike } from "@hanoman/runner";

export const shouldServeWeb = (env: EnvLike): boolean =>
  env.NODE_ENV === "production" || Boolean(env.HANOMAN_WEB_DIR?.trim());

export function pickWebDir(distDir: string, env: EnvLike, exists: (p: string) => boolean): string | null {
  const forced = env.HANOMAN_WEB_DIR?.trim();
  if (forced) {
    if (!exists(forced)) throw new Error(`HANOMAN_WEB_DIR menunjuk direktori yang tak ada: ${forced}`);
    return forced;
  }
  for (const c of [resolve(distDir, "../web"), resolve(distDir, "../../src/dist")]) {
    if (exists(c)) return c;
  }
  return null;
}
