import { sessionOutcome, type OverviewDay, type OverviewRiver, type OverviewTokens } from "@hanoman/shared";

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
