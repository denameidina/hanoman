import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountLimitsDTO, LimitWindow, LimitsDTO } from "@hanoman/shared";
import { effectiveStr } from "../../config";
import { fetchClaudeWindows, getLimits } from "../limits";
import { getCodexLimits } from "../codex-limits";
import { getAntigravityLimits } from "../antigravity-limits";
import { claudeKeychainService, readClaudeKeychainToken } from "./keychain";
import { accountSnapshot, listAccountDTOs, type AccountRow } from "./registry";

// ADR-0234 · limit per akun runtime. Sumbernya SAMA dengan limit bawaan (usage API claude, rollout codex,
// quota API agy), hanya diarahkan ke kredensial/home akun. Tak pernah me-refresh token: akun menganggur
// → token kedaluwarsa → `stale` (data terakhir) atau `unavailable`. Akun bawaan memakai service lama
// apa adanya (cache & fallback-nya sendiri).
const TTL_MS = 30_000;
const UNAVAILABLE: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };

export type AccountLimitsDeps = {
  now: () => number;
  /** `HANOMAN_ACCOUNT_LIMITS_FETCH=0` mematikan semua bacaan akun non-bawaan (suite test di macOS operator). */
  fetchEnabled: boolean;
  builtin: { claude: () => Promise<LimitsDTO>; codex: () => Promise<LimitsDTO>; antigravity: () => Promise<LimitsDTO> };
  claudeToken: (homeDir: string) => string | null;
  claudeWindows: (token: string) => Promise<LimitWindow[] | null>;
  codexLimits: (sessionsDir: string) => Promise<LimitsDTO>;
  antigravity: (row: AccountRow) => Promise<LimitsDTO>;
};

export function readClaudeAccountToken(homeDir: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "darwin") {
    const t = readClaudeKeychainToken(claudeKeychainService(homeDir));
    if (t) return t;
  }
  try {
    const t: unknown = JSON.parse(readFileSync(join(homeDir, ".credentials.json"), "utf8"))?.claudeAiOauth?.accessToken;
    return typeof t === "string" && t ? t : null;
  } catch { return null; }
}

let antigravityAccount = async (_row: AccountRow): Promise<LimitsDTO> => UNAVAILABLE;
let antigravityBuiltin = (): Promise<LimitsDTO> => getAntigravityLimits();
/** Mode tukar agy memasang pembaca limit slot (akun terdaftar) dan akun bawaan saat akun lain aktif. */
export function setAntigravityAccountLimits(account: (row: AccountRow) => Promise<LimitsDTO>, builtin?: () => Promise<LimitsDTO>): void {
  antigravityAccount = account;
  if (builtin) antigravityBuiltin = builtin;
}

const prodDeps = (): AccountLimitsDeps => ({
  now: Date.now,
  fetchEnabled: effectiveStr("HANOMAN_ACCOUNT_LIMITS_FETCH") !== "0",
  builtin: { claude: getLimits, codex: () => getCodexLimits(), antigravity: () => antigravityBuiltin() },
  claudeToken: (h) => readClaudeAccountToken(h),
  claudeWindows: (t) => fetchClaudeWindows(t),
  codexLimits: (d) => getCodexLimits(d),
  antigravity: (row) => antigravityAccount(row),
});

type Entry = { last: LimitsDTO; freshUntil: number };
const cache = new Map<string, Entry>();
export function _resetAccountLimitsCache(): void { cache.clear(); }

async function cached(key: string, now: number, load: () => Promise<LimitsDTO>): Promise<LimitsDTO> {
  const e = cache.get(key);
  if (e && now < e.freshUntil) return e.last;
  const dto = await load();
  if (dto.status !== "unavailable") { cache.set(key, { last: dto, freshUntil: now + TTL_MS }); return dto; }
  return e ? { ...e.last, status: "stale" } : dto;
}

async function loadRow(row: AccountRow, d: AccountLimitsDeps): Promise<LimitsDTO> {
  if (row.runtime === "claude") {
    const tok = d.claudeToken(row.homeDir);
    if (!tok) return UNAVAILABLE;
    const windows = await d.claudeWindows(tok);
    return windows ? { status: "ok", windows, fetchedAt: new Date(d.now()).toISOString() } : UNAVAILABLE;
  }
  if (row.runtime === "codex") {
    const c = await d.codexLimits(join(row.homeDir, "sessions"));
    return { status: c.status, windows: c.windows, fetchedAt: c.fetchedAt };
  }
  return d.antigravity(row);
}

export async function getAccountLimits(deps: AccountLimitsDeps = prodDeps()): Promise<AccountLimitsDTO[]> {
  const rows = new Map(accountSnapshot().rows.map((r) => [r.id, r]));
  return Promise.all(listAccountDTOs().map(async (a): Promise<AccountLimitsDTO> => {
    let limits: LimitsDTO;
    const row = rows.get(a.id);
    if (a.builtin) {
      const b = await deps.builtin[a.runtime]();
      limits = { status: b.status, windows: b.windows, fetchedAt: b.fetchedAt };
    } else if (!deps.fetchEnabled || !row) limits = UNAVAILABLE;
    else limits = await cached(a.id, deps.now(), () => loadRow(row, deps));
    return { accountId: a.id, runtime: a.runtime, label: a.label, builtin: a.builtin, isDefault: a.isDefault, loginStatus: a.status, limits };
  }));
}
