import {
  sessionOutcome, type OverviewDay, type OverviewHeatmap, type OverviewRecords, type OverviewRiver,
  type OverviewTokens, type OverviewWait,
} from "@hanoman/shared";

// ADR-0220 · Overview "Koran Pagi". Seluruh berkas ini MURNI: `now` dan baris sumber masuk sebagai
// parameter, jadi pergantian hari, potongan tengah malam, dan proyeksi bensin bisa diuji tanpa jam
// sungguhan. Pengumpul Prisma ada di overview-source.ts, perekam memori di overview-recorder.ts.

// Sesi AGEN. Shell manual (`shell`, `terminal`, `worktree`, `vps`) keluar dengan kode apa saja dan
// tak bermakna sebagai "tumbang" ataupun "jam kerja agen".
export const AGENT_KINDS: ReadonlySet<string> = new Set(["spec", "reverse", "prd", "scaffold", "breakdown", "telegram"]);

export const MIN_MS = 60_000;
export const HOUR_MS = 3_600_000;

// Batas hari LOKAL lewat konstruktor Date (aman DST), bukan aritmetika 86.400.000.
export const startOfDay = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
export const addDays = (t: number, n: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
};
export const dayKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const overlapMs = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export type SpecRow = { createdAt: Date; startedAt: Date | null; doneAt: Date | null };
export type SessionRow = {
  kind: string; startedAt: Date; endedAt: Date | null; exitCode: number | null; endedReason: string | null;
};
export type InvocationRow = {
  agentName: string; startedAt: Date; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null;
};

const inRange = (d: Date | null, t0: number, t1: number): boolean =>
  d !== null && d.getTime() >= t0 && d.getTime() < t1;

export const isFailed = (s: SessionRow): boolean => AGENT_KINDS.has(s.kind) && s.endedAt !== null
  && sessionOutcome({ endedAt: s.endedAt.toISOString(), endedReason: s.endedReason, exitCode: s.exitCode }) === "failed";

export function dayStats(dayStart: number, specs: SpecRow[], sessions: SessionRow[]): OverviewDay {
  const dayEnd = addDays(dayStart, 1);
  return {
    landed: specs.filter((s) => inRange(s.doneAt, dayStart, dayEnd)).length,
    failed: sessions.filter((s) => isFailed(s) && inRange(s.endedAt, dayStart, dayEnd)).length,
  };
}

export function riverStats(now: number, specs: SpecRow[]): OverviewRiver {
  const t0 = startOfDay(now);
  const t1 = addDays(t0, 1);
  const week0 = addDays(t0, -6);
  const done7 = specs.filter((s) => inRange(s.doneAt, week0, t1));
  return {
    created: specs.filter((s) => inRange(s.createdAt, t0, t1)).length,
    started: specs.filter((s) => inRange(s.startedAt, t0, t1)).length,
    landed: specs.filter((s) => inRange(s.doneAt, t0, t1)).length,
    leadTimeMedMs: median(done7.map((s) => s.doneAt!.getTime() - s.createdAt.getTime())),
    cycleTimeMedMs: median(done7.filter((s) => s.startedAt).map((s) => s.doneAt!.getTime() - s.startedAt!.getTime())),
  };
}

const invTotal = (i: InvocationRow): number => (i.inputTokens ?? 0) + (i.outputTokens ?? 0) + (i.cachedTokens ?? 0);

export function tokenStats(now: number, invs: InvocationRow[], landedToday: number | null): OverviewTokens {
  const t0 = startOfDay(now);
  const y0 = addDays(t0, -1);
  const today = invs.filter((i) => i.startedAt.getTime() >= t0);
  const input = today.reduce((n, i) => n + (i.inputTokens ?? 0), 0);
  const output = today.reduce((n, i) => n + (i.outputTokens ?? 0), 0);
  const cached = today.reduce((n, i) => n + (i.cachedTokens ?? 0), 0);
  const total = input + output + cached;
  const byAgent = new Map<string, number>();
  for (const i of today) byAgent.set(i.agentName, (byAgent.get(i.agentName) ?? 0) + invTotal(i));
  let topAgent: OverviewTokens["topAgent"] = null;
  for (const [name, n] of byAgent) if (!topAgent || n > topAgent.total) topAgent = { name, total: n };
  return {
    input, output, cached, total,
    cacheHitPct: input + cached > 0 ? Math.round((cached / (input + cached)) * 100) : null,
    perLanded: landedToday && landedToday > 0 ? Math.round(total / landedToday) : null,
    topAgent,
    yesterdayTotal: invs.filter((i) => i.startedAt.getTime() >= y0 && i.startedAt.getTime() < t0)
      .reduce((n, i) => n + invTotal(i), 0),
  };
}

export type Span = { start: number; end: number | null };

export function liveMs(sessions: SessionRow[], t0: number, t1: number, now: number): number {
  let ms = 0;
  for (const s of sessions) {
    if (!AGENT_KINDS.has(s.kind)) continue;
    ms += overlapMs(s.startedAt.getTime(), s.endedAt ? s.endedAt.getTime() : now, t0, t1);
  }
  return ms;
}

const spanMs = (spans: Span[], t0: number, t1: number, now: number): number =>
  spans.reduce((n, w) => n + overlapMs(w.start, w.end ?? now, t0, t1), 0);

export function waitStats(now: number, waits: Span[], sessions: SessionRow[] | null): OverviewWait {
  const t0 = startOfDay(now);
  const t1 = addDays(t0, 1);
  const y0 = addDays(t0, -1);
  const todayMs = spanMs(waits, t0, t1, now);
  const live = sessions ? liveMs(sessions, t0, t1, now) : 0;
  return {
    todayMin: Math.round(todayMs / MIN_MS),
    yesterdayMin: Math.round(spanMs(waits, y0, t0, now) / MIN_MS),
    pctOfLive: sessions && live > 0 ? Math.min(100, Math.round((todayMs / live) * 100)) : null,
  };
}

export function heatmapStats(now: number, sessions: SessionRow[]): OverviewHeatmap {
  const t0 = startOfDay(now);
  const days: string[] = [];
  const minutes: number[][] = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = addDays(t0, -i);
    const base = new Date(d0);
    days.push(dayKey(d0));
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      const h0 = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h).getTime();
      const h1 = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h + 1).getTime();
      row.push(Math.round(liveMs(sessions, h0, h1, now) / MIN_MS));
    }
    minutes.push(row);
  }
  return { days, minutes };
}

const RECORD_WINDOW_DAYS = 90;

export function recordStats(now: number, specs: SpecRow[], sessions: SessionRow[]): OverviewRecords {
  const t0 = startOfDay(now);
  const windowStart = addDays(t0, -(RECORD_WINDOW_DAYS - 1));
  const agent = sessions.filter((s) => AGENT_KINDS.has(s.kind));
  const failedDays = new Set(agent.filter(isFailed).map((s) => dayKey(s.endedAt!.getTime())));

  let streakDays = 0;
  let bestStreak = 0;
  if (agent.length > 0) {
    const first = Math.max(windowStart, startOfDay(Math.min(...agent.map((s) => s.startedAt.getTime()))));
    let run = 0;
    for (let d = first; d <= t0; d = addDays(d, 1)) {
      run = failedDays.has(dayKey(d)) ? 0 : run + 1;
      bestStreak = Math.max(bestStreak, run);
    }
    streakDays = run;   // run terakhir = run yang berakhir hari ini
  }

  const landedByDay = new Map<string, number>();
  for (const s of specs) {
    if (!s.doneAt || s.doneAt.getTime() < windowStart) continue;
    const k = dayKey(s.doneAt.getTime());
    landedByDay.set(k, (landedByDay.get(k) ?? 0) + 1);
  }
  let bestLandedDay: OverviewRecords["bestLandedDay"] = null;
  for (const [date, count] of [...landedByDay].sort(([a], [b]) => a.localeCompare(b)))
    if (!bestLandedDay || count > bestLandedDay.count) bestLandedDay = { date, count };
  const todayKey = dayKey(t0);
  const todayCount = landedByDay.get(todayKey) ?? 0;
  const prevMax = Math.max(0, ...[...landedByDay].filter(([k]) => k !== todayKey).map(([, n]) => n));
  // Rekor butuh pembanding: hari pertama yang pernah mendaratkan spec bukan "rekor baru".
  return { streakDays, bestStreak, bestLandedDay, landedRecordToday: prevMax > 0 && todayCount > prevMax };
}
