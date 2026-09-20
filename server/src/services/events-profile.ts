import { monitorEventLoopDelay } from "node:perf_hooks";

// SPEC-1267 · instrumen ukur jalur siar. Mati secara default: `profStart` mengembalikan 0 tanpa
// menyentuh hrtime, jadi nol biaya di produksi.
export const PROFILE = process.env.HANOMAN_EVENTS_PROFILE === "1";

type Acc = { builds: number[]; frames: number; bytes: number; ticks: number };
const acc: Record<string, Acc> = {};
let h: ReturnType<typeof monitorEventLoopDelay> | undefined;

const nowUs = () => Number(process.hrtime.bigint() / 1000n);

export const profStart = (): number => (PROFILE ? nowUs() : 0);

export function profEnd(group: string, t0: number, bytes: number, emitted: boolean): void {
  if (!PROFILE) return;
  const a = (acc[group] ??= { builds: [], frames: 0, bytes: 0, ticks: 0 });
  a.builds.push((nowUs() - t0) / 1000);
  a.ticks++;
  if (emitted) { a.frames++; a.bytes += bytes; }
}

export const __snapshot = () => acc;

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

export function startLagMonitor(): void {
  if (!PROFILE || h) return;
  const mon = (h = monitorEventLoopDelay({ resolution: 10 }));
  mon.enable();
  setInterval(() => {
    const ms = (n: number) => +(n / 1e6).toFixed(1);
    const rows = Object.entries(acc).map(([g, a]) =>
      `${g}: build p95=${pct(a.builds, 0.95).toFixed(1)}ms frames=${a.frames}/${a.ticks} bytes=${a.bytes}`);
    console.log(`[events-profile] loop p50=${ms(mon.percentile(50))} p99=${ms(mon.percentile(99))} max=${ms(mon.max)}ms | ${rows.join(" | ")}`);
    mon.reset();
    for (const k of Object.keys(acc)) delete acc[k];
  }, 10_000).unref();
}
