import type { LimitWindow } from "@hanoman/shared";
import { listSessionsAsync } from "./pty";
import { isDeciding } from "./lead/deciding";
import { getLimits } from "./limits";
import { getCodexLimits } from "./codex-limits";
import { HOUR_MS, type LimitSeries, type Span } from "./overview-metrics";

// ADR-0220 · perekam di MEMORI untuk dua fakta yang tak disimpan di mana pun: berapa lama sesi
// menunggu jawaban manusia (`decisionAt` hilang begitu dijawab) dan riwayat `usedPct` limit (API
// hanya memberi angka saat ini). Restart mengosongkannya, dan itu sudah diterima: `recordingSince`
// ikut di DTO supaya panel menulis "tercatat sejak …". Timer sendiri, bukan loop siar events.ts:
// loop itu hanya hidup selama ada dashboard terbuka, dan menit menunggu justru menumpuk saat tak ada.

const MAX_EPISODES = 2000;
const KEEP_MS = 2 * HOUR_MS;
const MIN_GAP_MS = 25_000;
const TICK_MS = 10_000;
const LIMIT_EVERY_TICKS = 3;   // 30 dtk, setara cache getLimits()

export type ObservedSession = { id: string; exited: boolean; decision?: boolean; deciding?: boolean; decisionAt?: string };

let since = Date.now();
const open = new Map<string, number>();   // sessionId → awal episode
let closed: Span[] = [];
const series = new Map<string, LimitSeries>();
let timer: NodeJS.Timeout | undefined;
let ticks = 0;

export function observeSessions(list: ObservedSession[], now = Date.now()): void {
  const waiting = new Set<string>();
  for (const s of list) {
    if (s.exited || !s.decision || s.deciding) continue;
    waiting.add(s.id);
    if (open.has(s.id)) continue;
    const at = s.decisionAt ? Date.parse(s.decisionAt) : Number.NaN;
    open.set(s.id, Number.isFinite(at) ? Math.min(at, now) : now);
  }
  for (const [id, start] of open) {
    if (waiting.has(id)) continue;
    open.delete(id);
    closed.push({ start, end: now });
  }
  if (closed.length > MAX_EPISODES) closed = closed.slice(-MAX_EPISODES);
}

export function observeLimits(source: "claude" | "codex", windows: LimitWindow[], now = Date.now()): void {
  for (const w of windows) {
    const k = `${source}:${w.key}`;
    let s = series.get(k);
    if (!s) { s = { source, key: w.key, label: w.label, resetsAt: w.resetsAt, samples: [] }; series.set(k, s); }
    s.label = w.label;
    s.resetsAt = w.resetsAt;
    const last = s.samples.at(-1);
    if (last && w.usedPct < last.pct) s.samples = [];             // window baru mulai dari bawah
    else if (last && now - last.at < MIN_GAP_MS) continue;
    s.samples.push({ at: now, pct: w.usedPct });
    s.samples = s.samples.filter((p) => p.at >= now - KEEP_MS);
  }
}

export const waitSpans = (): Span[] =>
  [...closed, ...[...open.values()].map((start) => ({ start, end: null }))];
export const limitSeries = (): LimitSeries[] =>
  [...series.values()].map((s) => ({ ...s, samples: [...s.samples] }));
export const recordingSince = (): number => since;

async function tick(): Promise<void> {
  const list = await listSessionsAsync();
  observeSessions(list.map((s) => ({ ...s, deciding: isDeciding(s.id) })));
  if (ticks++ % LIMIT_EVERY_TICKS !== 0) return;
  const [claude, codex] = await Promise.all([getLimits(), getCodexLimits()]);
  if (claude.status !== "unavailable") observeLimits("claude", claude.windows);
  if (codex.status !== "unavailable") observeLimits("codex", codex.windows);
}

export function startOverviewRecorder(): void {
  if (timer) return;
  void tick().catch((e) => console.warn("perekam overview:", e));
  timer = setInterval(() => { void tick().catch(() => {}); }, TICK_MS);
  timer.unref();
}

/** Test-only. */
export function __resetRecorder(now = Date.now()): void {
  since = now;
  open.clear();
  closed = [];
  series.clear();
  ticks = 0;
  if (timer) { clearInterval(timer); timer = undefined; }
}
