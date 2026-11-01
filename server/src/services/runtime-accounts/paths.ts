import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { agentSkillHome, resolveHome } from "@hanoman/runner";
import type { RuntimeName } from "@hanoman/shared";

// ADR-0234 · semua home akun di bawah `$HANOMAN_HOME/accounts` — satu batas backup/restore bersama
// data hanoman lain (SPEC-846), dan satu akar yang boleh dihapus `deleteAccount`.
export const accountsRoot = (env: NodeJS.ProcessEnv = process.env): string => join(resolveHome(env), "accounts");

export const accountHomeDir = (runtime: RuntimeName, id: string, env: NodeJS.ProcessEnv = process.env): string =>
  join(accountsRoot(env), runtime, id);

/** Home bawaan CLI = sumber aset bersama. Sama dengan akar skill (`HANOMAN_*_HOME` menang, ADR-0114). */
export const baseHome = (runtime: RuntimeName, env: NodeJS.ProcessEnv = process.env): string =>
  agentSkillHome(runtime, env);

/** `.claude.json` akun bawaan ada di HOME (bukan `~/.claude`) kecuali config dir di-override. */
export function baseClaudeJson(env: NodeJS.ProcessEnv = process.env, osHome: string = homedir()): string {
  const own = env.HANOMAN_CLAUDE_HOME?.trim() || env.CLAUDE_CONFIG_DIR?.trim();
  return own ? join(own, ".claude.json") : join(osHome, ".claude.json");
}

/** Penjaga hapus: hanya path DI DALAM `accountsRoot` yang boleh di-`rm -rf`. */
export function insideAccountsRoot(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolve(path).startsWith(resolve(accountsRoot(env)) + sep);
}
