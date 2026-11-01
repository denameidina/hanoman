import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

export type SecurityRun = (args: string[], input?: string) => string;
export const securityRun: SecurityRun = (args, input) =>
  execFileSync("security", args, {
    encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
  });

export const osAccount = (): string | null => {
  try { return userInfo().username || null; } catch { return null; }
};

/**
 * ADR-0234 · nama service Keychain Claude Code untuk `CLAUDE_CONFIG_DIR` non-bawaan: suffix 8 hex
 * pertama sha256 dari path config dir (terverifikasi spike ADR-0234). Config dir bawaan memakai
 * `Claude Code-credentials` tanpa suffix (`services/limits.ts`).
 */
export function claudeKeychainService(configDir: string): string {
  return `Claude Code-credentials-${createHash("sha256").update(configDir).digest("hex").slice(0, 8)}`;
}

/**
 * Token akses dari satu service Keychain. Entri milik akun user DULU, baru tanpa `-a` (terukur
 * 2026-09-23: Keychain bisa memuat entri akun `unknown` ber-token kosong). Token kosong = sumber berikutnya.
 */
export function readClaudeKeychainToken(service: string, run: SecurityRun = securityRun, account: string | null = osAccount()): string | null {
  const base = ["find-generic-password", "-s", service];
  for (const scope of account ? [["-a", account], []] : [[]]) {
    try {
      const tok: unknown = JSON.parse(run([...base, ...scope, "-w"]))?.claudeAiOauth?.accessToken;
      if (typeof tok === "string" && tok) return tok;
    } catch { /* entri tak ada / bukan JSON */ }
  }
  return null;
}

/** Hapus SEMUA entri service itu (bisa >1: akun `unknown` + akun user). Diam bila tak ada. */
export function deleteClaudeKeychainEntry(service: string, run: SecurityRun = securityRun): void {
  for (let i = 0; i < 4; i++) {
    try { run(["delete-generic-password", "-s", service]); } catch { return; }
  }
}
