import { prisma } from "../../db";
import { flowForSource } from "@hanoman/shared";
import type { Autonomy } from "@hanoman/runner";
import { getScheduler } from "./config";
import { listSources, isDue, setLastRun } from "./registry";
import { drain, drainCronRuns, type GovernorDeps } from "./governor";
import { sweepCronDue } from "./cron";
import { startCronSession, liveCronSession } from "./cron-session";
import { reconcile as reconcileImpl, reconcileProdDeps } from "./reconcile";
import { scanDecisions } from "../notifications";
import { listSessions, getSession, sessionIdForSpec } from "../pty";
import { startSpecSession } from "../session-launch";
import { blockersForSpec } from "../spec-deps";
import { resolveRepoDir } from "../local-binding";

// SPEC-298 · seam akhir sesi: rekonsil item launched (done/failed) + terbitkan notif decision.
// Di-inject agar engine.tick teruji tanpa tmux/git/fs; produksi mengikatnya ke reconcile+scanDecisions.
export type EndOfSession = { reconcile: () => Promise<void>; scanDecisions: () => Promise<void> };
const prodEnd: EndOfSession = {
  reconcile: () => reconcileImpl(reconcileProdDeps),
  scanDecisions: () => scanDecisions(),
};

// SPEC-294 · ADR-0072 · satu tick: jalankan checker source yang enabled & jatuh-tempo, rekonsil
// akhir sesi, lalu drain antrean (kecuali Pause). `now` di-parameter agar cadence teruji deterministik.
export async function tick(now: number, deps: GovernorDeps, end: EndOfSession = prodEnd): Promise<void> {
  const cfg = await getScheduler();
  if (!cfg.enabled) return;                       // master off → idle penuh (tak reconcile/scan)
  for (const src of listSources()) {
    const sc = (cfg.sources as Record<string, { enabled: boolean; everyMin: number }>)[src.id];
    if (sc?.enabled && isDue(src.id, sc.everyMin, now)) {
      setLastRun(src.id, now);
      try { await src.check(); } catch { /* satu source gagal tak menghentikan sisanya */ }
    }
  }
  // SPEC-298 · akhir sesi SEBELUM drain: rekonsil membebaskan slot sesi selesai/gagal agar terisi
  // ≤1 tick (ADR-0072); scanDecisions menerbitkan notif decision utk sesi menunggu keputusan tanpa
  // perlu dashboard terbuka (loop selalu-hidup). Jalan MESKI Pause (Pause hanya memblok launch BARU).
  try { await end.reconcile(); } catch { /* rekonsil gagal tak menghentikan tick */ }
  try { await end.scanDecisions(); } catch { /* notif decision best-effort */ }
  // SPEC-646 · ADR-0112 · materialisasi jatuh tempo cron → baris run. Dijalankan SEBELUM gerbang
  // Pause dengan sengaja: Pause adalah rem PELUNCURAN, bukan penghapus antrean (ADR-0072 keputusan
  // 4) — jatuh tempo yang lewat selama jeda tetap tercatat, dan melanjutkan jeda dalam grace tetap
  // menjalankannya. Master `enabled=false` sudah memulangkan tick di atas, jadi seluruh fitur cron
  // ikut mati di sana.
  try { await sweepCronDue(now); } catch (e) { console.error("scheduler cron sweep:", e); }
  if (cfg.paused) return;                          // rem darurat: tak ada drain → tak ada peluncuran baru
  // SPEC-402 · `prodDeps` membaca tmux, dan bacaan tmux yang GAGAL sekarang melempar — sengaja:
  // dulu ia mengembalikan daftar kosong, jadi `liveCount()` jatuh ke 0 dan governor bisa meluncurkan
  // DI ATAS cap sementara `isLive()` gagal melihat sesi yang sedang berjalan. Tick yang tak bisa
  // membaca tmux karena itu dilewati (10 s lagi dicoba ulang), dengan jejak di log.
  try { await drain(cfg, deps); } catch (e) { console.error("scheduler drain:", e); }
}

// Deps produksi: cap dihitung dari sesi tmux hidup; launch lewat jalur bersama startSpecSession.
export const prodDeps: GovernorDeps = {
  liveCount: () => listSessions().filter((s) => !s.exited).length,
  isLive: (specId) => { const s = getSession(sessionIdForSpec(specId)); return s && !s.exited ? s.id : null; },
  // SPEC-431 · dibaca ULANG dari DB tepat sebelum launch, bukan dari baris antrean: antrean tak
  // menyimpan stage, dan item bisa selesai selagi mengantre. Spec yang hilang bukan urusan gerbang
  // ini — `launch` di bawah yang melempar "spec tak ada" → item ditandai failed dengan alasannya.
  isDone: async (specId) => {
    const s = await prisma.spec.findUnique({ where: { id: specId }, select: { stage: true } });
    return s?.stage === "done";
  },
  // SPEC-447 · ADR-0093 · dibaca ULANG dari DB tepat sebelum launch, seperti `isDone`: `dependsOn`
  // bisa ditulis operator selagi item mengantre, dan merged-ness bergerak sendiri saat ada integrate.
  blockers: async (specId) => {
    const spec = await prisma.spec.findUnique({ where: { id: specId } });
    if (!spec) return [];                       // spec hilang → biar `launch` yang melempar
    return blockersForSpec(spec, await resolveRepoDir(spec.projectId));
  },
  launch: async (item, autonomy) => {
    const spec = await prisma.spec.findUnique({ where: { id: item.specId } });
    if (!spec) throw new Error(`spec ${item.specId} tak ada`);
    // SPEC-298 · autonomy per mode dari cfg.scheduler.autonomy → klausa prompt full-control / butuh-keputusan.
    const r = await startSpecSession(spec, { flow: flowForSource(spec.source), autonomy: autonomy as Autonomy | undefined });
    return r.id;
  },
  // SPEC-646 · ADR-0112 · cron memakai anggaran slot yang sama dengan antrean spec.
  drainCrons: (slots) => drainCronRuns(slots, {
    liveCron: liveCronSession,
    launchCron: async (cron) => (await startCronSession(cron)).id,
  }),
};

const TICK_MS = 10_000;   // governor tick: cukup halus untuk "drain ≤1 tick" saat slot kosong
let timer: NodeJS.Timeout | undefined;

// Dipanggil server.ts SAJA (app.ts bebas-timer). unref → tak menahan proses; boot-pass segera.
export function startScheduler(deps: GovernorDeps = prodDeps): void {
  if (timer) return;
  timer = setInterval(() => void tick(Date.now(), deps), TICK_MS);
  timer.unref();
  void tick(Date.now(), deps);
}
export function stopScheduler(): void { if (timer) clearInterval(timer); timer = undefined; }
