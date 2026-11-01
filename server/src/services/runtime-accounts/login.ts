import { builtinAccountId, zAgent } from "@hanoman/shared";
import { accountSnapshot } from "./registry";

// ADR-0234 · sesi terminal login punya id deterministik: klik Login kedua menyambung, bukan menumpuk.
// tmux tak menerima ":" di nama sesi, jadi `default:claude` → `default-claude`.
export const LOGIN_PREFIX = "acct-login-";
export const loginSessionId = (accountId: string): string => `${LOGIN_PREFIX}${accountId.replace(/[^a-z0-9]/gi, "-")}`;

export function accountIdForLoginSession(sessionId: string): string | null {
  if (!sessionId.startsWith(LOGIN_PREFIX)) return null;
  const ids = [...zAgent.options.map((r) => builtinAccountId(r)), ...accountSnapshot().rows.map((r) => r.id)];
  return ids.find((id) => loginSessionId(id) === sessionId) ?? null;
}
