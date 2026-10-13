import {
  sessionOutcome, type OverviewDay, type OverviewHeatmap, type OverviewRecords, type OverviewRiver,
  type OverviewTokens, type OverviewWait, type OverviewBensin, type OverviewDTO, type HeadlinePart,
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

export type LimitSeries = {
  source: "claude" | "codex"; key: string; label: string; resetsAt: string | null;
  samples: { at: number; pct: number }[];
};

const BENSIN_LOOKBACK_MS = 60 * MIN_MS;
const BENSIN_MIN_SAMPLES = 4;

// Regresi linear kuadrat terkecil: kemiringan %/ms.
function slopeOf(pts: { at: number; pct: number }[]): number {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.at, 0) / n;
  const my = pts.reduce((s, p) => s + p.pct, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) { num += (p.at - mx) * (p.pct - my); den += (p.at - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

export function bensinStats(now: number, series: LimitSeries[]): OverviewBensin[] {
  const out: OverviewBensin[] = [];
  for (const s of series) {
    const last = s.samples.at(-1);
    if (!last) continue;
    const recent = s.samples.filter((p) => p.at >= now - BENSIN_LOOKBACK_MS);
    const base = { source: s.source, key: s.key, label: s.label, usedPct: last.pct, resetsAt: s.resetsAt,
      samples: recent.map((p) => ({ at: new Date(p.at).toISOString(), pct: p.pct })) };
    if (recent.length < BENSIN_MIN_SAMPLES) { out.push({ ...base, exhaustAt: null, verdict: "kurang-data" }); continue; }
    const slope = slopeOf(recent);
    if (slope <= 0) { out.push({ ...base, exhaustAt: null, verdict: "stabil" }); continue; }
    const exhaust = Math.round(last.at + (100 - last.pct) / slope);
    const reset = s.resetsAt ? Date.parse(s.resetsAt) : Number.NaN;
    if (Number.isFinite(reset) && exhaust >= reset) out.push({ ...base, exhaustAt: null, verdict: "aman" });
    else out.push({ ...base, exhaustAt: new Date(exhaust).toISOString(), verdict: "habis" });
  }
  return out;
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} menit`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} jam ${m} menit` : `${h} jam`;
}
export function fmtClock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
}

const WAIT_HEADLINE_MIN = 30;
export type HeadlineInput = Pick<OverviewDTO, "today" | "wait" | "records" | "bensin">;

// Template deterministik, tanpa LLM (ADR-0220). Urutan = prioritas; maks tiga fakta.
export function headline(o: HeadlineInput): OverviewDTO["headline"] {
  const facts: HeadlinePart[] = [];
  if (o.today && o.today.failed > 0) facts.push({ text: `${o.today.failed} sesi tumbang`, tone: "bad" });
  if (o.wait && o.wait.todayMin >= WAIT_HEADLINE_MIN)
    facts.push({ text: `agen menunggumu ${fmtMinutes(o.wait.todayMin)}`, tone: "bad" });
  const record = !!o.records?.landedRecordToday && !!o.today && o.today.landed > 0;
  if (record) facts.push({ text: `rekor baru: ${o.today!.landed} spec mendarat`, tone: "good" });
  const empty = o.bensin?.find((b) => b.verdict === "habis" && b.exhaustAt);
  if (empty) facts.push({ text: `limit ${empty.label} habis ±${fmtClock(Date.parse(empty.exhaustAt!))}`, tone: "bad" });
  if (!record && o.today && o.today.landed > 0) facts.push({ text: `${o.today.landed} spec mendarat`, tone: "good" });

  const top = facts.slice(0, 3);
  if (top.length === 0) return { text: "Hari yang tenang.", parts: [{ text: "Hari yang tenang." }] };
  top[0] = { ...top[0]!, text: top[0]!.text.charAt(0).toUpperCase() + top[0]!.text.slice(1) };
  const parts: HeadlinePart[] = [];
  top.forEach((f, i) => {
    if (i > 0) parts.push({ text: i === top.length - 1 ? (top.length === 2 ? " dan " : ", dan ") : ", " });
    parts.push(f);
  });
  parts.push({ text: "." });
  return { text: parts.map((p) => p.text).join(""), parts };
}

export type OverviewSources = {
  specs: SpecRow[] | null; sessions: SessionRow[] | null; invocations: InvocationRow[] | null;
  waits: Span[]; limits: LimitSeries[]; recordingSince: number;
};

// Satu bagian yang melempar tak boleh mengosongkan seluruh Overview: panelnya null, sisanya tetap.
function safe<T>(label: string, f: () => T): T | null {
  try { return f(); } catch (err) { console.warn(`overview: panel ${label} gagal dihitung:`, err); return null; }
}

export function computeOverview(now: number, src: OverviewSources): OverviewDTO {
  const { specs, sessions, invocations } = src;
  const t0 = startOfDay(now);
  const today = specs && sessions ? safe("today", () => dayStats(t0, specs, sessions)) : null;
  const yesterday = specs && sessions ? safe("yesterday", () => dayStats(addDays(t0, -1), specs, sessions)) : null;
  const wait = safe("wait", () => waitStats(now, src.waits, sessions));
  const bensin = safe("bensin", () => bensinStats(now, src.limits));
  const records = specs && sessions ? safe("records", () => recordStats(now, specs, sessions)) : null;
  return {
    generatedAt: new Date(now).toISOString(),
    recordingSince: new Date(src.recordingSince).toISOString(),
    today, yesterday, wait, bensin, records,
    river: specs ? safe("river", () => riverStats(now, specs)) : null,
    tokens: invocations ? safe("tokens", () => tokenStats(now, invocations, today?.landed ?? null)) : null,
    heatmap: sessions ? safe("heatmap", () => heatmapStats(now, sessions)) : null,
    headline: safe("headline", () => headline({ today, wait, records, bensin }))
      ?? { text: "Hari yang tenang.", parts: [{ text: "Hari yang tenang." }] },
  };
}
