import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cmpVersion } from "@hanoman/shared";
import { codexNativeVersionProbe } from "@hanoman/runner";
import { effectiveStr } from "../config";

// Perbandingan versi tinggal di shared supaya server & web tak pernah berbeda pendapat; di-ekspor
// ulang di sini karena ia bagian dari permukaan service ini.
export { cmpVersion };

const run = promisify(execFile);

// SPEC-339 · GPT-5.6 (sol/terra/luna) baru muncul di manifest untuk klien >= 0.144.0. Manifest
// disaring DI SISI SERVER berdasarkan versi klien, jadi CLI lama tak melihat model-model itu sama
// sekali — bukan soal langganan, murni gerbang versi. `max` pun baru ada di enum effort 0.144+.
export const CODEX_MIN_CLIENT = "0.144.0";

// TTL, bukan cache selamanya: mesin yang baru di-upgrade harus berhenti diperingatkan tanpa perlu
// restart server, sementara 5 menit cukup panjang agar endpoint tak men-spawn proses tiap render.
const TTL_MS = 5 * 60_000;
let cache: { at: number; version: string | null } | null = null;

const codexBin = (): string => effectiveStr("HANOMAN_CODEX_BIN") ?? "codex";

type VersionRunner = (bin: string, args: string[]) => Promise<{ stdout: string }>;
const runVersion: VersionRunner = async (bin, args) => {
  const { stdout } = await run(bin, args, { timeout: 10_000 });
  return { stdout };
};

/** Probe the host or Podman image according to the actual session execution boundary. */
export async function probeCodexVersion(
  env: NodeJS.ProcessEnv = process.env,
  execute: VersionRunner = runVersion,
): Promise<string | null> {
  const probe = codexNativeVersionProbe(env, codexBin());
  try { return parseCodexVersion((await execute(probe.bin, probe.args)).stdout); }
  catch { return null; }
}

/** Ambil `X.Y.Z` pertama dari keluaran `codex --version` (mis. "codex-cli 0.145.0"). */
export function parseCodexVersion(out: string): string | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(out);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/**
 * Versi codex CLI terpasang, atau `null` bila biner tak ada / tak bisa dijalankan / keluarannya
 * tak dikenali. Gagal-diam: ini observabilitas, bukan gerbang — kegagalannya tak boleh membuat
 * endpoint 500 apalagi menghalangi kelahiran sesi.
 */
export async function getCodexVersion(now = Date.now()): Promise<string | null> {
  if (cache && now - cache.at < TTL_MS) return cache.version;
  const version = await probeCodexVersion();
  cache = { at: now, version };
  return version;
}

/**
 * `ok` = false HANYA bila versi benar-benar terdeteksi DAN lebih rendah dari minimum. `version`
 * null → `ok` true: ketiadaan bukti bukan bukti ketiadaan, dan peringatan palsu lebih merusak
 * kepercayaan pada indikator daripada tak ada indikator sama sekali.
 */
export async function codexVersionInfo(): Promise<{ version: string | null; minRequired: string; ok: boolean }> {
  const version = await getCodexVersion();
  return {
    version,
    minRequired: CODEX_MIN_CLIENT,
    ok: version === null || cmpVersion(version, CODEX_MIN_CLIENT) >= 0,
  };
}

/** Untuk test: kosongkan cache antar kasus. */
export function _resetCodexVersionCache(): void { cache = null; }
