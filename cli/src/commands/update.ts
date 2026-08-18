// SPEC-398 · ADR-0087 · update = `npm i -g hanoman@latest`. CLI-lah yang melakukannya, BUKAN
// server: instance yang me-`npm i` dirinya sendiri lalu keluar akan memutus sesi tmux yang sedang
// berjalan tanpa peringatan (ADR-0048 tetap read-only di sisi server).
import { execFileSync } from "node:child_process";
import { compareSemver } from "@hanoman/shared";
import type { Ctx } from "../router";
import { currentVersion } from "../router";

export const PKG = "hanoman";
// `--prefer-online`: npm melayani METADATA paket dari cache selama masih "fresh", jadi `@latest`
// bisa menyelesaikan ke versi basi — tombol update di UI lalu memasang ulang versi yang sama dan
// tampak tak berefek. Flag ini memaksa revalidasi packument ke registry (tarball tetap dari cache
// bila hash-nya cocok, jadi bukan `--prefer-offline`-nya yang dibalik, hanya kesegaran metadata).
export const INSTALL_ARGS = ["i", "-g", `${PKG}@latest`, "--prefer-online"] as const;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export type UpdatePlan =
  | { action: "up-to-date"; current: string; latest: string }
  | { action: "install"; current: string; latest: string }
  | { action: "unknown"; current: string; latest: null };

// Murni: registry tak terjangkau → `unknown` (jangan pernah memasang buta), dan versi registry
// yang LEBIH TUA dari yang jalan → `up-to-date` (jangan pernah menurunkan versi).
export function planUpdate(current: string, latest: string | null): UpdatePlan {
  if (!latest) return { action: "unknown", current, latest: null };
  return compareSemver(latest, current) > 0
    ? { action: "install", current, latest }
    : { action: "up-to-date", current, latest };
}

async function latestVersion(registry: string): Promise<string | null> {
  try {
    const res = await fetch(`${registry.replace(/\/+$/, "")}/${PKG}/latest`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch { return null; }
}

export default async function update(argv: string[], ctx: Ctx): Promise<number> {
  const check = argv.includes("--check");
  const current = currentVersion();
  const latest = await latestVersion(ctx.env.HANOMAN_NPM_REGISTRY ?? DEFAULT_REGISTRY);
  const plan = planUpdate(current, latest);
  if (plan.action === "unknown") {
    ctx.stderr(`hanoman ${current} · registry npm tak terjangkau — coba lagi nanti\n`);
    return 1;
  }
  if (plan.action === "up-to-date") { ctx.stdout(`hanoman ${current} sudah terkini\n`); return 0; }
  ctx.stdout(`hanoman ${plan.current} → ${plan.latest}\n`);
  if (check) { ctx.stdout(`jalankan: npm ${INSTALL_ARGS.join(" ")}\n`); return 0; }
  try { execFileSync("npm", [...INSTALL_ARGS], { stdio: "inherit" }); }
  catch { ctx.stderr("npm i -g gagal — jalankan manual (mungkin butuh sudo)\n"); return 1; }
  ctx.stdout(`terpasang hanoman ${plan.latest} · restart instance yang berjalan\n`);
  return 0;
}
