import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AntigravityLimitsDTO, LimitWindow, LimitSeverity } from "@hanoman/shared";
import { effectiveStr } from "../config";

// ADR-0224 — limit langganan Antigravity CLI (`agy`).
//
// Antigravity TIDAK menulis kuotanya ke disk (beda dari codex, ADR-0074) dan tak punya subcommand
// usage. CLI-nya sendiri mengambil kuota dari Cloud Code API Google
// (`v1internal:retrieveUserQuotaSummary`, terbaca dari `quota_manager.go` di biner `agy` 1.4.2) lalu
// menyimpannya di memori. Pola yang dipakai karena itu cermin limit claude (`services/limits.ts`):
// baca token OAuth HIDUP milik agy, panggil endpoint yang sama dengan yang dipanggil agy, petakan.
//
//   { groups: [{ displayName: "Gemini Models", buckets: [
//       { bucketId: "gemini-weekly", window: "weekly", resetTime: "…Z", remainingFraction: 0.96 },
//       { bucketId: "gemini-5h",     window: "5h",     resetTime: "…Z", remainingFraction: 1 } ] },
//     { displayName: "Claude and GPT models", buckets: [ … ] }] }
//
// Batas yang dinyatakan apa adanya:
// - Endpoint `v1internal` TIDAK didokumentasikan. Bentuk yang tak dikenali → `unavailable`/`stale`,
//   tak pernah angka karangan.
// - Token TIDAK pernah di-refresh di sini: refresh token milik agy, dan memutarnya sendiri bisa
//   me-logout CLI yang sedang jalan (alasan yang sama dengan limit claude). Token akses agy berumur
//   ±1 jam; saat agy tak berjalan token kedaluwarsa dan hasilnya `stale` (data terakhir) atau
//   `unavailable` — tanpa satu pun panggilan jaringan dengan token basi.
// - Sumber token hanya Keychain macOS (go-keyring: service `gemini`, akun `antigravity`). Di platform
//   lain agy memakai secret-service/berkas yang lokasinya belum terverifikasi → `unavailable`.

const QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
// Terukur 2026-10-18: tanpa `antigravity` di User-Agent endpoint menjawab 403 "You do not have a valid
// license of this product" untuk token yang sama yang menjawab 200 bila ada. Nilainya tetap menyebut
// pemanggil sebenarnya — hanoman — alih-alih menyamar sebagai versi agy tertentu.
const USER_AGENT = "antigravity (hanoman)";
// Endpoint internal Google, bukan endpoint kita: lebih jarang dari claude (30 dtk) sudah cukup untuk
// angka yang bergerak per jam/minggu.
const TTL_MS = 60_000;
// Token yang tinggal sesingkat ini dianggap sudah kedaluwarsa — jangan kirim token yang mati di jalan.
const EXPIRY_SKEW_MS = 30_000;

let lastOk: AntigravityLimitsDTO | null = null;
let freshUntil = 0;

const UNAVAILABLE: AntigravityLimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };

export type AgyToken = { accessToken: string; expiry: number | null };
type SecurityRun = (args: string[]) => string;
const securityRun: SecurityRun = (args) =>
  execFileSync("security", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * Token agy dari Keychain. go-keyring menyimpannya sebagai `go-keyring-base64:<base64(JSON)>`
 * dengan bentuk `{ token: { access_token, expiry, … }, … }` (terukur agy 1.4.2, 2026-10-18).
 */
export function readAgyToken(run: SecurityRun = securityRun): AgyToken | null {
  try {
    let raw = run(["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"]).trim();
    const prefix = "go-keyring-base64:";
    if (raw.startsWith(prefix)) raw = Buffer.from(raw.slice(prefix.length), "base64").toString("utf8");
    const tok = (JSON.parse(raw) as { token?: { access_token?: unknown; expiry?: unknown } })?.token;
    if (typeof tok?.access_token !== "string" || !tok.access_token) return null;
    const expiry = typeof tok.expiry === "string" ? Date.parse(tok.expiry) : NaN;
    return { accessToken: tok.access_token, expiry: Number.isFinite(expiry) ? expiry : null };
  } catch { return null; }
}

const agyHome = (): string => join(homedir(), ".gemini", "antigravity-cli");

/** Project Cloud Code default agy — dikirim apa adanya bila ada; endpoint tetap menjawab tanpanya. */
function defaultProject(): string | null {
  try { return readFileSync(join(agyHome(), "cache", "default_project_id.txt"), "utf8").trim() || null; }
  catch { return null; }
}

const severityOf = (pct: number): LimitSeverity =>
  pct >= 90 ? "critical" : pct >= 70 ? "warning" : "normal";

// Label dari `window` milik bucket, bukan dari `bucketId` — id adalah kunci internal Google.
function windowLabel(window: string): string {
  if (window === "5h") return "Sesi 5 jam";
  if (window === "weekly") return "Mingguan";
  return window;
}

// Nama grup dipendekkan supaya muat di popover; nama asli tetap dipakai bila tak dikenali.
function groupLabel(name: string): string {
  if (/^gemini/i.test(name)) return "Gemini";
  if (/claude/i.test(name) && /gpt/i.test(name)) return "Claude/GPT";
  return name;
}

type RawBucket = { bucketId?: string; window?: string; resetTime?: string; remainingFraction?: number };
type RawGroup = { displayName?: string; buckets?: RawBucket[] };

export function mapQuota(json: unknown): LimitWindow[] {
  const groups = (json as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  return (groups as RawGroup[]).flatMap((g) => {
    const group = groupLabel(g.displayName ?? "");
    return (Array.isArray(g.buckets) ? g.buckets : []).flatMap((b): LimitWindow[] => {
      if (typeof b.remainingFraction !== "number" || !b.bucketId) return [];
      const remaining = Math.max(0, Math.min(1, b.remainingFraction));
      const usedPct = Math.round((1 - remaining) * 100);
      const label = windowLabel(b.window ?? "");
      return [{
        key: `antigravity:${b.bucketId}`,
        label: group ? `${group} · ${label}` : label,
        usedPct,
        resetsAt: b.resetTime ?? null,
        severity: severityOf(usedPct),
        // API tak punya padanan `is_active` claude. Yang paling dekat: bucket yang HABIS.
        isActive: remaining === 0,
      }];
    });
  });
}

function fallback(): AntigravityLimitsDTO {
  return lastOk ? { ...lastOk, status: "stale" } : UNAVAILABLE;
}

export type AntigravityLimitsDeps = {
  platform: NodeJS.Platform;
  token: () => AgyToken | null;
  project: () => string | null;
  fetch: typeof fetch;
  now: () => number;
};

const prodDeps: AntigravityLimitsDeps = {
  platform: process.platform,
  // `HANOMAN_ANTIGRAVITY_LIMITS_FETCH=0` mematikan sumbernya sama sekali (cermin
  // `HANOMAN_UPDATE_FETCH`): suite test server berjalan di macOS operator, dan route ini tak boleh
  // membaca Keychain asli lalu memanggil Google dari dalam test.
  token: () => (effectiveStr("HANOMAN_ANTIGRAVITY_LIMITS_FETCH") === "0" ? null : readAgyToken()),
  project: defaultProject,
  fetch: (...a) => fetch(...a),
  now: Date.now,
};

async function fetchQuota(deps: AntigravityLimitsDeps): Promise<AntigravityLimitsDTO> {
  if (deps.platform !== "darwin") return fallback();
  const tok = deps.token();
  if (!tok) return fallback();
  if (tok.expiry !== null && tok.expiry - EXPIRY_SKEW_MS <= deps.now()) return fallback();
  const project = deps.project();
  try {
    const res = await deps.fetch(QUOTA_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tok.accessToken}`, "content-type": "application/json", "user-agent": USER_AGENT,
      },
      body: JSON.stringify(project ? { project } : {}),
      // Endpoint yang menggantung tak boleh menumpuk koneksi di bawah siar 30 dtk (SPEC-197).
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallback();
    const windows = mapQuota(await res.json());
    if (!windows.length) return fallback();
    const dto: AntigravityLimitsDTO = {
      status: "ok", windows, fetchedAt: new Date(deps.now()).toISOString(),
    };
    lastOk = dto;
    return dto;
  } catch { return fallback(); }
}

export async function getAntigravityLimits(deps: AntigravityLimitsDeps = prodDeps): Promise<AntigravityLimitsDTO> {
  if (lastOk && deps.now() < freshUntil) return lastOk;
  const dto = await fetchQuota(deps);
  if (dto.status === "ok") freshUntil = deps.now() + TTL_MS;
  return dto;
}

// Untuk test: bersihkan cache & fallback antar kasus.
export function _resetAntigravityLimitsCache(): void { lastOk = null; freshUntil = 0; }
