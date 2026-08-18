import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemver, UPDATE_RESTART_EXIT, type UpdateStatus, type UpdateRegistryStatus } from "@hanoman/shared";
import { effectiveStr, effectiveBool, effectiveInt } from "../config";

// SPEC-398 · ADR-0087 · hanoman didistribusikan sebagai paket npm global, jadi "ada update?" adalah
// perbandingan SEMVER dengan registry — bukan lagi `git fetch` + hitung commit (SPEC-214), yang tak
// punya arti apa pun di instalasi `npm i -g` (tak ada repo git di sana).
// Tetap READ-ONLY: server tak pernah memasang apa pun (ADR-0048). `hanoman update` di CLI yang
// melakukannya, karena instance yang me-`npm i` dirinya sendiri lalu keluar akan memutus sesi tmux
// yang sedang berjalan tanpa peringatan.
// Cermin INSTALL_ARGS di cli/src/commands/update.ts — `--prefer-online` supaya `@latest` tak
// diselesaikan dari packument cache yang basi (lihat komentarnya di sana).
export const UPDATE_COMMAND = "npm i -g hanoman@latest --prefer-online";

export type UpdateInputs = {
  currentVersion: string;
  latestVersion: string | null;
  registryStatus: UpdateRegistryStatus;
  checkedAt: string | null;
  canApply: boolean;
};

// Murni & deterministik: seluruh keputusan "update tersedia?" ada di sini, terpisah dari jaringan.
export function composeUpdate(x: UpdateInputs): UpdateStatus {
  const available = x.registryStatus === "ok" && x.latestVersion != null
    && compareSemver(x.latestVersion, x.currentVersion) > 0;
  return {
    currentVersion: x.currentVersion,
    latestVersion: x.latestVersion,
    registry: { status: x.registryStatus, checkedAt: x.checkedAt },
    updateAvailable: available,
    command: available ? UPDATE_COMMAND : "",
    // Diwariskan apa adanya. Ia fakta tentang cara proses ini dilahirkan, bukan kesimpulan
    // tentang ada-tidaknya update — menurunkannya dari `available` akan menyembunyikan
    // instalasi tak-tersupervisi tepat saat tombolnya paling ingin ditekan.
    canApply: x.canApply,
  };
}

const RESULT_TTL_MS = 15_000;
const FETCH_TTL_MS = 5 * 60_000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

let cached: { at: number; value: UpdateStatus } | null = null;
let lastFetchAt = 0;
let lastLatest: string | null = null;
let lastStatus: UpdateRegistryStatus = "unavailable";

// Versi yang sedang jalan: dist/build-info.json (ditanam scripts/stamp-build.mjs), lalu
// package.json paket. Absen keduanya → "0.0.0" (dev): compareSemver tetap aman.
export function runningVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [resolve(here, "build-info.json"), resolve(here, "../package.json")]) {
    try {
      const v = (JSON.parse(readFileSync(p, "utf8")) as { version?: unknown }).version;
      if (typeof v === "string" && v) return v;
    } catch { /* lanjut ke kandidat berikutnya */ }
  }
  return "0.0.0";
}

/**
 * SPEC-405 · ADR-0088 · apakah proses server ini punya yang akan menghidupkannya lagi?
 *
 * Dibaca LANGSUNG dari `process.env`, BUKAN lewat `effectiveBool()`: ini fakta tentang cara
 * proses ini dilahirkan, bukan setelan. `effectiveBool` membaca cache config DB lebih dulu, jadi
 * memakainya berarti siapa pun yang bisa menulis config bisa mengaku disupervisi — dan tombolnya
 * lalu mematikan instance yang tak akan pernah hidup lagi.
 */
export function supervised(): boolean {
  const v = process.env.HANOMAN_SUPERVISOR;
  return v === "1" || v === "true";
}

let exiter: ((code: number) => void) | null = null;

/** Test-only: ganti (atau `null` untuk mengembalikan) cara proses ini keluar. */
export function __setExiter(fn: ((code: number) => void) | null): void { exiter = fn; }

/**
 * Menjadwalkan keluarnya proses dengan kode sentinel. Jeda kecil supaya respons `202` benar-benar
 * ter-flush sebelum prosesnya hilang.
 *
 * Ini BUKAN graceful shutdown, dan tak perlu: proses ini memang sedang menunggu ditimpa di disk,
 * dan tmux (ADR-0016) adalah daemon terpisah — pane beserta agen di dalamnya tak tersentuh.
 */
export function requestRestartForUpdate(): void {
  const delay = effectiveInt("HANOMAN_UPDATE_RESTART_DELAY_MS") ?? 250;
  setTimeout(() => (exiter ?? ((c: number) => process.exit(c)))(UPDATE_RESTART_EXIT), delay);
}

// Jaringan HANYA di sini, dan hanya bila opt-in (knob HANOMAN_UPDATE_FETCH; test memaksa "0").
async function maybeFetch(): Promise<void> {
  if (!effectiveBool("HANOMAN_UPDATE_FETCH")) return;
  if (lastFetchAt && Date.now() - lastFetchAt < FETCH_TTL_MS) return;
  lastFetchAt = Date.now();
  const base = (effectiveStr("HANOMAN_NPM_REGISTRY") ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/hanoman/latest`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { lastStatus = "unavailable"; lastLatest = null; return; }
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version === "string" && body.version) { lastLatest = body.version; lastStatus = "ok"; }
    else { lastStatus = "unavailable"; lastLatest = null; }
  } catch { lastStatus = "unavailable"; lastLatest = null; }
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return cached.value;
  await maybeFetch();
  const value = composeUpdate({
    currentVersion: runningVersion(),
    latestVersion: lastLatest,
    registryStatus: lastStatus,
    checkedAt: lastFetchAt ? new Date(lastFetchAt).toISOString() : null,
    canApply: supervised(),
  });
  cached = { at: Date.now(), value };
  return value;
}

export function _resetUpdateCache(): void {
  cached = null; lastFetchAt = 0; lastLatest = null; lastStatus = "unavailable";
}

/** Test-only: pasang snapshot registry tanpa jaringan (fetch tetap ter-gate & tak ditembak). */
export function __setRegistrySnapshot(latest: string | null, status: UpdateRegistryStatus): void {
  lastLatest = latest; lastStatus = status; lastFetchAt = Date.now(); cached = null;
}
