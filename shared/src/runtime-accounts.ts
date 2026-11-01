import { z } from "zod";
import { zAgent } from "./enums";
import type { LimitsDTO } from "./dto";

// ADR-0234 · multi-akun runtime. Satu "akun runtime" = satu login langganan claude/codex/antigravity
// di mesin ini. Akun bawaan (home bawaan CLI) TIDAK punya baris DB: id tetap `default:<runtime>`.
export type RuntimeName = z.infer<typeof zAgent>;

export const RUNTIME_ACCOUNT_STATUSES = ["belum-login", "aktif", "perlu-login-ulang"] as const;
export type RuntimeAccountStatus = (typeof RUNTIME_ACCOUNT_STATUSES)[number];

export const BUILTIN_ACCOUNT_PREFIX = "default:";
export const BUILTIN_ACCOUNT_LABEL = "Default";
export const builtinAccountId = (runtime: RuntimeName): string => `${BUILTIN_ACCOUNT_PREFIX}${runtime}`;
export const isBuiltinAccountId = (id: string): boolean => id.startsWith(BUILTIN_ACCOUNT_PREFIX);
export function runtimeOfBuiltin(id: string): RuntimeName | null {
  if (!isBuiltinAccountId(id)) return null;
  const r = zAgent.safeParse(id.slice(BUILTIN_ACCOUNT_PREFIX.length));
  return r.success ? r.data : null;
}

export const zAccountId = z.string().min(1).max(80);
export const zAccountLabel = z.string().trim().min(1).max(40);
export const zRuntimeAccountCreate = z.object({ runtime: zAgent, label: zAccountLabel }).strict();
export const zRuntimeAccountPatch = z.object({ label: zAccountLabel }).strict();
export const zRuntimeAccountDefault = z.object({ runtime: zAgent, accountId: zAccountId }).strict();
export const zRuntimeAccountLogin = z.object({ deviceAuth: z.boolean().optional() }).strict();

/** `Setting.accounts` — default akun per runtime, LOCAL per mesin. Absen = akun bawaan. */
export const zRuntimeAccountDefaults = z.object({
  claude: zAccountId.optional(), codex: zAccountId.optional(), antigravity: zAccountId.optional(),
});
export type RuntimeAccountDefaults = z.infer<typeof zRuntimeAccountDefaults>;

export type RuntimeAccountIdentity = { email?: string; plan?: string };

/** Satu akun di `GET /api/runtime-accounts`. Memuat email → di balik `settings:read`, BUKAN GLOBAL_READ. */
export type RuntimeAccountDTO = {
  id: string; runtime: RuntimeName; label: string; builtin: boolean; isDefault: boolean;
  status: RuntimeAccountStatus; identity: RuntimeAccountIdentity | null;
  /** Entri bersama yang sudah bukan symlink ke home bawaan. Kosong = sehat. */
  drift: string[];
  createdAt: string | null; lastLoginAt: string | null;
};
export type RuntimeAccountsListDTO = { accounts: RuntimeAccountDTO[]; sandbox: boolean };

/** Limit satu akun. SENGAJA tanpa email: `/limits/*` GLOBAL_READ (terbaca setiap agent token). */
export type AccountLimitsDTO = {
  accountId: string; runtime: RuntimeName; label: string; builtin: boolean; isDefault: boolean;
  loginStatus: RuntimeAccountStatus; limits: LimitsDTO;
};

export const ACCOUNT_ERROR_CODES = [
  "account-not-found", "account-runtime-mismatch", "account-not-logged-in", "antigravity-account-busy",
  "account-in-use", "account-label-taken", "account-sandbox-unsupported",
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];
