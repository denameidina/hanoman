// SPEC-883 · ADR-0137 · jalur mandiri: menjalankan provision.sh yang SAMA secara lokal, tanpa
// ssh. Itulah alasan skrip itu dilarang berasumsi apa pun tentang SSH atau tty.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../router";

const PROFILES = ["lab", "production"];

export type ProvisionArgs = {
  mode: "probe" | "apply";
  items: string[];
  profile: string;
  domain?: string;
  dryRun: boolean;
  yes: boolean;
};

const flag = (args: string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

export function parseProvisionArgs(args: string[]): ProvisionArgs | { error: string } {
  const probe = args.includes("--probe");
  const items = (flag(args, "with") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const profile = flag(args, "profile") ?? "lab";
  const domain = flag(args, "domain");
  if (!PROFILES.includes(profile)) return { error: `profil tak dikenal: ${profile}` };
  if (!probe && items.length === 0) return { error: "sebutkan komponen dengan --with=a,b" };
  return { mode: probe ? "probe" : "apply", items, profile, domain,
    dryRun: args.includes("--dry-run"), yes: args.includes("--yes") };
}

export function scriptEnv(a: ProvisionArgs): Record<string, string> {
  return {
    MODE: a.mode,
    ...(a.mode === "apply" ? { ITEMS: a.items.join(","), PROFILE: a.profile } : {}),
    ...(a.mode === "apply" && a.domain ? { DOMAIN: a.domain } : {}),
    ...(a.mode === "apply" && a.dryRun ? { DRY_RUN: "1" } : {}),
  };
}

// Dua lokasi, terpaket lebih dulu — cermin scriptPath() di server. Di paket npm bundle hidup di
// <pkg>/dist/cli.js dan skrip di <pkg>/scripts/vps.
export function localScriptPath(cwd: string = process.cwd()): string {
  const packed = fileURLToPath(new URL("../scripts/vps/provision.sh", import.meta.url));
  if (existsSync(packed)) return packed;
  return join(cwd, "server", "scripts", "vps", "provision.sh");
}

function runScript(env: Record<string, string>, ctx: Ctx): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("bash", [localScriptPath(ctx.cwd)], { env: { ...process.env, ...env } });
    p.stdout.on("data", (d) => ctx.stdout(String(d)));
    p.stderr.on("data", (d) => ctx.stderr(String(d)));
    p.on("close", (code) => resolve(code ?? 1));
    p.on("error", (e) => { ctx.stderr(`${e}\n`); resolve(127); });
  });
}

export default async function provisionCmd(args: string[], ctx: Ctx): Promise<number> {
  const parsed = parseProvisionArgs(args);
  if ("error" in parsed) { ctx.stderr(`${parsed.error}\n`); return 1; }
  if (parsed.mode === "probe" || parsed.dryRun) return runScript(scriptEnv(parsed), ctx);

  // Tanpa --yes: dry-run dulu, lalu minta konfirmasi. Perintah ini menulis /etc/hanoman.env
  // dan unit systemd — ia tak boleh berjalan karena salah ketik.
  if (!parsed.yes) {
    ctx.stdout("Rencana (dry-run):\n");
    await runScript({ ...scriptEnv(parsed), DRY_RUN: "1" }, ctx);
    ctx.stdout("Lanjutkan? [y/N] ");
    const answer = (await ctx.readStdin?.() ?? "").trim().toLowerCase();
    if (answer !== "y" && answer !== "ya") { ctx.stderr("dibatalkan\n"); return 1; }
  }
  return runScript(scriptEnv(parsed), ctx);
}
