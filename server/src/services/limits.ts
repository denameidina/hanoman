import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import type { LimitsDTO, LimitWindow, LimitSeverity } from "@hanoman/shared";
import { effectiveStr } from "../config";

// Sumber limit realtime = endpoint OAuth yang sama dengan `/usage` Claude Code. hanoman tidak
// memparse output terminal claude (ADR-0024): ia membaca token hidup Claude Code dan memanggil
// endpoint ini sendiri. Respons punya array `limits[]` bersih — itulah yang dipetakan.
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TTL_MS = 30_000;

// `lastOk` bertahan lintas kegagalan untuk fallback `stale`; `freshUntil` menjaga TTL cache
// (dedup multi-tab). Refresh token TIDAK pernah kita putar sendiri — rotating/single-use, dan
// memutar sendiri akan me-logout sesi claude yang sedang jalan. Kita hanya membaca.
let lastOk: LimitsDTO | null = null;
let freshUntil = 0;

const LABELS: Record<string, string> = {
  session: "Sesi 5 jam", weekly_all: "Mingguan", weekly_scoped: "Mingguan",
};
const humanize = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const nowIso = () => new Date().toISOString();

function credsFile(): string {
  return join(effectiveStr("CLAUDE_CONFIG_DIR") ?? join(homedir(), ".claude"), ".credentials.json");
}

type SecurityRun = (args: string[]) => string;
const securityRun: SecurityRun = (args) =>
  execFileSync("security", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const osAccount = (): string | null => {
  try { return userInfo().username || null; } catch { return null; }
};

/**
 * Token dari Keychain macOS. Entri milik akun user DULU, baru entri tanpa `-a`: terukur 2026-09-23
 * (claude 2.1.280) Keychain memuat dua entri `Claude Code-credentials` — akun `unknown` dengan
 * accessToken kosong dan akun user macOS dengan token hidup — dan `-s` saja memilih yang pertama.
 * Token kosong tak pernah dikembalikan: ia berarti "coba sumber berikutnya", bukan "tak login".
 */
export function keychainAccessToken(run: SecurityRun = securityRun, account = osAccount()): string | null {
  const base = ["find-generic-password", "-s", "Claude Code-credentials"];
  for (const scope of account ? [["-a", account], []] : [[]]) {
    try {
      const tok: unknown = JSON.parse(run([...base, ...scope, "-w"]))?.claudeAiOauth?.accessToken;
      if (typeof tok === "string" && tok) return tok;
    } catch { /* entri tak ada / bukan JSON → sumber berikutnya */ }
  }
  return null;
}

// Keychain dulu (macOS tanpa CLAUDE_CONFIG_DIR eksplisit — di mesin dev berkasnya kedaluwarsa,
// token hidup ada di Keychain), lalu berkas (Linux/prod, atau CLAUDE_CONFIG_DIR di-set = seam test).
function readAccessToken(): string | null {
  if (process.platform === "darwin" && !effectiveStr("CLAUDE_CONFIG_DIR")) {
    const tok = keychainAccessToken();
    if (tok) return tok;
  }
  try {
    return JSON.parse(readFileSync(credsFile(), "utf8"))?.claudeAiOauth?.accessToken ?? null;
  } catch { return null; }
}

function normalizeSeverity(s: unknown, pct: number): LimitSeverity {
  if (s === "normal" || s === "warning" || s === "critical") return s;
  return pct >= 90 ? "critical" : pct >= 70 ? "warning" : "normal";
}

type RawLimit = {
  kind?: string; percent?: number; severity?: string; resets_at?: string | null;
  is_active?: boolean; scope?: { model?: { display_name?: string } } | null;
};

function mapWindows(json: unknown): LimitWindow[] {
  const arr = (json as { limits?: unknown } | null)?.limits;
  if (!Array.isArray(arr)) return [];
  return (arr as RawLimit[]).map((l) => {
    const kind = l.kind ?? "unknown";
    const model = l.scope?.model?.display_name;
    const usedPct = Math.round(l.percent ?? 0);
    const base = LABELS[kind] ?? humanize(kind);
    return {
      key: model ? `${kind}:${model}` : kind,
      label: model ? `${base} ${model}` : base,
      usedPct,
      resetsAt: l.resets_at ?? null,
      severity: normalizeSeverity(l.severity, usedPct),
      isActive: !!l.is_active,
    };
  });
}

function fallback(): LimitsDTO {
  return lastOk ? { ...lastOk, status: "stale" }
                : { status: "unavailable", windows: [], fetchedAt: null };
}

async function fetchUsage(): Promise<LimitsDTO> {
  const token = readAccessToken();
  if (!token) return fallback();
  try {
    const res = await fetch(USAGE_URL, {
      headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
      // SPEC-197 · tanpa timeout, endpoint yang menggantung menahan request ~300s dan poll 60s
      // menumpuk koneksi. AbortError ditangkap catch di bawah → fallback (stale/unavailable).
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallback();
    const dto: LimitsDTO = { status: "ok", windows: mapWindows(await res.json()), fetchedAt: nowIso() };
    lastOk = dto;
    return dto;
  } catch { return fallback(); }
}

export async function getLimits(): Promise<LimitsDTO> {
  if (lastOk && Date.now() < freshUntil) return lastOk;
  const dto = await fetchUsage();
  if (dto.status === "ok") freshUntil = Date.now() + TTL_MS;
  return dto;
}

// Untuk test: bersihkan cache & fallback antar kasus.
export function _resetLimitsCache(): void { lastOk = null; freshUntil = 0; }
