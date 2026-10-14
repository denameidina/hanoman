import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { agentEnvironment, resolveHardening } from "@hanoman/runner";
import type { AntigravityVersionInfo } from "@hanoman/shared";
import { antigravityBin } from "./antigravity-runtime";
import { assertAntigravityLaunch } from "./session-sandbox";

const run = promisify(execFile);
const TTL_MS = 5 * 60_000;
const unavailable = (error: string): AntigravityVersionInfo => ({ version: null, error });
const CHANGED = "Konfigurasi runtime berubah; periksa versi kembali.";

/** agy --version emits a complete semver, not a diagnostic with embedded version numbers. */
export function parseAntigravityVersion(output: string): string | null {
  const version = output.trim();
  const numeric = "(?:0|[1-9]\\d*)";
  const identifier = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
  const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
  return semver.test(version) ? version : null;
}

export async function probeAntigravityVersion(
  bin = antigravityBin(), env: NodeJS.ProcessEnv = process.env,
): Promise<AntigravityVersionInfo> {
  try { assertAntigravityLaunch("antigravity", undefined, env); }
  catch { return unavailable("Antigravity CLI hanya tersedia pada host/lab; sandbox belum didukung."); }
  try {
    const { stdout } = await run(bin, ["--version"], {
      env: agentEnvironment("antigravity", env), timeout: 10_000, maxBuffer: 16 * 1024,
      killSignal: "SIGKILL", encoding: "utf8",
    });
    const version = parseAntigravityVersion(stdout);
    return version === null ? unavailable("Keluaran versi Antigravity tidak dikenali.") : { version, error: null };
  } catch (error) {
    const failure = error as { code?: string; killed?: boolean };
    if (failure.code === "ENOENT") return unavailable("Biner Antigravity tidak ditemukan.");
    if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return unavailable("Keluaran versi Antigravity melebihi batas ukuran.");
    if (failure.killed) return unavailable("Pemeriksaan versi Antigravity melewati batas waktu.");
    return unavailable("Versi Antigravity tidak dapat diperiksa.");
  }
}

function versionProbeKey(): string {
  return JSON.stringify([antigravityBin(), process.env.HANOMAN_SESSION_SANDBOX ?? "off", resolveHardening(process.env)]);
}

type VersionDependencies = {
  key?: () => string;
  now?: () => number;
  probe?: () => Promise<AntigravityVersionInfo>;
};

export function createAntigravityVersionService(deps: VersionDependencies = {}): () => Promise<AntigravityVersionInfo> {
  const key = deps.key ?? versionProbeKey;
  const now = deps.now ?? Date.now;
  const probe = deps.probe ?? probeAntigravityVersion;
  let currentKey: string | undefined, generation = 0;
  let cache: { at: number; info: AntigravityVersionInfo } | undefined;
  let pending: Promise<AntigravityVersionInfo> | undefined;
  return () => {
    const nextKey = key();
    if (nextKey !== currentKey) {
      currentKey = nextKey; generation++; cache = undefined; pending = undefined;
    }
    if (cache && now() - cache.at < TTL_MS) return Promise.resolve(cache.info);
    if (pending) return pending;
    const startedGeneration = generation;
    const request = probe().catch(() => unavailable("Versi Antigravity tidak dapat diperiksa.")).then((info) => {
      // Check config at completion too: it may change before another reader arrives.
      if (startedGeneration !== generation || key() !== nextKey) return unavailable(CHANGED);
      cache = { at: now(), info };
      return info;
    }).finally(() => {
      if (pending === request) pending = undefined;
    });
    pending = request;
    return request;
  };
}

export const antigravityVersionInfo = createAntigravityVersionService();
