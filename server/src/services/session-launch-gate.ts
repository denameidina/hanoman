import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus, loadavg, platform } from "node:os";
import { promisify } from "node:util";
import { createSession, listPanesAsync, sessionIdForSpec, type CreateOpts, type SessionInfo } from "./pty";
import { getScheduler } from "./scheduler/config";
import { createLaunchGate, launchStatus, type HostLoad, type LaunchPane } from "./session-admission";
import type { Scheduler } from "@hanoman/shared";

const execFileAsync = promisify(execFile);

// ADR-0170 · `os.freemem()` sengaja TIDAK dipakai (ADR-0161 "Alternatif yang ditolak" —
// haram di macOS: hanya menghitung halaman benar-benar bebas, mengabaikan purgeable/compressor,
// menjawab ~146 MB pada mesin sehat 57% bebas). darwin: kern.memorystatus_level sudah persentase
// 0–100 siap pakai. linux: MemAvailable/MemTotal dari /proc/meminfo (kernel sudah memperhitungkan
// reclaimable cache — padanan darwin yang benar). Platform lain: null, gerbang tak berpendapat.
async function readMemAvailablePct(): Promise<number | null> {
  try {
    if (platform() === "darwin") {
      const { stdout } = await execFileAsync("sysctl", ["-n", "kern.memorystatus_level"]);
      const pct = Number(stdout.trim());
      return Number.isFinite(pct) ? pct : null;
    }
    if (platform() === "linux") {
      const meminfo = await readFile("/proc/meminfo", "utf8");
      const total = Number(/^MemTotal:\s+(\d+)/m.exec(meminfo)?.[1]);
      const available = Number(/^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1]);
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(available)) return null;
      return (available / total) * 100;
    }
    return null;
  } catch { return null; }
}

// Cache singkat: gerbang jalan tiap peluncuran, bukan tiap event — spawn per event (sysctl/read
// meminfo) menambah lag tepat di jalur yang menawar lag (ADR-0161 keputusan #7).
const MEM_CACHE_MS = 5_000;
let memCache: { at: number; pending: Promise<number | null> } | null = null;
function cachedMemAvailablePct(): Promise<number | null> {
  const now = Date.now();
  if (!memCache || now - memCache.at >= MEM_CACHE_MS) memCache = { at: now, pending: readMemAvailablePct() };
  return memCache.pending;
}

export const readHostLoad = async (): Promise<HostLoad> => ({
  platform: platform(), loadAverage: loadavg()[0] ?? NaN, cores: cpus().length,
  memAvailablePct: await cachedMemAvailablePct(),
});
const gate = createLaunchGate({
  listPanes: () => listPanesAsync(), config: () => getScheduler(), host: () => readHostLoad(),
});
export const withSessionAdmission = gate.run;
export const currentLaunchStatus = async (panes: LaunchPane[], config: Scheduler) =>
  launchStatus(panes, config, await readHostLoad());

export async function createAgentSession(
  projectId: string, cwd: string, opts: CreateOpts = {},
): Promise<SessionInfo & { reused?: true }> {
  const id = opts.id ?? (opts.specId ? sessionIdForSpec(opts.specId) : undefined);
  return withSessionAdmission({ id }, async () => createSession(projectId, cwd, opts),
    (pane) => ({ ...pane, reused: true as const }));
}

export async function createOperatorSession(
  projectId: string, cwd: string, opts: CreateOpts = {},
  // ADR-0170 · `exempt` default true (shell mentah/console VPS: ADR-0161 amandemen
  // SPEC-1108 — terminal adalah satu-satunya jendela diagnosis operator, tak pernah ditolak).
  // Terminal AGEN ("Sesi baru" bukan shell, terminal.ts:372) memasok `exempt:false` supaya
  // ikut gerbang cap/beban seperti sesi terstruktur lain; `force` tetap milik jalur manusia.
  admission: { exempt?: boolean; force?: boolean } = {},
): Promise<SessionInfo> {
  return withSessionAdmission({ id: opts.id, exempt: admission.exempt ?? true, force: admission.force },
    async () => createSession(projectId, cwd, opts), (pane) => pane);
}
