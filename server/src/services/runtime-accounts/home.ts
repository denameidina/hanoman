import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeName } from "@hanoman/shared";
import { baseClaudeJson, baseHome } from "./paths";

// ADR-0234 · aset yang SAMA untuk semua akun: disymlink dari home akun ke home bawaan. Yang tak
// disebut di sini (kredensial, `.claude.json`, `auth.json`, `sessions/`, riwayat, cache) milik akun.
// `projects/` claude ikut dibagi: memori project & transkrip tetap satu tempat. `config.toml` codex
// ikut dibagi: entri trust `codex-trust.ts` berlaku untuk semua akun (spike ADR-0234: codex menulis
// LEWAT symlink, tak memutusnya).
export const SHARED_ENTRIES: Readonly<Record<RuntimeName, readonly string[]>> = {
  claude: ["skills", "plugins", "agents", "commands", "hooks", "output-styles", "settings.json", "CLAUDE.md", "projects"],
  codex: ["config.toml", "skills", "plugins", "AGENTS.md", "hooks.json", "prompts", "rules"],
  // Mode tukar agy: home akun hanya menyimpan slot token, tak ada aset bersama.
  antigravity: [],
};

// Kunci `.claude.json` bawaan yang disalin ke akun tiap launch. `.claude.json` sendiri tak bisa
// dibagi karena memuat identitas akun (`oauthAccount`). Daftar ini diverifikasi spike ADR-0234.
export const MIRRORED_CLAUDE_KEYS = [
  "mcpServers", "hasCompletedOnboarding", "lastOnboardingVersion", "theme", "bypassPermissionsModeAccepted", "projects",
] as const;

type EntryState = "ok" | "absent" | "no-target" | "drift";

function classify(target: string, link: string): EntryState {
  let st: ReturnType<typeof lstatSync> | null = null;
  try { st = lstatSync(link); } catch { st = null; }
  if (!st) return existsSync(target) ? "absent" : "no-target";
  if (st.isSymbolicLink()) return readlinkSync(link) === target ? "ok" : "drift";
  // Berkas/direktori biasa: CLI menulis atomik dan memutus symlink, atau operator menaruhnya sendiri.
  return "drift";
}

/** Entri bersama yang menyimpang dari home bawaan. Hanya membaca. */
export function inspectAccountHome(runtime: RuntimeName, homeDir: string, base: string = baseHome(runtime)): string[] {
  return SHARED_ENTRIES[runtime].filter((e) => classify(join(base, e), join(homeDir, e)) === "drift");
}

/** Buat home (0700) dan pasang symlink yang belum ada. Entri drift TAK pernah ditimpa. */
export function ensureAccountHome(runtime: RuntimeName, homeDir: string, base: string = baseHome(runtime)): { linked: string[]; drift: string[] } {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  chmodSync(homeDir, 0o700);
  const linked: string[] = [], drift: string[] = [];
  for (const entry of SHARED_ENTRIES[runtime]) {
    const target = join(base, entry), link = join(homeDir, entry);
    const state = classify(target, link);
    if (state === "drift") drift.push(entry);
    else if (state === "absent") { symlinkSync(target, link); linked.push(entry); }
  }
  return { linked, drift };
}

/** Salin `MIRRORED_CLAUDE_KEYS` dari `.claude.json` bawaan ke akun. Tulis atomik, kunci lain utuh. */
export function mirrorClaudeJson(accountHome: string, baseJsonPath: string = baseClaudeJson()): void {
  let base: Record<string, unknown>;
  try { base = JSON.parse(readFileSync(baseJsonPath, "utf8")) as Record<string, unknown>; } catch { return; }
  const path = join(accountHome, ".claude.json");
  let acct: Record<string, unknown> = {};
  try { acct = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { acct = {}; }
  let changed = false;
  for (const k of MIRRORED_CLAUDE_KEYS) {
    if (!(k in base) || JSON.stringify(acct[k]) === JSON.stringify(base[k])) continue;
    acct[k] = base[k];
    changed = true;
  }
  if (!changed) return;
  const tmp = `${path}.hanoman-${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(acct, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/** Persiapan sebelum setiap launch. Drift dilaporkan, tak pernah dilempar. */
export function prepareAccountHome(runtime: RuntimeName, homeDir: string): { linked: string[]; drift: string[] } {
  const r = ensureAccountHome(runtime, homeDir);
  if (runtime === "claude") mirrorClaudeJson(homeDir);
  return r;
}
