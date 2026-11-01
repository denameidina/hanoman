import { homedir } from "node:os";
import { builtinAccountId, runtimeOfBuiltin, zAgent, type RuntimeName } from "@hanoman/shared";
import { agentBin } from "../pty";
import { createOperatorSession } from "../session-launch-gate";
import { prepareAccountHome } from "./home";
import { AccountError, accountSnapshot } from "./registry";
import { accountEnv } from "./resolver";

// ADR-0234 · sesi terminal login punya id deterministik: klik Login kedua menyambung, bukan menumpuk.
// tmux tak menerima ":" di nama sesi, jadi `default:claude` → `default-claude`.
export const LOGIN_PREFIX = "acct-login-";
export const loginSessionId = (accountId: string): string => `${LOGIN_PREFIX}${accountId.replace(/[^a-z0-9]/gi, "-")}`;

export function accountIdForLoginSession(sessionId: string): string | null {
  if (!sessionId.startsWith(LOGIN_PREFIX)) return null;
  const ids = [...zAgent.options.map((r) => builtinAccountId(r)), ...accountSnapshot().rows.map((r) => r.id)];
  return ids.find((id) => loginSessionId(id) === sessionId) ?? null;
}

// ── Perintah & sesi login ───────────────────────────────────────────────────────────────────────

/** ADR-0234 · perintah login dirakit SERVER (pola install metode SPEC-739): klien tak pernah mengirim teks perintah. */
export function loginArgv(runtime: RuntimeName, opts: { deviceAuth?: boolean }): string[] {
  if (runtime === "claude") return [agentBin("claude"), "auth", "login", "--claudeai"];
  if (runtime === "codex") return [agentBin("codex"), "login", ...(opts.deviceAuth ? ["--device-auth"] : [])];
  // Antigravity: mode tukar (antigravity-swap.ts) memasang alurnya sendiri lewat setAntigravityLogin.
  return antigravityLogin(opts);
}

let antigravityLogin = (_opts: { deviceAuth?: boolean }): string[] => {
  throw new AccountError("account-not-found", 404, "login Antigravity belum didukung");
};
export function setAntigravityLogin(fn: (opts: { deviceAuth?: boolean }) => string[]): void { antigravityLogin = fn; }

// Langkah sebelum sesi login agy dibuka (mode tukar: aktifkan slot akun itu). Dipasang saat boot.
let beforeLogin = (_runtime: RuntimeName, _accountId: string): void => {};
export function setBeforeLogin(fn: (runtime: RuntimeName, accountId: string) => void): void { beforeLogin = fn; }

/**
 * Buka sesi terminal login (shell perintah, tanpa agen) di project sintetis `account:<id>` — cermin
 * console VPS `vps-console:<id>`. Exempt dari gerbang kapasitas: ini jendela manusia, bukan agen.
 */
export async function openLoginSession(accountId: string, opts: { deviceAuth?: boolean }): Promise<{ id: string }> {
  const builtin = runtimeOfBuiltin(accountId);
  let runtime: RuntimeName, homeDir: string | null = null, env: Record<string, string> = {};
  if (builtin) runtime = builtin;
  else {
    const row = accountSnapshot().rows.find((r) => r.id === accountId);
    if (!row) throw new AccountError("account-not-found", 404, `akun ${accountId} tak ditemukan`);
    runtime = row.runtime; homeDir = row.homeDir;
    prepareAccountHome(runtime, homeDir);
    env = accountEnv(runtime, homeDir).env;
  }
  const argv = loginArgv(runtime, opts);
  beforeLogin(runtime, accountId);
  const s = await createOperatorSession(`account:${accountId}`, homeDir ?? homedir(), {
    id: loginSessionId(accountId), command: argv, env,
  });
  return { id: s.id };
}
