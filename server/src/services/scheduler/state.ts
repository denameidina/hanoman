import type { SchedulerStateView } from "@hanoman/shared";
import { listSessionsAsync } from "../pty";
import { getScheduler } from "./config";
import { getLastRun } from "./registry";
import { listQueue, queueCounts } from "./queue";

// SPEC-908 · satu definisi untuk GET /scheduler/state dan topik siar `schedulerState`.
// `listSessionsAsync`, BUKAN `listSessions`: hub berbagi event loop dengan PTY terminal dan
// `execFileSync` tmux memblokirnya (terukur sampai 916 ms saat mesin sibuk — SPEC-479/812).
export async function buildSchedulerState(): Promise<SchedulerStateView> {
  const cfg = await getScheduler();
  const live = (await listSessionsAsync()).filter((s) => !s.exited);
  // Akses kunci source tetap (backlog/errors/triase) langsung — bukan index dinamis — agar
  // tetap tertype di bawah noUncheckedIndexedAccess. minCount hanya milik errors.
  const srcView = (id: string, sc: { enabled: boolean; everyMin: number }, minCount?: number) => {
    const last = getLastRun(id);
    return {
      id, enabled: sc.enabled, everyMin: sc.everyMin, minCount,
      lastRunAt: last ? new Date(last).toISOString() : null,
      nextRunAt: last ? new Date(last + sc.everyMin * 60_000).toISOString() : null,
    };
  };
  const sources = [
    srcView("backlog", cfg.sources.backlog),
    srcView("triase", cfg.sources.triase),
  ];
  // SPEC-523 · `queue` tak ikut respons: ia daftar tanpa batas dan sudah punya endpoint sendiri
  // (`GET /scheduler/queue`). State membawa hitungannya saja.
  const counts = await queueCounts();
  // Sesi scheduler = sesi live yang punya item antrean 'launched' (marker asal-scheduler).
  const launchedSpecs = new Set((await listQueue("launched")).map((q) => q.specId));
  // Predikat bertipe, bukan `filter` polos: `SessionInfo.specId` opsional sementara
  // `SchedulerStateView` mewajibkannya, dan penyaringnya memang menjaminnya ada. Route lama
  // mengembalikan bentuk yang di-infer sehingga selisih ini tak pernah terlihat.
  const sessions = live.filter((s): s is typeof s & { specId: string } =>
    !!s.specId && launchedSpecs.has(s.specId));
  return { config: cfg, cap: cfg.maxConcurrent, liveCount: live.length, sources, queueCounts: counts, sessions };
}
