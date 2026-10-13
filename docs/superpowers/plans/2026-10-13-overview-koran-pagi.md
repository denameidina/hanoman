# Overview "Koran Pagi" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merombak layar Overview menjadi halaman depan surat kabar ("Kabar Hanoman") berisi metrik kinerja hari ini vs kemarin. Bagian operasionalnya (sesi menunggu, project bermasalah, daftar project) tetap ada, dilebur ke dalam halaman itu.

**Architecture:** Server menghitung agregat lewat fungsi murni `computeOverview(now, sources)` (`server/src/services/overview-metrics.ts`). Sumbernya baris Prisma (`Spec`, `SessionHistory`, `AgentInvocation`) dan perekam di memori (`overview-recorder.ts`) yang mencatat episode menunggu serta sampel limit. Hasilnya disiarkan sebagai grup snapshot global ke-12 `overview` di `/api/events/ws` (tiap 30 dtk, dedup). Muat awal untuk agen tersedia lewat `GET /api/overview` dan tool MCP `hanoman_overview_get`. Frontend memecah Overview menjadi panel-panel murni di `src/src/screens/overview/`.

**Tech Stack:** TypeScript strict, zod (shared), Fastify + Prisma 6/SQLite (server), React + Vite (frontend), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-13-overview-koran-pagi-design.md`

## Global Constraints

- Hari = mulai 00.00 **waktu lokal mesin**. Batas hari dihitung dengan konstruktor `new Date(y, m, d)` (aman DST), bukan `+ 86_400_000`.
- Sesi agen = `SessionHistory.kind` ∈ `spec, reverse, prd, scaffold, breakdown, telegram`. Kind `vps, shell, worktree, terminal` (shell manual) tidak pernah dihitung.
- Tumbang = `sessionOutcome(...) === "failed"` (`shared/src/session-end.ts`). Baris `reconciled` = `interrupted`, bukan tumbang.
- `computeOverview` **tidak pernah melempar**. Sumber/bagian yang gagal → field-nya `null`, satu `console.warn`, dan grup tetap disiarkan.
- Headline = template deterministik, **tanpa LLM**. Fallback-nya persis `Hari yang tenang.`
- Perekam di memori: episode menunggu maks **2.000**, sampel limit disimpan **2 jam**, jarak sampel minimal **25 dtk**. Data hilang saat restart, dan `recordingSince` dikirim di DTO.
- Proyeksi bensin hanya dihitung bila ada **≥4 sampel dalam 60 menit terakhir** dan kemiringan **> 0**.
- Grup `overview`: `everyTicks: 30`, tidak `cookieOnly`. Route `GET /api/overview` = `GLOBAL_READ`; MCP `hanoman_overview_get` dengan `capability: null` (ADR-0202).
- Label token: **"token agen tercatat"**. Biaya mata uang tidak ditampilkan.
- Warna hanya dari token `src/src/ds/tokens/*`. Angka dan headline memakai `var(--font-display)`; panel denyut memakai `--term-*`.
- `OverviewScreen.tsx` tidak boleh berisi `style={{` maupun `gridTemplateColumns` (test kontrak yang sudah ada). `overview.css` tanpa `!important`.
- **Deviasi dari spec, sudah diputuskan saat menyusun plan:**
  1. Perekam berjalan dengan timer sendiri (`startOverviewRecorder`, 10 dtk, `.unref()`), bukan menumpang loop siar. Loop siar hanya jalan saat ada klien, jadi menit menunggu akan hilang ketika dashboard tertutup.
  2. Denyut tidak mengikuti `activityAt`. Field itu tidak ada di `SessionDTO`, dan menambahkannya membuat frame `sessions` (frame terbesar) terkirim tiap detik. Ritme EKG mengikuti **keadaan**: berjalan = berdetak, menunggu = garis datar putus-putus. Animasinya **CSS murni** (`@keyframes`, `prefers-reduced-motion: reduce` → `animation: none`), tanpa `requestAnimationFrame`. Browser otomatis menjeda animasi CSS di tab tersembunyi.
- **Perintah test** (env sesi hanoman wajib dilepas, DB test terisolasi; lihat CLAUDE.md dan memori proyek). Di bawah ditulis sebagai `TEST <path…>`:
  ```bash
  mkdir -p /tmp/hn-ovk && /usr/bin/env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR -u HANOMAN_SESSION_ID -u HANOMAN_EVENT_URL -u HANOMAN_EVENT_TOKEN -u HANOMAN_EVENT_DIR -u HANOMAN_EVENT_HOST TEST_DATABASE_URL=file:/tmp/hn-ovk/t.test.db pnpm vitest --run --no-file-parallelism <path…>
  ```
- Setiap task selesai: centang checkbox-nya di plan ini (`- [ ]` → `- [x]`) dalam commit yang sama.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `shared/src/overview.ts` (baru) | Kontrak `zOverview` / `OverviewDTO` beserta sub-tipenya |
| `shared/src/overview.test.ts` (baru) | Test kontrak |
| `shared/src/index.ts` | `export * from "./overview"` |
| `shared/src/dto.ts` | Varian `EventMsg` `{ t: "overview"; overview: OverviewDTO }` |
| `shared/src/api.ts` | `paths.overview` |
| `shared/src/mcp-catalog/system.ts` | Tool `hanoman_overview_get` |
| `server/src/services/overview-metrics.ts` (baru) | Fungsi murni: helper hari, agregat per panel, `headline`, `computeOverview` |
| `server/src/services/overview-recorder.ts` (baru) | Perekam di memori: episode menunggu, sampel limit, timer |
| `server/src/services/overview-source.ts` (baru) | Pengumpul Prisma dan `getOverview(now)` |
| `server/src/routes/overview.ts` (baru) | `GET /overview` |
| `server/src/app.ts` | Registrasi route |
| `server/src/server.ts` | `startOverviewRecorder()` |
| `server/src/services/events.ts` | Grup ke-12 `overview` |
| `server/src/services/agent-capabilities.ts` | `overview` → `GLOBAL_READ` |
| `server/test/overview-metrics.test.ts` (baru) | Test fungsi murni |
| `server/test/overview-recorder.test.ts` (baru) | Test perekam |
| `server/test/overview.route.test.ts` (baru) | Route, capability, MCP, frame WS |
| `src/src/screens/overview/format.ts` (baru) | Formatter angka/waktu Indonesia |
| `src/src/screens/overview/Delta.tsx` | Penanda ↑/↓ vs kemarin |
| `src/src/screens/overview/Masthead.tsx` | Masthead koran |
| `src/src/screens/overview/Headline.tsx` | Headline serif |
| `src/src/screens/overview/Koreksi.tsx` | Kotak ralat (project broken/drift) |
| `src/src/screens/overview/IndeksProject.tsx` | Tabel bursa project + footer backlog |
| `src/src/screens/overview/Denyut.tsx` | EKG armada (menggantikan "Sesi berjalan") |
| `src/src/screens/overview/Bottleneck.tsx`, `SungaiSpec.tsx`, `Rekor.tsx`, `Bensin.tsx`, `EkonomiToken.tsx`, `PetaPanas.tsx` | Panel metrik |
| `src/src/screens/OverviewScreen.tsx` | Kerangka koran dan empty state |
| `src/src/screens/styles/overview.css` | Seluruh gaya Overview |
| `src/src/App.tsx` | State `overview` dari frame WS, diteruskan ke layar |
| `src/test/overview-screen.test.tsx` | Test layar (diperbarui) |
| `src/test/overview-panels.test.tsx` (baru) | Test panel metrik |
| Docs | ADR-0220, `stack.md`, `frontend-implementation.md`, `docs/agent-integration.md`, `CLAUDE.md`, `internal/docs/README.md` |

---

### Task 1: Kontrak shared `OverviewDTO`

**Files:**
- Create: `shared/src/overview.ts`, `shared/src/overview.test.ts`
- Modify: `shared/src/index.ts` (tambah satu baris export), `shared/src/dto.ts:~867` (varian EventMsg), `shared/src/api.ts:~148` (paths)

**Interfaces:**
- Produces: `zOverview`, `OverviewDTO`, `OverviewDay`, `OverviewRiver`, `OverviewTokens`, `OverviewWait`, `OverviewBensin`, `BensinVerdict`, `OverviewHeatmap`, `OverviewRecords`, `HeadlinePart`, `paths.overview` (= `/api/overview`), varian `EventMsg` `{ t: "overview"; overview: OverviewDTO }`.

- [x] **Step 1: Tulis test yang gagal**

`shared/src/overview.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { zOverview, type OverviewDTO } from "./overview";
import { paths } from "./api";

export const sampleOverview = (): OverviewDTO => ({
  generatedAt: "2026-10-13T07:32:00.000Z", recordingSince: "2026-10-13T02:12:00.000Z",
  today: { landed: 3, failed: 1 }, yesterday: { landed: 2, failed: 0 },
  river: { created: 9, started: 5, landed: 3, leadTimeMedMs: 3_600_000, cycleTimeMedMs: 1_200_000 },
  tokens: { input: 100, output: 50, cached: 400, total: 550, cacheHitPct: 80, perLanded: 183,
    topAgent: { name: "implementer", total: 300 }, yesterdayTotal: 200 },
  wait: { todayMin: 47, yesterdayMin: 29, pctOfLive: 31 },
  bensin: [{ source: "claude", key: "session", label: "Sesi 5 jam", usedPct: 68,
    resetsAt: "2026-10-13T11:00:00.000Z", exhaustAt: "2026-10-13T09:40:00.000Z", verdict: "habis",
    samples: [{ at: "2026-10-13T07:00:00.000Z", pct: 60 }] }],
  heatmap: { days: ["2026-10-07"], minutes: [Array.from({ length: 24 }, () => 0)] },
  records: { streakDays: 6, bestStreak: 11, bestLandedDay: { date: "2026-10-12", count: 7 }, landedRecordToday: false },
  headline: { text: "1 sesi tumbang.", parts: [{ text: "1 sesi tumbang", tone: "bad" }, { text: "." }] },
});

describe("zOverview", () => {
  it("menerima DTO lengkap", () => {
    expect(zOverview.parse(sampleOverview())).toEqual(sampleOverview());
  });
  it("menerima setiap panel null (sumber gagal), tapi headline wajib", () => {
    const o = { ...sampleOverview(), today: null, yesterday: null, river: null, tokens: null,
      wait: null, bensin: null, heatmap: null, records: null };
    expect(zOverview.safeParse(o).success).toBe(true);
    const { headline: _h, ...noHeadline } = o;
    expect(zOverview.safeParse(noHeadline).success).toBe(false);
  });
  it("menolak verdict bensin di luar kosakata", () => {
    const o = sampleOverview();
    o.bensin![0]!.verdict = "kosong" as never;
    expect(zOverview.safeParse(o).success).toBe(false);
  });
  it("paths.overview = /api/overview", () => {
    expect(paths.overview).toBe("/api/overview");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST shared/src/overview.test.ts`
Expected: FAIL — `Cannot find module './overview'`.

- [x] **Step 3: Implementasi**

`shared/src/overview.ts`:
```ts
import { z } from "zod";

// ADR-0220 · Overview "Koran Pagi": agregat kinerja hari ini vs kemarin. Dihitung server
// (services/overview-metrics.ts) dan disiarkan sebagai grup snapshot global ke-12 `overview`.
// Setiap panel boleh `null`: sumbernya gagal dibaca, dan klien menulis kalimat datar, bukan angka.

export const zHeadlinePart = z.object({ text: z.string(), tone: z.enum(["bad", "good"]).optional() });
export type HeadlinePart = z.infer<typeof zHeadlinePart>;

export const zOverviewDay = z.object({ landed: z.number().int(), failed: z.number().int() });
export type OverviewDay = z.infer<typeof zOverviewDay>;

export const zOverviewRiver = z.object({
  created: z.number().int(), started: z.number().int(), landed: z.number().int(),
  // Median 7 hari terakhir atas spec yang selesai; null bila tak ada.
  leadTimeMedMs: z.number().nullable(), cycleTimeMedMs: z.number().nullable(),
});
export type OverviewRiver = z.infer<typeof zOverviewRiver>;

// Hanya AgentInvocation (subagen dan agen fase), BUKAN seluruh percakapan sesi utama: "token agen tercatat".
export const zOverviewTokens = z.object({
  input: z.number(), output: z.number(), cached: z.number(), total: z.number(),
  cacheHitPct: z.number().nullable(), perLanded: z.number().nullable(),
  topAgent: z.object({ name: z.string(), total: z.number() }).nullable(),
  yesterdayTotal: z.number(),
});
export type OverviewTokens = z.infer<typeof zOverviewTokens>;

export const zOverviewWait = z.object({
  todayMin: z.number(), yesterdayMin: z.number(), pctOfLive: z.number().nullable(),
});
export type OverviewWait = z.infer<typeof zOverviewWait>;

export const BENSIN_VERDICTS = ["habis", "aman", "stabil", "kurang-data"] as const;
export type BensinVerdict = (typeof BENSIN_VERDICTS)[number];
export const zOverviewBensin = z.object({
  source: z.enum(["claude", "codex"]), key: z.string(), label: z.string(),
  usedPct: z.number(), resetsAt: z.string().nullable(), exhaustAt: z.string().nullable(),
  verdict: z.enum(BENSIN_VERDICTS),
  samples: z.array(z.object({ at: z.string(), pct: z.number() })),
});
export type OverviewBensin = z.infer<typeof zOverviewBensin>;

export const zOverviewHeatmap = z.object({
  days: z.array(z.string()),               // YYYY-MM-DD lokal, terlama dulu
  minutes: z.array(z.array(z.number())),   // [hari][jam 0..23] = menit sesi agen hidup
});
export type OverviewHeatmap = z.infer<typeof zOverviewHeatmap>;

export const zOverviewRecords = z.object({
  streakDays: z.number().int(), bestStreak: z.number().int(),
  bestLandedDay: z.object({ date: z.string(), count: z.number().int() }).nullable(),
  landedRecordToday: z.boolean(),
});
export type OverviewRecords = z.infer<typeof zOverviewRecords>;

export const zOverview = z.object({
  generatedAt: z.string(),
  recordingSince: z.string(),   // awal perekam di memori (menunggu & bensin); restart mengulangnya
  today: zOverviewDay.nullable(), yesterday: zOverviewDay.nullable(),
  river: zOverviewRiver.nullable(), tokens: zOverviewTokens.nullable(), wait: zOverviewWait.nullable(),
  bensin: z.array(zOverviewBensin).nullable(), heatmap: zOverviewHeatmap.nullable(),
  records: zOverviewRecords.nullable(),
  headline: z.object({ text: z.string(), parts: z.array(zHeadlinePart) }),
});
export type OverviewDTO = z.infer<typeof zOverview>;
```

`shared/src/index.ts`: tambahkan baris di bawah `export * from "./session-end";`:
```ts
export * from "./overview";
```

`shared/src/dto.ts`: di union `EventMsg`, tepat sesudah varian `| { t: "pending"; counts: PendingCounts }`, tambahkan:
```ts
  // ADR-0220 · grup GLOBAL ke-12: agregat Overview "Koran Pagi" (hari ini vs kemarin). 30 dtk,
  // dedup tanpa `generatedAt`. Agregat tanpa id/judul → tidak `cookieOnly` (preseden `pending`).
  | { t: "overview"; overview: import("./overview").OverviewDTO }
```
Lalu ubah komentar di atas union dari `(sebelas sejak SPEC-961)` menjadi `(dua belas sejak ADR-0220)`.

`shared/src/api.ts`: tepat sesudah baris `presence: \`${API}/presence\`,` tambahkan:
```ts
  // ADR-0220 · muat awal agen/MCP untuk agregat Overview; dashboard menerimanya lewat grup siar `overview`.
  overview: `${API}/overview`,
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST shared/src/overview.test.ts`
Expected: PASS (4 test).

- [x] **Step 5: Commit**

```bash
git add shared/src/overview.ts shared/src/overview.test.ts shared/src/index.ts shared/src/dto.ts shared/src/api.ts docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(shared): kontrak OverviewDTO + frame siar overview (ADR-0220)"
```

---

### Task 2: Metrik murni I — helper hari, kemarin/hari ini, sungai, token

**Files:**
- Create: `server/src/services/overview-metrics.ts`, `server/test/overview-metrics.test.ts`

**Interfaces:**
- Consumes: tipe dari Task 1; `sessionOutcome` dari `@hanoman/shared`.
- Produces (diekspor, dipakai Task 3–6):
  ```ts
  AGENT_KINDS: ReadonlySet<string>
  startOfDay(t: number): number; addDays(t: number, n: number): number; dayKey(t: number): string
  overlapMs(a0: number, a1: number, b0: number, b1: number): number; median(xs: number[]): number | null
  type SpecRow = { createdAt: Date; startedAt: Date | null; doneAt: Date | null }
  type SessionRow = { kind: string; startedAt: Date; endedAt: Date | null; exitCode: number | null; endedReason: string | null }
  type InvocationRow = { agentName: string; startedAt: Date; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null }
  isFailed(s: SessionRow): boolean
  dayStats(dayStart: number, specs: SpecRow[], sessions: SessionRow[]): OverviewDay
  riverStats(now: number, specs: SpecRow[]): OverviewRiver
  tokenStats(now: number, invs: InvocationRow[], landedToday: number | null): OverviewTokens
  ```

- [x] **Step 1: Tulis test yang gagal**

`server/test/overview-metrics.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  startOfDay, addDays, dayKey, overlapMs, median, isFailed, dayStats, riverStats, tokenStats,
  type SessionRow, type SpecRow,
} from "../src/services/overview-metrics";

// Semua tanggal dibangun dengan konstruktor LOKAL supaya test lepas dari zona waktu mesin.
const at = (d: number, h = 0, m = 0) => new Date(2026, 9, d, h, m);   // Oktober 2026
const NOW = at(13, 14, 30).getTime();
const sess = (o: Partial<SessionRow>): SessionRow =>
  ({ kind: "spec", startedAt: at(13, 9), endedAt: null, exitCode: null, endedReason: "closed", ...o });
const spec = (o: Partial<SpecRow>): SpecRow => ({ createdAt: at(1), startedAt: null, doneAt: null, ...o });

describe("helper hari", () => {
  it("startOfDay/addDays/dayKey memakai kalender lokal", () => {
    expect(startOfDay(NOW)).toBe(at(13).getTime());
    expect(addDays(startOfDay(NOW), -1)).toBe(at(12).getTime());
    expect(dayKey(NOW)).toBe("2026-10-13");
  });
  it("overlapMs dan median", () => {
    expect(overlapMs(0, 10, 5, 20)).toBe(5);
    expect(overlapMs(0, 10, 10, 20)).toBe(0);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("isFailed", () => {
  it("exitCode ≠ 0 pada baris closed = tumbang; reconciled dan exit 0/null bukan", () => {
    expect(isFailed(sess({ endedAt: at(13, 10), exitCode: 1 }))).toBe(true);
    expect(isFailed(sess({ endedAt: at(13, 10), exitCode: 0 }))).toBe(false);
    expect(isFailed(sess({ endedAt: at(13, 10), exitCode: null }))).toBe(false);
    expect(isFailed(sess({ endedAt: at(13, 10), exitCode: 137, endedReason: "reconciled" }))).toBe(false);
    expect(isFailed(sess({ endedAt: null, exitCode: 1 }))).toBe(false);
  });
});

describe("dayStats", () => {
  it("menghitung spec mendarat dan sesi agen tumbang di hari itu saja; shell manual diabaikan", () => {
    const specs = [spec({ doneAt: at(13, 9) }), spec({ doneAt: at(13, 11) }), spec({ doneAt: at(12, 23) })];
    const sessions = [
      sess({ endedAt: at(13, 10), exitCode: 1 }),
      sess({ endedAt: at(12, 10), exitCode: 1 }),
      sess({ kind: "shell", endedAt: at(13, 10), exitCode: 1 }),
    ];
    expect(dayStats(startOfDay(NOW), specs, sessions)).toEqual({ landed: 2, failed: 1 });
    expect(dayStats(addDays(startOfDay(NOW), -1), specs, sessions)).toEqual({ landed: 1, failed: 1 });
  });
});

describe("riverStats", () => {
  it("dibuat/mulai/selesai hari ini + median lead & cycle 7 hari", () => {
    const specs = [
      spec({ createdAt: at(13, 8) }),
      spec({ createdAt: at(13, 8), startedAt: at(13, 9) }),
      spec({ createdAt: at(12, 10), startedAt: at(13, 10), doneAt: at(13, 12) }),   // lead 26j, cycle 2j
      spec({ createdAt: at(10, 12), startedAt: at(11, 12), doneAt: at(11, 16) }),   // lead 28j, cycle 4j
      spec({ createdAt: at(1), startedAt: at(1), doneAt: at(2) }),                  // di luar 7 hari
    ];
    const r = riverStats(NOW, specs);
    expect(r).toMatchObject({ created: 2, started: 2, landed: 1 });
    expect(r.leadTimeMedMs).toBe(27 * 3_600_000);
    expect(r.cycleTimeMedMs).toBe(3 * 3_600_000);
  });
  it("tanpa spec selesai 7 hari → median null", () => {
    expect(riverStats(NOW, [])).toEqual({ created: 0, started: 0, landed: 0, leadTimeMedMs: null, cycleTimeMedMs: null });
  });
});

describe("tokenStats", () => {
  const inv = (agentName: string, d: Date, i: number, o: number, c: number) =>
    ({ agentName, startedAt: d, inputTokens: i, outputTokens: o, cachedTokens: c });
  it("jumlah hari ini, cache hit, per spec, agen paling boros, total kemarin", () => {
    const t = tokenStats(NOW, [
      inv("implementer", at(13, 9), 100, 50, 300),
      inv("reviewer", at(13, 10), 100, 20, 100),
      inv("implementer", at(12, 9), 10, 10, 10),
    ], 2);
    expect(t).toEqual({ input: 200, output: 70, cached: 400, total: 670, cacheHitPct: 67, perLanded: 335,
      topAgent: { name: "implementer", total: 450 }, yesterdayTotal: 30 });
  });
  it("kosong → nol, cache & per-spec null, tanpa agen", () => {
    expect(tokenStats(NOW, [], 0)).toEqual({ input: 0, output: 0, cached: 0, total: 0, cacheHitPct: null,
      perLanded: null, topAgent: null, yesterdayTotal: 0 });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST server/test/overview-metrics.test.ts`
Expected: FAIL — modul `overview-metrics` belum ada.

- [x] **Step 3: Implementasi**

`server/src/services/overview-metrics.ts`:
```ts
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
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST server/test/overview-metrics.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/overview-metrics.ts server/test/overview-metrics.test.ts docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(overview): metrik murni — hari, sungai spec, ekonomi token (ADR-0220)"
```

---

### Task 3: Metrik murni II — menunggu, peta panas, rekor

**Files:**
- Modify: `server/src/services/overview-metrics.ts` (tambah di akhir berkas)
- Modify: `server/test/overview-metrics.test.ts` (tambah describe)

**Interfaces:**
- Consumes: helper Task 2.
- Produces:
  ```ts
  type Span = { start: number; end: number | null }
  liveMs(sessions: SessionRow[], t0: number, t1: number, now: number): number
  waitStats(now: number, waits: Span[], sessions: SessionRow[] | null): OverviewWait
  heatmapStats(now: number, sessions: SessionRow[]): OverviewHeatmap
  recordStats(now: number, specs: SpecRow[], sessions: SessionRow[]): OverviewRecords
  ```

- [x] **Step 1: Tulis test yang gagal** — tambahkan di akhir `server/test/overview-metrics.test.ts`, lalu lengkapi import di atas berkas dengan `waitStats, heatmapStats, recordStats, liveMs`:

```ts
describe("waitStats", () => {
  it("menjumlah menit menunggu per hari, memotong episode yang melewati tengah malam", () => {
    const waits = [
      { start: at(12, 23, 50).getTime(), end: at(13, 0, 20).getTime() },   // 10m kemarin + 20m hari ini
      { start: at(13, 14, 0).getTime(), end: null },                       // masih menunggu → sampai NOW (30m)
    ];
    const sessions = [sess({ startedAt: at(13, 13, 30), endedAt: null })]; // hidup 60m hari ini
    expect(waitStats(NOW, waits, sessions)).toEqual({ todayMin: 50, yesterdayMin: 10, pctOfLive: 83 });
  });
  it("tanpa sesi agen hidup → pctOfLive null; sumber sesi gagal (null) juga null", () => {
    expect(waitStats(NOW, [], []).pctOfLive).toBeNull();
    expect(waitStats(NOW, [{ start: at(13, 9).getTime(), end: at(13, 10).getTime() }], null))
      .toEqual({ todayMin: 60, yesterdayMin: 0, pctOfLive: null });
  });
  it("persentase dibatasi 100", () => {
    const sessions = [sess({ startedAt: at(13, 14, 0), endedAt: at(13, 14, 10) })];
    expect(waitStats(NOW, [{ start: at(13, 13).getTime(), end: at(13, 14).getTime() }], sessions).pctOfLive).toBe(100);
  });
});

describe("liveMs", () => {
  it("sesi yang masih hidup dihitung sampai now; shell manual diabaikan", () => {
    const t0 = startOfDay(NOW);
    expect(liveMs([sess({ startedAt: at(13, 14) }), sess({ kind: "shell", startedAt: at(13, 9) })], t0, addDays(t0, 1), NOW))
      .toBe(30 * 60_000);
  });
});

describe("heatmapStats", () => {
  it("7 hari × 24 jam, terlama dulu, menit per sel", () => {
    const h = heatmapStats(NOW, [
      sess({ startedAt: at(13, 9, 30), endedAt: at(13, 10, 15) }),   // 30m di jam 9, 15m di jam 10
      sess({ startedAt: at(7, 2, 0), endedAt: at(7, 2, 40) }),       // hari terlama
    ]);
    expect(h.days).toEqual(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]);
    expect(h.minutes).toHaveLength(7);
    expect(h.minutes[6]![9]).toBe(30);
    expect(h.minutes[6]![10]).toBe(15);
    expect(h.minutes[0]![2]).toBe(40);
    expect(h.minutes.every((row) => row.length === 24)).toBe(true);
  });
});

describe("recordStats", () => {
  it("streak hari tanpa sesi tumbang sampai hari ini, rekor streak, rekor spec per hari", () => {
    const sessions = [
      sess({ startedAt: at(1, 9), endedAt: at(1, 10), exitCode: 0 }),   // awal riwayat: 1 Okt
      sess({ startedAt: at(5, 9), endedAt: at(5, 10), exitCode: 2 }),   // tumbang 5 Okt
      sess({ startedAt: at(9, 9), endedAt: at(9, 10), exitCode: 1 }),   // tumbang 9 Okt
    ];
    const specs = [spec({ doneAt: at(12, 9) }), spec({ doneAt: at(12, 10) }), spec({ doneAt: at(13, 9) })];
    expect(recordStats(NOW, specs, sessions)).toEqual({
      streakDays: 4,                                     // 10, 11, 12, 13 Okt
      bestStreak: 4,                                     // 1–4 Okt juga 4; 6–8 Okt 3
      bestLandedDay: { date: "2026-10-12", count: 2 },
      landedRecordToday: false,
    });
  });
  it("tumbang hari ini → streak 0; rekor hari ini bila melampaui semua hari sebelumnya", () => {
    const r = recordStats(NOW, [spec({ doneAt: at(12, 9) }), spec({ doneAt: at(13, 9) }), spec({ doneAt: at(13, 10) })],
      [sess({ startedAt: at(13, 9), endedAt: at(13, 10), exitCode: 1 })]);
    expect(r.streakDays).toBe(0);
    expect(r.landedRecordToday).toBe(true);
    expect(r.bestLandedDay).toEqual({ date: "2026-10-13", count: 2 });
  });
  it("tanpa riwayat sesi sama sekali → streak 0, rekor 0, tanpa hari terbaik", () => {
    expect(recordStats(NOW, [], [])).toEqual({ streakDays: 0, bestStreak: 0, bestLandedDay: null, landedRecordToday: false });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST server/test/overview-metrics.test.ts`
Expected: FAIL — `waitStats is not a function` (dan sejenisnya).

- [x] **Step 3: Implementasi** — tambahkan import tipe `OverviewWait, OverviewHeatmap, OverviewRecords` ke baris import `@hanoman/shared`, lalu tambahkan di akhir `overview-metrics.ts`:

```ts
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
```

Catatan untuk implementer: pada test pertama `recordStats`, rekor hari terbaik (12 Okt, 2) lebih besar dari hari ini (1), jadi `landedRecordToday` false. Pada test kedua, hari ini (2) melampaui 12 Okt (1). Tanpa hari lain yang pernah mendaratkan spec (`prevMax = 0`), `landedRecordToday` selalu false; test `computeOverview` dan route di Task 4/6 bergantung pada aturan ini. Untuk hari dengan jumlah sama, `bestLandedDay` memilih yang **paling awal** (pembanding `>` ketat dalam iterasi menaik).

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST server/test/overview-metrics.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/overview-metrics.ts server/test/overview-metrics.test.ts docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(overview): menit menunggu, peta panas 7x24, streak & rekor (ADR-0220)"
```

---

### Task 4: Metrik murni III — bensin, headline, `computeOverview`

**Files:**
- Modify: `server/src/services/overview-metrics.ts`, `server/test/overview-metrics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type LimitSeries = { source: "claude" | "codex"; key: string; label: string; resetsAt: string | null; samples: { at: number; pct: number }[] }
  bensinStats(now: number, series: LimitSeries[]): OverviewBensin[]
  fmtMinutes(min: number): string   // "47 menit" | "1 jam" | "1 jam 12 menit"
  fmtClock(t: number): string       // "16.40" waktu lokal
  headline(o: HeadlineInput): OverviewDTO["headline"]
  type HeadlineInput = Pick<OverviewDTO, "today" | "wait" | "records" | "bensin">
  type OverviewSources = { specs: SpecRow[] | null; sessions: SessionRow[] | null; invocations: InvocationRow[] | null; waits: Span[]; limits: LimitSeries[]; recordingSince: number }
  computeOverview(now: number, src: OverviewSources): OverviewDTO
  ```

- [x] **Step 1: Tulis test yang gagal** — tambahkan import `bensinStats, headline, computeOverview, fmtMinutes, fmtClock, type LimitSeries` lalu tambahkan:

```ts
describe("bensinStats", () => {
  const series = (samples: [number, number][], resetsAt: string | null): LimitSeries => ({
    source: "claude", key: "session", label: "Sesi 5 jam", resetsAt,
    samples: samples.map(([mAgo, pct]) => ({ at: NOW - mAgo * 60_000, pct })),
  });
  it("laju naik, habis sebelum reset → verdict habis + exhaustAt", () => {
    // naik 1%/menit; sekarang 60% → habis 40 menit lagi (15.10); reset 18.00
    const [b] = bensinStats(NOW, [series([[30, 30], [20, 40], [10, 50], [0, 60]], at(13, 18).toISOString())]);
    expect(b).toMatchObject({ usedPct: 60, verdict: "habis" });
    expect(Date.parse(b!.exhaustAt!)).toBe(NOW + 40 * 60_000);
    expect(b!.samples).toHaveLength(4);
  });
  it("habis sesudah reset → aman", () => {
    const [b] = bensinStats(NOW, [series([[30, 30], [20, 40], [10, 50], [0, 60]], at(13, 14, 50).toISOString())]);
    expect(b!.verdict).toBe("aman");
  });
  it("kemiringan ≤ 0 → stabil; <4 sampel dalam 60 menit → kurang-data", () => {
    expect(bensinStats(NOW, [series([[30, 60], [20, 60], [10, 60], [0, 60]], null)])[0]!.verdict).toBe("stabil");
    expect(bensinStats(NOW, [series([[90, 10], [80, 20], [10, 50], [0, 60]], null)])[0]!.verdict).toBe("kurang-data");
  });
  it("seri tanpa sampel dilewati", () => {
    expect(bensinStats(NOW, [series([], null)])).toEqual([]);
  });
});

describe("format", () => {
  it("fmtMinutes dan fmtClock", () => {
    expect(fmtMinutes(47)).toBe("47 menit");
    expect(fmtMinutes(60)).toBe("1 jam");
    expect(fmtMinutes(72)).toBe("1 jam 12 menit");
    expect(fmtClock(at(13, 9, 5).getTime())).toBe("09.05");
  });
});

describe("headline", () => {
  const base = { today: { landed: 0, failed: 0 }, wait: { todayMin: 0, yesterdayMin: 0, pctOfLive: null },
    records: { streakDays: 0, bestStreak: 0, bestLandedDay: null, landedRecordToday: false }, bensin: [] };
  it("tanpa fakta menonjol → 'Hari yang tenang.'", () => {
    expect(headline(base)).toEqual({ text: "Hari yang tenang.", parts: [{ text: "Hari yang tenang." }] });
  });
  it("prioritas: tumbang → menunggu ≥30m → mendarat; maks 3, digabung 'A, B, dan C.'", () => {
    const h = headline({ ...base, today: { landed: 3, failed: 1 }, wait: { todayMin: 47, yesterdayMin: 0, pctOfLive: 31 } });
    expect(h.text).toBe("1 sesi tumbang, agen menunggumu 47 menit, dan 3 spec mendarat.");
    expect(h.parts.filter((p) => p.tone === "bad")).toHaveLength(2);
    expect(h.parts.filter((p) => p.tone === "good")).toHaveLength(1);
  });
  it("dua fakta digabung 'A dan B'; huruf pertama kapital", () => {
    expect(headline({ ...base, today: { landed: 2, failed: 0 },
      records: { ...base.records, landedRecordToday: true } }).text).toBe("Rekor baru: 2 spec mendarat.");
    expect(headline({ ...base, today: { landed: 2, failed: 1 } }).text).toBe("1 sesi tumbang dan 2 spec mendarat.");
  });
  it("bensin habis sebelum reset ikut disebut", () => {
    const h = headline({ ...base, bensin: [{ source: "claude", key: "session", label: "Sesi 5 jam", usedPct: 80,
      resetsAt: null, exhaustAt: at(13, 16, 40).toISOString(), verdict: "habis", samples: [] }] });
    expect(h.text).toBe("Limit Sesi 5 jam habis ±16.40.");
  });
  it("menunggu <30 menit tak disebut", () => {
    expect(headline({ ...base, wait: { todayMin: 29, yesterdayMin: 0, pctOfLive: 10 } }).text).toBe("Hari yang tenang.");
  });
});

describe("computeOverview", () => {
  const src = {
    specs: [spec({ createdAt: at(13, 8), startedAt: at(13, 9), doneAt: at(13, 11) })],
    sessions: [sess({ startedAt: at(13, 9), endedAt: at(13, 10), exitCode: 1 })],
    invocations: [], waits: [], limits: [], recordingSince: at(13, 2).getTime(),
  };
  it("merakit semua panel + headline + stempel waktu", () => {
    const o = computeOverview(NOW, src);
    expect(o.today).toEqual({ landed: 1, failed: 1 });
    expect(o.yesterday).toEqual({ landed: 0, failed: 0 });
    expect(o.river?.landed).toBe(1);
    expect(o.tokens?.total).toBe(0);
    expect(o.heatmap?.minutes).toHaveLength(7);
    expect(o.headline.text).toBe("1 sesi tumbang dan 1 spec mendarat.");
    expect(o.generatedAt).toBe(new Date(NOW).toISOString());
    expect(o.recordingSince).toBe(at(13, 2).toISOString());
  });
  it("sumber null → panel yang bergantung padanya null, sisanya tetap; tak pernah melempar", () => {
    const o = computeOverview(NOW, { ...src, specs: null, invocations: null });
    expect(o.today).toBeNull();
    expect(o.river).toBeNull();
    expect(o.records).toBeNull();
    expect(o.tokens).toBeNull();
    expect(o.heatmap).not.toBeNull();
    expect(o.wait).not.toBeNull();
  });
  it("bagian yang melempar → null, bukan exception", () => {
    const bad = [{ kind: "spec", startedAt: null as unknown as Date, endedAt: null, exitCode: null, endedReason: null }];
    expect(() => computeOverview(NOW, { ...src, sessions: bad })).not.toThrow();
    expect(computeOverview(NOW, { ...src, sessions: bad }).heatmap).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST server/test/overview-metrics.test.ts`
Expected: FAIL — `bensinStats is not a function`.

- [x] **Step 3: Implementasi** — tambahkan `OverviewBensin, OverviewDTO, HeadlinePart` ke import tipe, lalu tambahkan di akhir berkas:

```ts
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
```

Catatan: pada test "bagian yang melempar", `startedAt: null` membuat `heatmapStats` melempar saat `s.startedAt.getTime()`. Begitu juga `today`/`records`, yang hanya dibangun dari specs dan sessions; panel-panel itu menjadi `null`.

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST server/test/overview-metrics.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/overview-metrics.ts server/test/overview-metrics.test.ts docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(overview): prakiraan bensin, headline template, computeOverview (ADR-0220)"
```

---

### Task 5: Perekam di memori

**Files:**
- Create: `server/src/services/overview-recorder.ts`, `server/test/overview-recorder.test.ts`
- Modify: `server/src/server.ts:~197` (panggil `startOverviewRecorder()` sesudah `startRetentionSweep();`)

**Interfaces:**
- Consumes: `Span`, `LimitSeries` (Task 3/4); `listSessionsAsync` (`./pty`); `isDeciding` (`./lead/deciding`); `getLimits` (`./limits`); `getCodexLimits` (`./codex-limits`); `LimitWindow` (`@hanoman/shared`).
- Produces:
  ```ts
  type ObservedSession = { id: string; exited: boolean; decision?: boolean; deciding?: boolean; decisionAt?: string }
  observeSessions(list: ObservedSession[], now?: number): void
  observeLimits(source: "claude" | "codex", windows: LimitWindow[], now?: number): void
  waitSpans(): Span[]
  limitSeries(): LimitSeries[]
  recordingSince(): number
  startOverviewRecorder(): void
  __resetRecorder(now?: number): void   // test-only
  ```

- [x] **Step 1: Tulis test yang gagal**

`server/test/overview-recorder.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  observeSessions, observeLimits, waitSpans, limitSeries, recordingSince, __resetRecorder,
} from "../src/services/overview-recorder";

const T = Date.parse("2026-10-13T07:00:00.000Z");
const min = (n: number) => T + n * 60_000;
const s = (id: string, o: { decision?: boolean; deciding?: boolean; exited?: boolean; decisionAt?: string } = {}) =>
  ({ id, exited: false, ...o });
const win = (pct: number) => ({ key: "session", label: "Sesi 5 jam", usedPct: pct,
  resetsAt: "2026-10-13T11:00:00.000Z", severity: "normal" as const, isActive: true });

beforeEach(() => __resetRecorder(T));

describe("episode menunggu", () => {
  it("dibuka saat sesi menunggu (awal = decisionAt), ditutup saat tak lagi menunggu", () => {
    observeSessions([s("a", { decision: true, decisionAt: new Date(min(-5)).toISOString() })], min(0));
    expect(waitSpans()).toEqual([{ start: min(-5), end: null }]);
    observeSessions([s("a", { decision: true, decisionAt: new Date(min(1)).toISOString() })], min(2));
    expect(waitSpans()).toEqual([{ start: min(-5), end: null }]);   // decisionAt yang bergeser tak memindah awal
    observeSessions([s("a")], min(10));
    expect(waitSpans()).toEqual([{ start: min(-5), end: min(10) }]);
  });
  it("sesi yang dilayani lead (deciding) atau sudah exited bukan menunggu", () => {
    observeSessions([s("a", { decision: true, deciding: true }), s("b", { decision: true, exited: true })], min(0));
    expect(waitSpans()).toEqual([]);
  });
  it("sesi yang lenyap dari snapshot menutup episodenya", () => {
    observeSessions([s("a", { decision: true })], min(0));
    observeSessions([], min(3));
    expect(waitSpans()).toEqual([{ start: min(0), end: min(3) }]);
  });
  it("tanpa decisionAt atau decisionAt di masa depan → awal = now", () => {
    observeSessions([s("a", { decision: true, decisionAt: new Date(min(9)).toISOString() })], min(1));
    expect(waitSpans()[0]!.start).toBe(min(1));
  });
  it("episode tertutup dipangkas ke 2000 terakhir", () => {
    for (let i = 0; i < 2005; i++) {
      observeSessions([s(`x${i}`, { decision: true })], T + i * 2);
      observeSessions([], T + i * 2 + 1);
    }
    expect(waitSpans()).toHaveLength(2000);
    expect(waitSpans()[0]!.start).toBe(T + 5 * 2);
  });
});

describe("sampel limit", () => {
  it("menyimpan sampel berjarak ≥25 dtk per window, memangkas >2 jam, mengosongkan saat window reset", () => {
    observeLimits("claude", [win(10)], min(0));
    observeLimits("claude", [win(11)], min(0) + 10_000);           // terlalu rapat → diabaikan
    observeLimits("claude", [win(12)], min(1));
    expect(limitSeries()[0]!.samples.map((p) => p.pct)).toEqual([10, 12]);
    observeLimits("claude", [win(30)], min(130));                   // dua sampel awal > 2 jam → dipangkas
    expect(limitSeries()[0]!.samples.map((p) => p.pct)).toEqual([30]);
    observeLimits("claude", [win(2)], min(131));                    // pct turun = window baru
    expect(limitSeries()[0]!.samples.map((p) => p.pct)).toEqual([2]);
    expect(limitSeries()[0]).toMatchObject({ source: "claude", key: "session", label: "Sesi 5 jam" });
  });
  it("claude dan codex adalah seri terpisah", () => {
    observeLimits("claude", [win(10)], min(0));
    observeLimits("codex", [win(40)], min(0));
    expect(limitSeries().map((x) => x.source).sort()).toEqual(["claude", "codex"]);
  });
});

it("recordingSince = awal perekam", () => {
  expect(recordingSince()).toBe(T);
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST server/test/overview-recorder.test.ts`
Expected: FAIL — modul belum ada.

- [x] **Step 3: Implementasi**

`server/src/services/overview-recorder.ts`:
```ts
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
```

`server/src/server.ts`: tambahkan import `import { startOverviewRecorder } from "./services/overview-recorder";` di dekat import service lain, lalu sesudah `startRetentionSweep();`:
```ts
  // ADR-0220 · perekam menit menunggu & sampel limit untuk Overview (in-process, timer .unref).
  startOverviewRecorder();
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST server/test/overview-recorder.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/overview-recorder.ts server/test/overview-recorder.test.ts server/src/server.ts docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(overview): perekam memori episode menunggu + sampel limit (ADR-0220)"
```

---

### Task 6: Sumber Prisma, route, capability, MCP, grup siar, ADR dan docs server

**Files:**
- Create: `server/src/services/overview-source.ts`, `server/src/routes/overview.ts`, `server/test/overview.route.test.ts`, `internal/docs/adr/0220-overview-koran-pagi.md`
- Modify: `server/src/app.ts:~32,~283`, `server/src/services/agent-capabilities.ts:~108`, `server/src/services/events.ts` (import + entri GROUPS terakhir), `shared/src/mcp-catalog/system.ts` (sesudah `hanoman_limits_codex`), `server/test/events.test.ts:~62`, `docs/agent-integration.md:~547`, `internal/docs/architecture/stack.md:7`, `CLAUDE.md` (kalimat "sebelas grup"), `internal/docs/README.md`

**Interfaces:**
- Consumes: `computeOverview`, `addDays`, `startOfDay`, `AGENT_KINDS` (Task 2–4); `waitSpans`, `limitSeries`, `recordingSince` (Task 5).
- Produces: `getOverview(now?: number): Promise<OverviewDTO>`; `GET /api/overview`; frame WS `{ t: "overview", overview }`; tool `hanoman_overview_get`.

- [x] **Step 1: Tulis test yang gagal**

`server/test/overview.route.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { __resetRecorder } from "../src/services/overview-recorder";
import { getOverview } from "../src/services/overview-source";
import { resetDb, makeProject, makeSpec } from "./factory";
import { paths, zOverview, TOOLS_BY_NAME } from "@hanoman/shared";

const app = buildApp({ requireAuth: false });
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  __resetRecorder();
  await resetDb();
  await prisma.sessionHistory.deleteMany();
  await prisma.agentInvocation.deleteMany();
  await makeProject();
});

describe("GET /api/overview", () => {
  it("menjawab DTO yang lolos zOverview, dari baris DB sungguhan", async () => {
    const now = new Date();
    await makeSpec({ id: "SPEC-OV1", stage: "done", startedAt: now, doneAt: now });
    await prisma.sessionHistory.create({ data: { id: "h1", sessionId: "s1", projectId: "p1", kind: "spec",
      agent: "claude", cwd: "/tmp", startedAt: now, endedAt: now, exitCode: 1, endedReason: "closed" } });
    await prisma.agentInvocation.create({ data: { id: "i1", sessionId: "s1", projectId: "p1", runtime: "claude",
      runtimeInvocationId: "r1", agentName: "implementer", status: "done", startedAt: now,
      inputTokens: 10, outputTokens: 5, cachedTokens: 30 } });
    const res = await app.inject({ method: "GET", url: paths.overview });
    expect(res.statusCode).toBe(200);
    const body = zOverview.parse(res.json());
    expect(body.today).toEqual({ landed: 1, failed: 1 });
    expect(body.tokens?.total).toBe(45);
    expect(body.headline.text).toBe("1 sesi tumbang dan 1 spec mendarat.");
  });

  it("GLOBAL_READ untuk baca, cookie-only untuk tulis", () => {
    expect(capabilityForRoute("GET", "/api/overview")).toBe("GLOBAL_READ");
    expect(capabilityForRoute("POST", "/api/overview")).toBe("COOKIE_ONLY");
  });

  it("tool MCP hanoman_overview_get memanggil GET /overview tanpa capability", () => {
    const t = TOOLS_BY_NAME.get("hanoman_overview_get");
    expect(t).toBeDefined();
    expect(t!.capability).toBeNull();
    expect(t!.build({})).toEqual({ method: "GET", path: "/overview" });
  });

  it("getOverview tak melempar walau DB kosong", async () => {
    await expect(getOverview()).resolves.toMatchObject({ today: { landed: 0, failed: 0 } });
  });
});
```

Sebelum menulis test, cek nama ekspor indeks katalog MCP: `grep -n "export" shared/src/mcp-catalog/index.ts`. Kalau map-nya bukan `TOOLS_BY_NAME`, ganti import dan pemakaiannya dengan ekspor yang ada, misalnya `MCP_TOOLS.find((t) => t.name === …)`. Cek juga field wajib `AgentInvocation` di `server/prisma/schema.prisma:490-522`. Daftar di atas (id, sessionId, projectId, runtime, runtimeInvocationId, agentName, status, startedAt) sudah memenuhi semua kolom tanpa default.

Di `server/test/events.test.ts`, test `"mengirim snapshot semua grup ke klien saat attach"`, tambahkan sebelum `detach(c);`:
```ts
    // ADR-0220 · grup ke-12. Overview tak punya muat awal HTTP di dashboard: tanpa frame ini saat
    // attach, panel metrik kosong sampai 30 dtk pertama berganti.
    expect(c.frames.find((f) => f.t === "overview")).toMatchObject({ overview: { headline: { text: expect.any(String) } } });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST server/test/overview.route.test.ts server/test/events.test.ts`
Expected: FAIL — modul `overview-source` belum ada dan frame `overview` belum disiarkan.

- [x] **Step 3: Implementasi**

`server/src/services/overview-source.ts`:
```ts
import type { OverviewDTO } from "@hanoman/shared";
import { prisma } from "../db";
import { AGENT_KINDS, addDays, computeOverview, startOfDay } from "./overview-metrics";
import { limitSeries, recordingSince, waitSpans } from "./overview-recorder";

// ADR-0220 · pengumpul sumber Overview. Tiap sumber dibaca terpisah: satu query gagal membuat
// panelnya null (computeOverview), bukan seluruh Overview hilang dari dashboard.
async function settle<T>(label: string, p: Promise<T>): Promise<T | null> {
  try { return await p; } catch (err) { console.warn(`overview: sumber ${label} gagal:`, err); return null; }
}

const RECORD_WINDOW_DAYS = 90;

export async function getOverview(now = Date.now()): Promise<OverviewDTO> {
  const since = new Date(addDays(startOfDay(now), -(RECORD_WINDOW_DAYS - 1)));
  const sinceYesterday = new Date(addDays(startOfDay(now), -1));
  const [specs, sessions, invocations] = await Promise.all([
    settle("spec", prisma.spec.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { startedAt: { gte: since } }, { doneAt: { gte: since } }] },
      select: { createdAt: true, startedAt: true, doneAt: true },
    })),
    settle("sessionHistory", prisma.sessionHistory.findMany({
      where: { kind: { in: [...AGENT_KINDS] },
        OR: [{ startedAt: { gte: since } }, { endedAt: null }, { endedAt: { gte: since } }] },
      select: { kind: true, startedAt: true, endedAt: true, exitCode: true, endedReason: true },
    })),
    settle("agentInvocation", prisma.agentInvocation.findMany({
      where: { startedAt: { gte: sinceYesterday } },
      select: { agentName: true, startedAt: true, inputTokens: true, outputTokens: true, cachedTokens: true },
    })),
  ]);
  return computeOverview(now, {
    specs, sessions, invocations, waits: waitSpans(), limits: limitSeries(), recordingSince: recordingSince(),
  });
}
```

`server/src/routes/overview.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { getOverview } from "../services/overview-source";

// ADR-0220 · muat untuk agen/MCP. Dashboard TIDAK memanggilnya: grup siar `overview` di
// /api/events/ws yang mengantar agregat ini (ADR-0039).
export default async function (app: FastifyInstance) {
  app.get("/overview", async () => getOverview());
}
```

`server/src/app.ts`: tambah `import overview from "./routes/overview";` di sebelah `import presence …`, dan sesudah `await api.register(presence);` tambahkan:
```ts
  await api.register(overview);   // ADR-0220 · agregat Overview untuk agen/MCP
```

`server/src/services/agent-capabilities.ts`: pada kondisi `GLOBAL_READ`, tambahkan `|| top === "overview"`:
```ts
  if (top === "limits" || top === "update" || top === "events" || top === "fs" || top === "health"
    || top === "models" || top === "methods" || top === "codex" || top === "overview")
    return read ? "GLOBAL_READ" : "COOKIE_ONLY";
```
Tambahkan juga baris komentar tepat di atasnya: `// ADR-0220 · `overview` = agregat angka tanpa id/judul (preseden grup `pending`).`

`server/src/services/events.ts`: tambah `import { getOverview } from "./overview-source";`, lalu tambahkan entri terakhir di array `GROUPS` (sesudah grup `pending`):
```ts
  // ADR-0220 · grup GLOBAL ke-12 · agregat Overview "Koran Pagi". 30 dtk: angkanya harian, bukan
  // detik-an. `generatedAt` berubah tiap build, jadi kunci dedup mengosongkannya; frame lahir hanya
  // saat isi agregat benar-benar berubah. Tidak `cookieOnly`: angka agregat tanpa id/judul.
  { everyTicks: 30, last: "", build: async () => ({ t: "overview", overview: await getOverview() }),
    sig: (m) => JSON.stringify({ ...(m.overview as object), generatedAt: null }) },
```

`shared/src/mcp-catalog/system.ts`: sesudah objek `hanoman_limits_codex`, tambahkan:
```ts
  {
    name: "hanoman_overview_get",
    title: "Ringkasan kinerja hari ini (Overview)",
    description:
      "Agregat kinerja workspace hari ini vs kemarin, persis yang tampil di layar Overview \"Koran Pagi\": spec mendarat, sesi agen tumbang, menit agen menunggu jawaban manusia, token agen tercatat (hanya subagen/agen fase), prakiraan kapan limit habis dibanding reset, peta panas jam kerja agen 7×24, streak/rekor, dan headline-nya. Menit menunggu & prakiraan limit direkam di memori server dan hilang saat restart (`recordingSince`). Panel `null` = sumbernya gagal dibaca. Tak menuntut capability apa pun.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/overview", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/overview" }),
    shape: (raw) => raw,
  },
```

`docs/agent-integration.md`: sesudah baris 547 (`| \`hanoman_health\`, …`), tambahkan:
```md
| `hanoman_overview_get` | baca | — (`GLOBAL_READ`, ADR-0220) |
```

`internal/docs/adr/0220-overview-koran-pagi.md`:
```md
# ADR-0220 · Overview "Koran Pagi": grup siar `overview`, perekam memori, headline template

Status: diterima · 2026-10-13 · Mengamandemen susunan Overview Fase 3B (Audit UI/UX 2026-10)

## Konteks

Overview Fase 3B hanya menampilkan keadaan saat ini (sesi berjalan, project bermasalah, limit).
Operator tak punya jawaban untuk "bagaimana hari ini berjalan?": berapa spec selesai, berapa sesi
gagal, berapa lama agen menunggu jawabannya, kapan limit habis. Data untuk sebagian besar pertanyaan
itu sudah tersimpan (`Spec.doneAt`, `SessionHistory`, `AgentInvocation`), tapi dua fakta tidak:
lamanya episode menunggu (`decisionAt` lenyap begitu dijawab) dan riwayat `usedPct` limit.

## Keputusan

1. **Grup snapshot GLOBAL ke-12 `overview`** di `/api/events/ws`, `everyTicks: 30`, dedup dengan
   `generatedAt` dikosongkan. Tidak `cookieOnly`: muatannya agregat angka tanpa id/judul (preseden
   `pending`, SPEC-961). Muat untuk agen: `GET /api/overview` (`GLOBAL_READ`) dan tool MCP
   `hanoman_overview_get` (ADR-0202). Dashboard tidak memanggil route itu (ADR-0039).
2. **Perekam di memori** (`overview-recorder.ts`) dengan timer sendiri 10 dtk (`.unref`), bukan
   loop siar yang hanya hidup saat ada klien. Episode menunggu (maks 2.000) dan sampel limit
   (2 jam, jarak ≥25 dtk) **hilang saat restart**. `recordingSince` dikirim supaya UI jujur.
   Penyimpanan permanen ditunda ke ADR terpisah bila angkanya terbukti perlu bertahan.
3. **Perhitungan murni** di `overview-metrics.ts`. Hari = 00.00 lokal mesin. Sesi agen = kind
   `spec|reverse|prd|scaffold|breakdown|telegram`. Tumbang = `sessionOutcome() === "failed"`.
4. **Headline template deterministik, tanpa LLM**: prioritas tumbang → menunggu ≥30 menit → rekor
   baru → bensin habis sebelum reset → spec mendarat, maks tiga fakta, fallback "Hari yang tenang.".
5. **Denyut** (EKG armada) memakai frame `sessions` yang sudah ada dan animasi CSS murni. Ia tidak
   mengikuti `activityAt`: menambahkannya ke `SessionDTO` membuat frame terbesar dashboard
   terkirim tiap detik.

## Konsekuensi

- Satu query ringan per 30 dtk per instance (tiga `findMany` berindeks) saat ada klien, dan satu
  `tmux list-panes` asinkron tiap 10 dtk untuk perekam, walau tanpa klien.
- Token hanya parsial (AgentInvocation); UI melabelinya "token agen tercatat". Biaya mata uang
  tidak ditampilkan karena tak ada datanya.
- Fase 3B "tanpa KPI strip, tanpa hero" untuk Overview dibatalkan oleh susunan koran ini; aturan
  Fase 3B lain tetap berlaku.
```

`internal/docs/architecture/stack.md:7`: pada sel yang menyebut grup global siar, tambahkan `overview` (ADR-0220) ke daftar grup. Bila sel itu menyebut jumlah, ubah menjadi dua belas.

`CLAUDE.md`: ganti `sebelas grup snapshot global — termasuk \`presence\`, sesi hidup lintas device (SPEC-919/ADR-0147) —` menjadi `dua belas grup snapshot global — termasuk \`presence\`, sesi hidup lintas device (SPEC-919/ADR-0147), dan \`overview\`, agregat Overview "Koran Pagi" (ADR-0220) —`.

`internal/docs/README.md`: tambahkan butir baru di dekat butir desain-desain superpowers lain (sekitar baris 26):
```md
- [desain Overview "Koran Pagi"](../../docs/superpowers/specs/2026-10-13-overview-koran-pagi-design.md) · [plan](../../docs/superpowers/plans/2026-10-13-overview-koran-pagi.md) — Overview jadi halaman depan koran: headline template, denyut armada, menit menunggu, ekonomi token, prakiraan bensin, sungai spec, peta panas 7×24, rekor. Grup siar ke-12 `overview` + perekam memori. [ADR-0220](adr/0220-overview-koran-pagi.md)
```

- [x] **Step 4: Jalankan test, pastikan lulus** — termasuk test kontrak MCP/capability/doc yang tersentuh:

Run: `TEST server/test/overview.route.test.ts server/test/events.test.ts server/test/mcp-coverage.test.ts server/test/agent-capabilities.test.ts server/test/agent-doc-contract.test.ts server/test/agent-tool-catalog.test.ts`
Expected: PASS. Bila `agent-capabilities.test.ts` punya tabel lengkap rute `GLOBAL_READ`, tambahkan `"/api/overview"` ke tabel itu dan jalankan ulang.

- [x] **Step 5: Uji API nyata di lokal**

```bash
pnpm --filter ./server build && (node server/dist/server.js > /tmp/hn-ovk/server.log 2>&1 &) ; sleep 4
curl -s http://127.0.0.1:$(grep -o 'listening.*:[0-9]*' /tmp/hn-ovk/server.log | grep -o '[0-9]*$' | tail -1)/api/overview | head -c 600
```
Expected: JSON dengan `generatedAt`, `headline.text`, dan `heatmap.days` sepanjang 7. Bila route meminta cookie, login lewat dashboard lalu ulangi dengan cookie. Setelah selesai, matikan proses server itu (`pkill -f server/dist/server.js`; pastikan dulu tidak ada instance hanoman lain yang memakai perintah yang sama).

- [x] **Step 6: Commit**

```bash
git add server/src/services/overview-source.ts server/src/routes/overview.ts server/test/overview.route.test.ts server/src/app.ts server/src/services/agent-capabilities.ts server/src/services/events.ts server/test/events.test.ts shared/src/mcp-catalog/system.ts docs/agent-integration.md internal/docs/adr/0220-overview-koran-pagi.md internal/docs/architecture/stack.md CLAUDE.md internal/docs/README.md docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(overview): grup siar ke-12 overview, GET /api/overview, MCP hanoman_overview_get (ADR-0220)"
```

---

### Task 7: Kerangka koran di frontend — Masthead, Headline, Koreksi, Indeks Project

**Files:**
- Create: `src/src/screens/overview/format.ts`, `Delta.tsx`, `Masthead.tsx`, `Headline.tsx`, `Koreksi.tsx`, `IndeksProject.tsx`
- Modify: `src/src/screens/OverviewScreen.tsx`, `src/src/screens/styles/overview.css`, `src/src/App.tsx` (state + subscribe + prop), `src/test/overview-screen.test.tsx`

**Interfaces:**
- Consumes: `OverviewDTO` (`@hanoman/shared`).
- Produces:
  ```ts
  // format.ts
  fmtMinutes(min: number): string; fmtTokens(n: number): string; fmtDuration(ms: number): string
  fmtClock(iso: string | number): string; longDate(t: number): string
  // komponen
  <Delta now={number} prev={number} goodWhen="up" | "down" | "neutral" />
  <Masthead now={number} projectCount={number} />
  <Headline overview={OverviewDTO | null} />
  <Koreksi projects={ProjectVM[]} onOpen={(p: ProjectVM) => void} />           // null bila kosong
  <IndeksProject projects={ProjectVM[]} total={number} backlog={SpecSlim[]} onOpen onGoto />
  OverviewScreen props += { overview?: OverviewDTO | null }
  ```

- [x] **Step 1: Perbarui test layar (gagal dulu)**

Di `src/test/overview-screen.test.tsx`:
1. Tambah import `import type { OverviewDTO } from "@hanoman/shared";` dan helper:
   ```ts
   const ov = (over: Partial<OverviewDTO> = {}): OverviewDTO => ({
     generatedAt: new Date().toISOString(), recordingSince: new Date(0).toISOString(),
     today: { landed: 3, failed: 1 }, yesterday: { landed: 2, failed: 0 }, river: null, tokens: null, wait: null,
     bensin: [], heatmap: null, records: null,
     headline: { text: "1 sesi tumbang dan 3 spec mendarat.", parts: [
       { text: "1 sesi tumbang", tone: "bad" }, { text: " dan " }, { text: "3 spec mendarat", tone: "good" }, { text: "." }] },
     ...over,
   });
   ```
2. Pada `describe("Overview · perlu perhatian dan project")`, ganti setiap `{ name: "Perlu perhatian" }` dengan `{ name: "Koreksi" }` dan setiap `{ name: "Project" }` dengan `{ name: "Indeks project" }`. Ganti teks `"Semua project ada di Perlu perhatian."` dengan `"Semua project ada di Koreksi."` dan `"1 dari 3 · sisanya di atas"` dengan `"1 dari 3 · sisanya di Koreksi"`.
3. Ganti test `"tanpa masalah dokumen, tampil 'Dokumen sudah sesuai standar'"` dengan:
   ```ts
   it("tanpa masalah dokumen, kotak Koreksi tak tampil sama sekali (ralat hanya bila ada yang diralat)", () => {
     render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]} sessions={[]}
       onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
     expect(screen.queryByRole("region", { name: "Koreksi" })).toBeNull();
   });
   ```
4. Hapus tiga test "Aktivitas terbaru" (`"aktivitas terbaru: hanya proyek yang berjalan…"`, `"aktivitas terbaru: maksimal lima baris…"`, `"proyek di 'Perlu perhatian' tak diulang di 'Aktivitas terbaru'…"`), lalu ganti test `"tanpa proyek yang berjalan, 'Aktivitas terbaru' tak tampil…"` dengan:
   ```ts
   it("seksi 'Aktivitas terbaru' sudah tidak ada: aktivitas sesi kini dibaca dari Denyut", () => {
     render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]}
       sessions={[session({ id: "s1", projectId: "a" })]} onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
     expect(screen.queryByText("Aktivitas terbaru")).toBeNull();
   });
   ```
5. Tambahkan describe baru:
   ```ts
   describe("Overview · koran", () => {
     it("masthead 'Kabar Hanoman' dengan tanggal panjang dan jumlah project", () => {
       render(<OverviewScreen projects={[project({ id: "a", name: "alpha" }), project({ id: "b", name: "beta" })]}
         backlog={[]} sessions={[]} overview={ov()} onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
       expect(screen.getByText("Kabar Hanoman")).toBeTruthy();
       expect(screen.getByText("2 project")).toBeTruthy();
       expect(screen.getByText(/Edisi langsung · \d{2}\.\d{2}/)).toBeTruthy();
     });
     it("headline dirender per bagian dengan nada", () => {
       const { container } = render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]}
         sessions={[]} overview={ov()} onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
       const h = container.querySelector(".hn-ovk-headline")!;
       expect(h.textContent).toBe("1 sesi tumbang dan 3 spec mendarat.");
       expect(h.querySelector(".hn-ovk-tone--bad")!.textContent).toBe("1 sesi tumbang");
       expect(h.querySelector(".hn-ovk-tone--good")!.textContent).toBe("3 spec mendarat");
     });
     it("sebelum frame overview tiba, headline tampil sebagai kerangka (bukan angka nol)", () => {
       const { container } = render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]}
         sessions={[]} overview={null} onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
       expect(container.querySelector(".hn-ovk-headline .hn-skeleton, .hn-ovk-headline [aria-busy='true']")).not.toBeNull();
     });
   });
   ```
6. Di `describe("Overview · kontrak layout")`, ubah nama test `"satu kolom tanpa inline grid…"` menjadi `"tanpa inline grid atau layout inline: layout lewat kelas hn-ov-*/hn-ovk-*"`. Isinya tetap.

Run: `TEST src/test/overview-screen.test.tsx`
Expected: FAIL — "Kabar Hanoman" dan region "Koreksi" belum ada.

Sebelum lanjut: periksa API `Skeleton` di `src/src/ds/components/skeleton.tsx` (nama kelas atau atribut yang dirender). Sesuaikan selektor test di butir 5 dengan yang benar-benar dirender (`.hn-skeleton` atau `[aria-busy='true']`), lalu biarkan selektornya tetap satu.

- [x] **Step 2: Implementasi formatter dan komponen**

`src/src/screens/overview/format.ts`:
```ts
// ADR-0220 · formatter Overview "Koran Pagi" (id-ID). Murni; dipakai semua panel.
export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} menit`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} jam ${m} menit` : `${h} jam`;
}
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} rb`;
  return String(n);
}
export function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h ? `${d} hari ${h} jam` : `${d} hari`;
  if (h > 0) return m ? `${h} jam ${m} menit` : `${h} jam`;
  return `${m} menit`;
}
export function fmtClock(t: string | number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
}
const LONG_DATE = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const longDate = (t: number): string => LONG_DATE.format(t);
```

`src/src/screens/overview/Delta.tsx`:
```tsx
import React from "react";

/** ↑/↓ vs kemarin. `goodWhen` menentukan arah yang diwarnai baik; "neutral" tak diwarnai. */
export function Delta({ now, prev, goodWhen }: { now: number; prev: number; goodWhen: "up" | "down" | "neutral" }) {
  const diff = now - prev;
  if (diff === 0) return <span className="hn-ovk-delta">= kemarin</span>;
  const up = diff > 0;
  const tone = goodWhen === "neutral" ? "" : (up === (goodWhen === "up") ? " hn-ovk-tone--good" : " hn-ovk-tone--bad");
  return <span className={`hn-ovk-delta${tone}`}>{up ? "↑" : "↓"}{Math.abs(diff)} vs kemarin</span>;
}
```

`src/src/screens/overview/Masthead.tsx`:
```tsx
import React from "react";
import { fmtClock, longDate } from "./format";

export function Masthead({ now, projectCount }: { now: number; projectCount: number }) {
  return (
    <header className="hn-ovk-masthead">
      <p className="hn-ovk-title">Kabar Hanoman</p>
      <div className="hn-ovk-dateline">
        <span>{longDate(now)}</span>
        <span>Edisi langsung · {fmtClock(now)}</span>
        <span>{projectCount} project</span>
      </div>
    </header>
  );
}
```

`src/src/screens/overview/Headline.tsx`:
```tsx
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { Skeleton } from "../../ds";

export function Headline({ overview }: { overview: OverviewDTO | null }) {
  if (!overview) return <p className="hn-ovk-headline"><Skeleton width="70%" /></p>;
  return (
    <p className="hn-ovk-headline">
      {overview.headline.parts.map((p, i) => p.tone
        ? <span key={i} className={`hn-ovk-tone--${p.tone}`}>{p.text}</span>
        : <React.Fragment key={i}>{p.text}</React.Fragment>)}
    </p>
  );
}
```
(Bila prop `Skeleton` bukan `width`, pakai props yang diterima komponen itu di `src/src/ds/components/skeleton.tsx`.)

`src/src/screens/overview/Koreksi.tsx`: pindahkan `AttnRow`, `ATTENTION_REASON`, dan `attentionOf` dari `OverviewScreen.tsx` ke sini, lalu ekspor `attentionOf`:
```tsx
import React from "react";
import { DenseRow, RowList, StatusPill } from "../../ds";
import { DOC_STATUS_LABEL, labelOf } from "../../lib/labels";
import type { ProjectVM } from "../types";

// Dokumen rusak perlu tindakan; drift hanya tidak sinkron.
export function attentionOf(p: ProjectVM): "high" | "low" | "none" {
  return p.docStatus === "broken" ? "high" : p.docStatus === "drift" ? "low" : "none";
}
const ATTENTION_REASON: Record<string, string> = {
  broken: "Dokumen belum memenuhi standar",
  drift: "Sebagian kategori dokumen belum terindeks",
};

/** Kotak ralat ala koran: hanya tampil bila ada project broken/drift (pengganti "Perlu perhatian"). */
export function Koreksi({ projects, onOpen }: { projects: ProjectVM[]; onOpen: (p: ProjectVM) => void }) {
  const list = projects.filter((p) => attentionOf(p) !== "none")
    .sort((a, b) => (attentionOf(a) === "high" ? 0 : 1) - (attentionOf(b) === "high" ? 0 : 1));
  if (list.length === 0) return null;
  return (
    <section className="hn-ovk-koreksi" aria-labelledby="ovk-koreksi">
      <h3 id="ovk-koreksi" className="hn-ovk-kicker">Koreksi</h3>
      <RowList label="Koreksi">
        {list.map((p) => (
          <DenseRow key={p.id} onClick={() => onOpen(p)}>
            <StatusPill status={p.docStatus} variant="dot" size="sm">{labelOf(DOC_STATUS_LABEL, p.docStatus)}</StatusPill>
            <span className="hn-ov-name" title={p.name}>{p.name}</span>
            <span className="hn-ov-meta">{`${ATTENTION_REASON[p.docStatus] ?? ""} · cakupan ${p.coverage}%`}</span>
          </DenseRow>
        ))}
      </RowList>
    </section>
  );
}
```

`src/src/screens/overview/IndeksProject.tsx`: pindahkan `PrjRow` dan `coverageTone` ke sini:
```tsx
import React from "react";
import { Button, DenseRow, Icon, ProgressBar, RowList, StatusPill } from "../../ds";
import { DOC_STATUS_LABEL, labelOf } from "../../lib/labels";
import type { ProjectVM, SpecSlim } from "../types";

function coverageTone(status: string): "err" | "warn" | "ok" {
  return status === "broken" ? "err" : status === "drift" ? "warn" : "ok";
}

/** Tabel bursa project. `projects` = yang TIDAK ada di Koreksi, urut cakupan terendah. */
export function IndeksProject({ projects, total, backlog, onOpen, onGoto }: {
  projects: ProjectVM[]; total: number; backlog: SpecSlim[];
  onOpen: (p: ProjectVM) => void; onGoto: (s: string) => void;
}) {
  const briefN = backlog.filter((s) => s.source === "brief").length;
  const qaN = backlog.filter((s) => s.source === "qa").length;
  const hiPrio = backlog.filter((s) => s.priority === "tinggi").length;
  return (
    <section className="hn-ov-section hn-ovk-indeks" aria-labelledby="ovk-indeks">
      <header className="hn-ov-head">
        <div className="hn-ov-head-text">
          <h3 id="ovk-indeks" className="hn-ovk-kicker">Indeks project</h3>
          {projects.length < total && <span className="hn-ov-meta">{`${projects.length} dari ${total} · sisanya di Koreksi`}</span>}
        </div>
        <div className="hn-ov-head-actions">
          <Button size="sm" variant="ghost" leftIcon="layout-grid" onClick={() => onGoto("projects")}>Semua project</Button>
        </div>
      </header>
      {projects.length === 0
        ? <p className="hn-ov-meta hn-ov-none">Semua project ada di Koreksi.</p>
        : <RowList label="Indeks project" className="hn-ov-prj">
            {projects.map((p) => (
              <DenseRow key={p.id} onClick={() => onOpen(p)}>
                <span className="hn-ov-name" title={p.name}>{p.name}</span>
                <span className="hn-ov-cov">
                  <ProgressBar className="hn-ov-bar" value={p.coverage} tone={coverageTone(p.docStatus)} size="sm"
                    aria-label={`Cakupan dokumen ${p.name}`} valueText={`${p.coverage}%`} />
                  <span className="hn-ov-pct">{p.coverage}%</span>
                </span>
                <span className="hn-ov-prj-status">
                  <StatusPill status={p.docStatus} variant="dot" size="sm">{labelOf(DOC_STATUS_LABEL, p.docStatus)}</StatusPill>
                </span>
                <span className="hn-ov-meta hn-ov-prj-meta">{p.backlog} item terbuka</span>
              </DenseRow>
            ))}
          </RowList>}
      <div className="hn-ov-foot">
        <button type="button" className="hn-ov-foot-link" onClick={() => onGoto("backlog")}>
          <Icon name="list-checks" size={15} />
          <span>Backlog: {briefN} dari brief · {qaN} dari QA · {hiPrio} prioritas tinggi</span>
        </button>
      </div>
    </section>
  );
}
```

- [x] **Step 3: Susun ulang `OverviewScreen.tsx`**

Ganti seluruh isi berkas dengan versi di bawah. Daftar "Sesi berjalan" dan seksi limit **sementara dipertahankan**; Task 8 dan 9 menggantinya. Seksi "Aktivitas terbaru", `ActRow`, `AttnRow`, `PrjRow` dihapus.
```tsx
/* OverviewScreen — "Koran Pagi" (ADR-0220). Halaman depan surat kabar: masthead, headline template dari
   server, kotak Koreksi (project broken/drift), lalu kolom-kolom panel. Agregat datang dari grup siar
   `overview` (prop `overview`, null sampai frame pertama tiba). Susunan lewat styles/overview.css; berkas
   ini tanpa style inline. Mengamandemen susunan Fase 3B (Audit UI/UX 2026-10). */
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { Button, DenseRow, Icon, PageHeader, RowList, StateBlock, StatusPill, Tabs } from "../ds";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, SpecSlim } from "./types";
import { LimitWindows } from "./LimitIndicator";
import { FLOW_LABEL, STAGE_LABEL, labelOf } from "../lib/labels";
import { relativeTime } from "../lib/time-format";
import { useLimits } from "../api/limits";
import { useCodexLimits } from "../api/codex-limits";
import { Masthead } from "./overview/Masthead";
import { Headline } from "./overview/Headline";
import { Koreksi, attentionOf } from "./overview/Koreksi";
import { IndeksProject } from "./overview/IndeksProject";
import "./styles/overview.css";

// Menunggu manusia: cermin pet-state.ts dan Terminal (decision && !deciding). Yang deciding dilayani lead.
const isWaiting = (s: TerminalSession) => !!s.decision && !s.deciding;

// Yang menunggu di atas; lalu yang lebih lama mulai; sesi tanpa waktu mulai di bawah; lalu per id.
function sortLive(live: TerminalSession[], specById: Map<string, SpecSlim>): TerminalSession[] {
  const startOf = (s: TerminalSession) => {
    const started = s.specId ? specById.get(s.specId)?.startedAt : null;
    const ms = started ? Date.parse(started) : Number.NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return [...live].sort((a, b) => (Number(!isWaiting(a)) - Number(!isWaiting(b)))
    || (startOf(a) - startOf(b)) || a.id.localeCompare(b.id));
}

function LiveRow({ s, name, spec, now, onOpen }: {
  s: TerminalSession; name: string; spec: SpecSlim | undefined; now: number; onOpen: (id: string) => void;
}) {
  const waiting = isWaiting(s);
  const fase = waiting ? "Menunggu jawabanmu"
    : spec ? labelOf(STAGE_LABEL, spec.stage) : s.flow ? labelOf(FLOW_LABEL, s.flow) : "Sesi";
  const started = relativeTime(spec?.startedAt, now);
  return (
    <DenseRow onClick={() => onOpen(s.id)}
      actions={waiting ? <Button size="sm" variant="secondary" onClick={() => onOpen(s.id)}>Jawab</Button> : undefined}>
      <StatusPill status={waiting ? "awaiting" : "running"} variant="dot" size="sm">{fase}</StatusPill>
      <span className="hn-ov-name" title={name}>{name}</span>
      <span className="hn-ov-meta">{[spec?.id, started && `dimulai ${started}`].filter(Boolean).join(" · ")}</span>
    </DenseRow>
  );
}

export function OverviewScreen({ projects, backlog, sessions, overview = null, onOpenProject, onGoto, onOpenSession, onCreateProject }:
  { projects: ProjectVM[]; backlog: SpecSlim[]; sessions: TerminalSession[];
    /** ADR-0220 · agregat dari grup siar `overview`; null sampai frame pertama tiba. */
    overview?: OverviewDTO | null;
    onOpenProject: (p: ProjectVM) => void; onGoto: (s: string) => void;
    onOpenSession: (id: string) => void;
    /** Membuka modal project baru langsung (CTA onboarding); tanpa ini jatuh ke halaman Projects. */
    onCreateProject?: () => void }) {
  const limits = useLimits();
  const codexLimits = useCodexLimits();
  const [limitTab, setLimitTab] = React.useState<"claude" | "codex">("claude");
  const now = Date.now();

  if (projects.length === 0) {
    return (
      <div className="hn-ov">
        <PageHeader className="hn-ov-pagehead" title="Hari ini" description="Belum ada project di workspace." />
        <section className="hn-ov-section" aria-labelledby="ov-start">
          <header className="hn-ov-head"><div className="hn-ov-head-text">
            <h3 id="ov-start" className="hn-ov-title">Selamat datang di hanoman</h3>
            <span className="hn-ov-meta">mulai di sini</span>
          </div></header>
          <StateBlock kind="empty" illustration="PST-001" illustrationDecorative
            title="Buat project pertama"
            hint="hanoman mengerjakan backlog di dalam sebuah project. Tambahkan project (folder repo) dulu; dokumen, backlog, dan sesi Claude Code-nya akan tampil di sini."
            action={() => (onCreateProject ? onCreateProject() : onGoto("projects"))} actionLabel="Buat project pertama" />
        </section>
      </div>
    );
  }

  const specById = new Map(backlog.map((s) => [s.id, s] as const));
  const live = sortLive(sessions.filter((s) => !s.exited), specById);
  const waiting = live.filter(isWaiting);
  const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
  const attentionN = projects.filter((p) => attentionOf(p) !== "none").length;
  const others = projects.filter((p) => attentionOf(p) === "none").sort((a, b) => a.coverage - b.coverage);

  const summary = [
    live.length > 0 ? `${live.length} sesi berjalan` : null,
    waiting.length > 0 ? `${waiting.length} menunggu jawabanmu` : null,
    attentionN > 0 ? `${attentionN} perlu perhatian` : null,
  ].filter(Boolean).join(" · ");

  const primary = waiting.length > 0
    ? <Button variant="primary" leftIcon="hand" onClick={() => onOpenSession(waiting[0]!.id)}>Jawab sesi yang menunggu</Button>
    : <Button variant="primary" leftIcon="list-checks" onClick={() => onGoto("backlog")}>Buka backlog</Button>;

  const codexOn = codexLimits.status !== "unavailable";
  const tab = codexOn ? limitTab : "claude";
  const limitMeta = tab === "codex"
    ? `tercatat · Codex${codexLimits.plan ? ` · ${codexLimits.plan}` : ""}`
    : "langsung · Claude";

  return (
    <div className="hn-ov hn-ovk">
      <Masthead now={now} projectCount={projects.length} />
      <PageHeader className="hn-ov-pagehead" title="Hari ini" description={summary}
        actions={<>{primary}<Button variant="ghost" leftIcon="drama" onClick={() => onGoto("dalang")}>Buka panggung</Button></>} />
      <Headline overview={overview} />
      <Koreksi projects={projects} onOpen={onOpenProject} />

      <div className="hn-ovk-cols">
        <div className="hn-ovk-col hn-ovk-col--lead">
          <section className="hn-ov-section" aria-labelledby="ov-live">
            <header className="hn-ov-head">
              <div className="hn-ov-head-text"><h3 id="ov-live" className="hn-ovk-kicker">Sesi berjalan</h3></div>
              <div className="hn-ov-head-actions">
                <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGoto("terminal")}>Buka Terminal</Button>
              </div>
            </header>
            {live.length === 0
              ? <p className="hn-ov-empty">
                  <Icon name="terminal" size={14} />
                  <span>Tidak ada sesi berjalan</span>
                  <span className="hn-ov-meta">Mulai sebuah backlog item untuk membuka sesi Claude Code interaktif.</span>
                </p>
              : <RowList label="Sesi berjalan">
                  {live.map((s) => (
                    <LiveRow key={s.id} s={s} name={nameById.get(s.projectId) ?? s.projectId}
                      spec={s.specId ? specById.get(s.specId) : undefined} now={now} onOpen={onOpenSession} />
                  ))}
                </RowList>}
          </section>
        </div>
        <div className="hn-ovk-col hn-ovk-col--side">
          <section className="hn-ov-section" aria-labelledby="ov-limit">
            <header className="hn-ov-head"><div className="hn-ov-head-text">
              <h3 id="ov-limit" className="hn-ovk-kicker">Limit langganan</h3>
              <span className="hn-ov-meta">{limitMeta}</span>
            </div></header>
            {codexOn && (
              <Tabs aria-label="Sumber limit" value={tab}
                tabs={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }]}
                onChange={(v) => setLimitTab(v === "codex" ? "codex" : "claude")} />
            )}
            <div className="hn-ov-limit"><LimitWindows dto={tab === "codex" ? codexLimits : limits} /></div>
          </section>
        </div>
      </div>

      <IndeksProject projects={others} total={projects.length} backlog={backlog} onOpen={onOpenProject} onGoto={onGoto} />
    </div>
  );
}
```
Catatan: test "tanpa sesi, keadaan kosong…" mencari `getByRole("region", { name: "Sesi berjalan" })`. Section ber-`aria-labelledby` dengan `<h3 id="ov-live">` memenuhi itu.

- [x] **Step 4: CSS kerangka koran** — tambahkan di akhir `src/src/screens/styles/overview.css`:
```css
/* ADR-0220 · Overview "Koran Pagi". Kerangka broadsheet: masthead, headline, lalu kolom. */
.hn-ovk-masthead { text-align: center; margin-bottom: var(--space-2, 8px); }
.hn-ovk-title { margin: 0; font-family: var(--font-display); font-size: 30px; font-weight: 600;
  letter-spacing: .02em; color: var(--text-strong); }
.hn-ovk-dateline { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  border-top: 2px solid var(--text-strong); border-bottom: 1px solid var(--text-strong);
  padding: 4px 0; margin-top: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); }
.hn-ovk-headline { margin: 14px 0 6px; font-family: var(--font-display); font-size: 26px; line-height: 1.25;
  color: var(--text-strong); max-width: 46ch; }
.hn-ovk-tone--bad { color: var(--clay-600); }
.hn-ovk-tone--good { color: var(--leaf-600); }
.hn-ovk-kicker { margin: 0; font-family: var(--font-ui); font-size: 11px; font-weight: 600; letter-spacing: .12em;
  text-transform: uppercase; color: var(--text-subtle); }
.hn-ovk-delta { font-size: 12px; color: var(--text-muted); }
.hn-ovk-koreksi { border: 1px solid var(--border-hair); border-left: 3px solid var(--amber-600);
  background: var(--surface-card); padding: 8px 12px; margin: 8px 0 12px; }
.hn-ovk-cols { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 16px; align-items: start; }
.hn-ovk-col { display: grid; gap: 16px; min-width: 0; }
.hn-ovk-col--lead { grid-column: 1; }
.hn-ovk-col--mid { grid-column: 2; }
.hn-ovk-col--side { grid-column: 3; }
.hn-ovk-indeks .hn-ov-pct, .hn-ovk-indeks .hn-ov-prj-meta { font-family: var(--font-mono); }
.hn-ovk-indeks .hn-ov-prj > * { border-bottom: 1px dotted var(--border-hair); }
@media (max-width: 1100px) {
  .hn-ovk-cols { grid-template-columns: 1fr 1fr; }
  .hn-ovk-col--lead { grid-column: 1 / -1; }
  .hn-ovk-col--mid { grid-column: 1; }
  .hn-ovk-col--side { grid-column: 2; }
}
@media (max-width: 720px) {
  .hn-ovk-cols { grid-template-columns: 1fr; }
  .hn-ovk-col--lead, .hn-ovk-col--mid, .hn-ovk-col--side { grid-column: 1; }
  .hn-ovk-col--side { order: 2; }
  .hn-ovk-col--mid { order: 3; }
  .hn-ovk-headline { font-size: 21px; }
  .hn-ovk-title { font-size: 24px; }
}
```
Variabel `--space-2`, `--surface-card`, `--border-hair`, `--clay-600`, `--leaf-600`, `--amber-600`, `--text-*`, `--font-*` sudah ada di `src/src/ds/tokens`. Cek `--space-2` dengan `grep -n "space-2" src/src/ds/tokens/spacing.css`; kalau tak ada, pakai `8px`.

Urutan mobile di spec adalah Headline → Denyut → Bottleneck → Bensin → sisanya. Denyut dan Bottleneck ada di kolom lead (urutan 1), Bensin di kolom side (`order: 2`), lalu kolom mid.

- [x] **Step 5: App.tsx** — di `src/src/App.tsx`:
1. Import tipe: tambahkan `OverviewDTO` ke import dari `@hanoman/shared` yang sudah ada (atau `import type { OverviewDTO } from "@hanoman/shared";`).
2. Di dekat `const [pending, setPending] = …`, tambahkan:
   ```ts
   /* ADR-0220 · agregat Overview "Koran Pagi" dari grup siar `overview`. `null` sampai frame pertama tiba
      (server lama tak pernah mengirimnya) — panel menampilkan kerangka, bukan angka nol. Server sudah
      men-dedup frame ini, jadi setiap frame yang tiba memang berisi perubahan. */
   const [overview, setOverview] = React.useState<OverviewDTO | null>(null);
   ```
3. Di callback `subscribe`, sesudah cabang `pending`, tambahkan:
   ```ts
      else if (m.t === "overview") setOverview(m.overview);
   ```
4. Pada render `OverviewScreen`, tambahkan prop `overview={overview}`.

- [x] **Step 6: Jalankan test, pastikan lulus**

Run: `TEST src/test/overview-screen.test.tsx src/test/app-snapshot-digest.test.tsx`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/overview src/src/screens/OverviewScreen.tsx src/src/screens/styles/overview.css src/src/App.tsx src/test/overview-screen.test.tsx docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(overview): kerangka Koran Pagi — masthead, headline, Koreksi, Indeks project (ADR-0220)"
```

---

### Task 8: Denyut armada (menggantikan "Sesi berjalan")

**Files:**
- Create: `src/src/screens/overview/Denyut.tsx`
- Modify: `src/src/screens/OverviewScreen.tsx` (pindahkan `isWaiting`/`sortLive`/`LiveRow` ke Denyut, ganti section), `src/src/screens/styles/overview.css`, `src/test/overview-screen.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  isWaiting(s: TerminalSession): boolean    // diekspor dari Denyut.tsx, dipakai OverviewScreen
  sortLive(live: TerminalSession[], specById: Map<string, SpecSlim>): TerminalSession[]
  <Denyut live={TerminalSession[] /* sudah diurut */} nameById specById now onOpen onGoto />
  DENYUT_MAX = 8
  ```

- [x] **Step 1: Tulis test yang gagal** — tambahkan describe di `src/test/overview-screen.test.tsx`:
```ts
describe("Overview · denyut armada", () => {
  it("tiap sesi hidup punya jejak EKG; yang menunggu jejaknya datar", () => {
    const { container } = render(<OverviewScreen projects={[project({ id: "a", name: "alpha" }), project({ id: "b", name: "beta" })]}
      backlog={[]} sessions={[session({ id: "s1", projectId: "a" }), session({ id: "s2", projectId: "b", decision: true })]}
      onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(container.querySelectorAll(".hn-ovk-trace")).toHaveLength(2);
    expect(container.querySelectorAll(".hn-ovk-trace--flat")).toHaveLength(1);
    expect(container.querySelector(".hn-ovk-trace svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("panel denyut berjudul 'Denyut armada' dan menyebut jumlah sesi", () => {
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]}
      sessions={[session({ id: "s1", projectId: "a" })]} onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(screen.getByRole("heading", { name: "Denyut armada" })).toBeTruthy();
    expect(screen.getByText("1 sesi hidup")).toBeTruthy();
  });

  it("maksimal 8 baris; sisanya '+N lainnya' yang membuka Terminal", () => {
    const onGoto = vi.fn();
    const many = Array.from({ length: 11 }, (_, i) => project({ id: `p${i}`, name: `proj${i}` }));
    render(<OverviewScreen projects={many} backlog={[]} sessions={many.map((p) => session({ id: `s-${p.id}`, projectId: p.id }))}
      onOpenProject={noop} onGoto={onGoto} onOpenSession={noop} />);
    expect(within(screen.getByRole("list", { name: "Sesi berjalan" })).getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "+3 lainnya" }));
    expect(onGoto).toHaveBeenCalledWith("terminal");
  });

  it("CSS: animasi jejak dimatikan di prefers-reduced-motion, jejak datar tak beranimasi", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../src/screens/styles/overview.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.hn-ovk-trace-run\s*\{[^}]*animation:\s*none/);
    expect(css).toMatch(/\.hn-ovk-trace--flat \.hn-ovk-trace-run\s*\{[^}]*animation:\s*none/);
  });
});
```
Test lama di `describe("Overview · sesi berjalan")` (urutan, tombol Jawab, "dimulai 5 menit lalu", keadaan kosong) **tetap** dan harus terus lulus.

Run: `TEST src/test/overview-screen.test.tsx`
Expected: FAIL — `.hn-ovk-trace` dan heading "Denyut armada" belum ada.

- [x] **Step 2: Implementasi** — `src/src/screens/overview/Denyut.tsx`:
```tsx
/* ADR-0220 · Denyut armada: satu jejak EKG per sesi hidup di panel gelap (`--term-*`). Ritme mengikuti
   KEADAAN, bukan `activityAt` (tak ada di SessionDTO; menambahkannya membuat frame `sessions` terkirim
   tiap detik): berjalan = berdetak, menunggu = garis datar putus-putus. Animasi CSS murni (overview.css);
   reduced-motion mematikannya, dan browser menjedanya sendiri di tab tersembunyi. */
import React from "react";
import { Button, DenseRow, Icon, RowList, StatusPill } from "../../ds";
import type { TerminalSession } from "../../api/client";
import type { SpecSlim } from "../types";
import { FLOW_LABEL, STAGE_LABEL, labelOf } from "../../lib/labels";
import { relativeTime } from "../../lib/time-format";

export const DENYUT_MAX = 8;

// Menunggu manusia: cermin pet-state.ts dan Terminal (decision && !deciding). Yang deciding dilayani lead.
export const isWaiting = (s: TerminalSession) => !!s.decision && !s.deciding;

// Yang menunggu di atas; lalu yang lebih lama mulai; sesi tanpa waktu mulai di bawah; lalu per id.
export function sortLive(live: TerminalSession[], specById: Map<string, SpecSlim>): TerminalSession[] {
  const startOf = (s: TerminalSession) => {
    const started = s.specId ? specById.get(s.specId)?.startedAt : null;
    const ms = started ? Date.parse(started) : Number.NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return [...live].sort((a, b) => (Number(!isWaiting(a)) - Number(!isWaiting(b)))
    || (startOf(a) - startOf(b)) || a.id.localeCompare(b.id));
}

// Empat periode detak selebar 100 unit. viewBox menampilkan 200, dan animasi menggeser -50%,
// jadi putarannya mulus tanpa sambungan.
const BEAT = (x: number) => `L${x + 38},12 L${x + 42},3 L${x + 46},21 L${x + 50},12 L${x + 100},12`;
const BEAT_PATH = `M0,12 ${[0, 100, 200, 300].map(BEAT).join(" ")}`;

// Tiga tempo agar baris tak berdetak serempak; dipilih stabil dari id sesi.
const tempoOf = (id: string) => ["a", "b", "c"][[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 3];

function Trace({ id, waiting }: { id: string; waiting: boolean }) {
  return (
    <span className={`hn-ovk-trace hn-ovk-trace--${waiting ? "flat" : tempoOf(id)}`}>
      <svg viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <g className="hn-ovk-trace-run">
          {waiting ? <path d="M0,12 L400,12" /> : <path d={BEAT_PATH} />}
        </g>
      </svg>
    </span>
  );
}

export function Denyut({ live, nameById, specById, now, onOpen, onGoto }: {
  live: TerminalSession[]; nameById: Map<string, string>; specById: Map<string, SpecSlim>; now: number;
  onOpen: (id: string) => void; onGoto: (s: string) => void;
}) {
  const shown = live.slice(0, DENYUT_MAX);
  const rest = live.length - shown.length;
  return (
    <section className="hn-ov-section hn-ovk-denyut" aria-labelledby="ov-live">
      <header className="hn-ov-head">
        <div className="hn-ov-head-text">
          <h3 id="ov-live" className="hn-ovk-kicker">Denyut armada</h3>
          {live.length > 0 && <span className="hn-ov-meta">{live.length} sesi hidup</span>}
        </div>
        <div className="hn-ov-head-actions">
          <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGoto("terminal")}>Buka Terminal</Button>
        </div>
      </header>
      {live.length === 0
        ? <p className="hn-ov-empty">
            <Icon name="terminal" size={14} />
            <span>Tidak ada sesi berjalan</span>
            <span className="hn-ov-meta">Mulai sebuah backlog item untuk membuka sesi Claude Code interaktif.</span>
          </p>
        : <RowList label="Sesi berjalan">
            {shown.map((s) => {
              const waiting = isWaiting(s);
              const spec = s.specId ? specById.get(s.specId) : undefined;
              const fase = waiting ? "Menunggu jawabanmu"
                : spec ? labelOf(STAGE_LABEL, spec.stage) : s.flow ? labelOf(FLOW_LABEL, s.flow) : "Sesi";
              const started = relativeTime(spec?.startedAt, now);
              const name = nameById.get(s.projectId) ?? s.projectId;
              return (
                <DenseRow key={s.id} onClick={() => onOpen(s.id)}
                  actions={waiting ? <Button size="sm" variant="secondary" onClick={() => onOpen(s.id)}>Jawab</Button> : undefined}>
                  <StatusPill status={waiting ? "awaiting" : "running"} variant="dot" size="sm">{fase}</StatusPill>
                  <span className="hn-ov-name" title={name}>{name}</span>
                  <span className="hn-ov-meta">{[spec?.id, started && `dimulai ${started}`].filter(Boolean).join(" · ")}</span>
                  <Trace id={s.id} waiting={waiting} />
                </DenseRow>
              );
            })}
          </RowList>}
      {rest > 0 && (
        <button type="button" className="hn-ov-foot-link hn-ovk-more" onClick={() => onGoto("terminal")}>+{rest} lainnya</button>
      )}
    </section>
  );
}
```

Di `OverviewScreen.tsx`: hapus `isWaiting`, `sortLive`, `LiveRow`, serta import yang tak lagi dipakai (`DenseRow`, `Icon`, `RowList`, `StatusPill`, `FLOW_LABEL`, `STAGE_LABEL`, `labelOf`, `relativeTime`). Tambahkan `import { Denyut, isWaiting, sortLive } from "./overview/Denyut";`, lalu ganti seluruh `<section … aria-labelledby="ov-live">…</section>` di kolom lead dengan:
```tsx
          <Denyut live={live} nameById={nameById} specById={specById} now={now} onOpen={onOpenSession} onGoto={onGoto} />
```

CSS, tambahkan di `overview.css`:
```css
/* Denyut armada: panel gelap memakai permukaan terminal (konsisten dengan pane sesi). */
.hn-ovk-denyut { background: var(--term-bg); color: var(--term-fg); border-radius: 6px; padding: 12px; }
.hn-ovk-denyut .hn-ovk-kicker, .hn-ovk-denyut .hn-ov-meta { color: var(--term-dim); }
.hn-ovk-denyut .hn-ov-name { color: var(--term-fg); }
.hn-ovk-denyut .hn-ov-empty { color: var(--term-dim); }
.hn-ovk-more { color: var(--term-dim); }
.hn-ovk-trace { display: block; flex: 1 1 120px; min-width: 80px; height: 24px; overflow: hidden; }
.hn-ovk-trace svg { display: block; width: 200%; height: 100%; }
.hn-ovk-trace path { fill: none; stroke: var(--brass-400); stroke-width: 1.6; vector-effect: non-scaling-stroke; }
.hn-ovk-trace--flat path { stroke: var(--clay-500); stroke-dasharray: 4 4; }
.hn-ovk-trace-run { animation: hn-ovk-scroll 2.4s linear infinite; }
.hn-ovk-trace--b .hn-ovk-trace-run { animation-duration: 3.1s; }
.hn-ovk-trace--c .hn-ovk-trace-run { animation-duration: 1.9s; }
.hn-ovk-trace--flat .hn-ovk-trace-run { animation: none; }
@keyframes hn-ovk-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) {
  .hn-ovk-trace-run { animation: none; }
}
```
Cek dulu bahwa `--brass-400` dan `--clay-500` tersedia di `src/src/ds/tokens/colors.css` (keduanya ada per 2026-10-13). Cek juga bahwa `DenseRow` meneruskan children sebagai flex item: periksa `src/src/ds/components/layout.tsx`. Bila baris tak bisa menampung jejak, letakkan `<Trace>` sebagai child terakhir dan beri `.hn-ovk-denyut .hn-dense-row { flex-wrap: wrap; }` (sesuaikan nama kelas baris yang benar-benar dirender).

- [x] **Step 3: Jalankan test, pastikan lulus**

Run: `TEST src/test/overview-screen.test.tsx`
Expected: PASS, termasuk test lama "sesi berjalan".

- [x] **Step 4: Commit**

```bash
git add src/src/screens/overview/Denyut.tsx src/src/screens/OverviewScreen.tsx src/src/screens/styles/overview.css src/test/overview-screen.test.tsx docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(overview): Denyut armada — EKG per sesi hidup menggantikan daftar sesi (ADR-0220)"
```

---

### Task 9: Panel metrik — Bottleneck, Sungai, Rekor, Bensin, Token, Peta panas

**Files:**
- Create: `src/src/screens/overview/Bottleneck.tsx`, `SungaiSpec.tsx`, `Rekor.tsx`, `Bensin.tsx`, `EkonomiToken.tsx`, `PetaPanas.tsx`, `src/test/overview-panels.test.tsx`
- Modify: `src/src/screens/OverviewScreen.tsx` (pasang panel, cabut LimitWindows/useLimits/useCodexLimits), `src/src/screens/styles/overview.css`, `src/test/overview-screen.test.tsx` (hapus describe "limit langganan" dan mock limit)

**Interfaces:**
- Consumes: `OverviewDTO` sub-tipe, `format.ts`, `Delta`.
- Produces: komponen `({ overview: OverviewDTO | null; now: number })` untuk keenam panel. Masing-masing merender `<section className="hn-ovk-panel" aria-labelledby=…>` dengan kicker `<h3>`.

- [x] **Step 1: Tulis test yang gagal**

`src/test/overview-panels.test.tsx`:
```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { OverviewDTO } from "@hanoman/shared";
import { Bottleneck } from "../src/screens/overview/Bottleneck";
import { SungaiSpec } from "../src/screens/overview/SungaiSpec";
import { Rekor } from "../src/screens/overview/Rekor";
import { Bensin } from "../src/screens/overview/Bensin";
import { EkonomiToken } from "../src/screens/overview/EkonomiToken";
import { PetaPanas } from "../src/screens/overview/PetaPanas";
import { fmtTokens, fmtDuration, fmtMinutes } from "../src/screens/overview/format";

const NOW = new Date(2026, 9, 13, 14, 30).getTime();
const base = (over: Partial<OverviewDTO> = {}): OverviewDTO => ({
  generatedAt: new Date(NOW).toISOString(), recordingSince: new Date(2026, 9, 13, 9, 12).toISOString(),
  today: { landed: 3, failed: 1 }, yesterday: { landed: 2, failed: 0 },
  river: { created: 9, started: 5, landed: 3, leadTimeMedMs: 28 * 3_600_000, cycleTimeMedMs: 192 * 60_000 },
  tokens: { input: 600_000, output: 200_000, cached: 3_400_000, total: 4_200_000, cacheHitPct: 85,
    perLanded: 1_400_000, topAgent: { name: "implementer", total: 2_000_000 }, yesterdayTotal: 3_000_000 },
  wait: { todayMin: 47, yesterdayMin: 29, pctOfLive: 31 },
  bensin: [
    { source: "claude", key: "session", label: "Sesi 5 jam", usedPct: 68, resetsAt: new Date(2026, 9, 13, 18).toISOString(),
      exhaustAt: new Date(2026, 9, 13, 16, 40).toISOString(), verdict: "habis",
      samples: [{ at: new Date(2026, 9, 13, 14).toISOString(), pct: 50 }, { at: new Date(NOW).toISOString(), pct: 68 }] },
    { source: "codex", key: "primary", label: "Primer", usedPct: 20, resetsAt: null, exhaustAt: null, verdict: "stabil", samples: [] },
  ],
  heatmap: { days: ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"],
    minutes: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 6 && h === 14 ? 38 : 0))) },
  records: { streakDays: 6, bestStreak: 11, bestLandedDay: { date: "2026-10-12", count: 7 }, landedRecordToday: false },
  headline: { text: "x", parts: [{ text: "x" }] },
  ...over,
});

describe("format", () => {
  it("token, durasi, menit", () => {
    expect(fmtTokens(4_200_000)).toBe("4,2 jt");
    expect(fmtTokens(812_400)).toBe("812 rb");
    expect(fmtTokens(950)).toBe("950");
    expect(fmtDuration(28 * 3_600_000)).toBe("1 hari 4 jam");
    expect(fmtDuration(192 * 60_000)).toBe("3 jam 12 menit");
    expect(fmtMinutes(47)).toBe("47 menit");
  });
});

describe("Bottleneck", () => {
  it("menit menunggu, delta (naik = buruk), persentase, dan 'tercatat sejak' bila perekam mulai hari ini", () => {
    render(<Bottleneck overview={base()} now={NOW} />);
    expect(screen.getByText("47")).toBeTruthy();
    expect(screen.getByText("↑18 vs kemarin").className).toContain("hn-ovk-tone--bad");
    expect(screen.getByText("31% waktu agen hari ini menganggur menunggu jawaban")).toBeTruthy();
    expect(screen.getByText("tercatat sejak 09.12")).toBeTruthy();
  });
  it("panel null → kalimat datar", () => {
    render(<Bottleneck overview={base({ wait: null })} now={NOW} />);
    expect(screen.getByText("Belum ada data menunggu.")).toBeTruthy();
  });
});

describe("SungaiSpec", () => {
  it("tiga arus + lead/cycle time", () => {
    render(<SungaiSpec overview={base()} now={NOW} />);
    expect(screen.getByText("dibuat 9")).toBeTruthy();
    expect(screen.getByText("jalan 5")).toBeTruthy();
    expect(screen.getByText("selesai 3")).toBeTruthy();
    expect(screen.getByText("lead time 1 hari 4 jam · cycle 3 jam 12 menit")).toBeTruthy();
  });
});

describe("Rekor", () => {
  it("streak dan rekor", () => {
    render(<Rekor overview={base()} now={NOW} />);
    expect(screen.getByText("6 hari tanpa sesi tumbang")).toBeTruthy();
    expect(screen.getByText(/rekor 11 hari · terbanyak 7 spec \(12 Okt\)/)).toBeTruthy();
  });
});

describe("Bensin", () => {
  it("claude default: %, label habis ±jam; tab Codex menampilkan seri codex", () => {
    render(<Bensin overview={base()} now={NOW} />);
    expect(screen.getByText("68%")).toBeTruthy();
    expect(screen.getByText("habis ±16.40")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText("laju stabil")).toBeTruthy();
  });
  it("tanpa seri codex, tanpa tab; tanpa data sama sekali, kalimat datar", () => {
    const { unmount } = render(<Bensin overview={base({ bensin: [base().bensin![0]!] })} now={NOW} />);
    expect(screen.queryByRole("tab", { name: "Codex" })).toBeNull();
    unmount();
    render(<Bensin overview={base({ bensin: [] })} now={NOW} />);
    expect(screen.getByText("Belum ada data limit.")).toBeTruthy();
  });
});

describe("EkonomiToken", () => {
  it("total, cache, per spec, agen paling boros, label 'token agen tercatat'", () => {
    render(<EkonomiToken overview={base()} now={NOW} />);
    expect(screen.getByText("4,2 jt")).toBeTruthy();
    expect(screen.getByText("cache 85%")).toBeTruthy();
    expect(screen.getByText("1,4 jt per spec mendarat")).toBeTruthy();
    expect(screen.getByText("paling boros: implementer")).toBeTruthy();
    expect(screen.getByText("token agen tercatat")).toBeTruthy();
  });
  it("total 0 → kalimat datar", () => {
    render(<EkonomiToken overview={base({ tokens: { ...base().tokens!, total: 0, input: 0, output: 0, cached: 0,
      cacheHitPct: null, perLanded: null, topAgent: null } })} now={NOW} />);
    expect(screen.getByText("Belum ada agen tercatat hari ini.")).toBeTruthy();
  });
});

describe("PetaPanas", () => {
  it("168 sel, sel terisi punya tooltip, ringkasan aksesibel", () => {
    const { container } = render(<PetaPanas overview={base()} now={NOW} />);
    expect(container.querySelectorAll(".hn-ovk-heat-cell")).toHaveLength(168);
    expect(container.querySelector('[title="Sel 13 Okt 14.00 · 38 menit"]')).not.toBeNull();
    expect(screen.getByRole("img", { name: "Jam kerja agen 7 hari: total 38 menit" })).toBeTruthy();
  });
});
```

Di `src/test/overview-screen.test.tsx`: hapus `describe("Overview · limit langganan")`, blok `vi.hoisted`/`vi.mock` limit (beserta `beforeEach` yang mereset codex), lalu tambahkan:
```ts
describe("Overview · panel metrik terpasang", () => {
  it("keenam panel tampil dengan overview; seksi 'Limit langganan' lama sudah tidak ada", () => {
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]} sessions={[]}
      overview={ov()} onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    for (const name of ["Kamu bottleneck-nya?", "Sungai spec", "Rekor", "Bensin", "Ekonomi token", "Jam kerja agen"])
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    expect(screen.queryByText("Limit langganan")).toBeNull();
  });
});
```

Run: `TEST src/test/overview-panels.test.tsx src/test/overview-screen.test.tsx`
Expected: FAIL — modul panel belum ada.

- [x] **Step 2: Implementasi panel**

`src/src/screens/overview/Bottleneck.tsx`:
```tsx
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { ProgressBar } from "../../ds";
import { Delta } from "./Delta";
import { fmtClock } from "./format";

const startOfToday = (now: number) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

export function Bottleneck({ overview, now }: { overview: OverviewDTO | null; now: number }) {
  const w = overview?.wait ?? null;
  const since = overview ? Date.parse(overview.recordingSince) : Number.NaN;
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-wait">
      <h3 id="ovk-wait" className="hn-ovk-kicker">Kamu bottleneck-nya?</h3>
      {!w ? <p className="hn-ov-meta">Belum ada data menunggu.</p> : (
        <>
          <p className="hn-ovk-figure"><span className="hn-ovk-big">{w.todayMin}</span><span className="hn-ovk-unit">menit</span>
            <Delta now={w.todayMin} prev={w.yesterdayMin} goodWhen="down" /></p>
          {w.pctOfLive !== null && (
            <>
              <ProgressBar value={w.pctOfLive} tone="err" size="sm" aria-label="Porsi waktu agen menunggu" valueText={`${w.pctOfLive}%`} />
              <p className="hn-ov-meta">{w.pctOfLive}% waktu agen hari ini menganggur menunggu jawaban</p>
            </>
          )}
          {since > startOfToday(now) && <p className="hn-ov-meta">tercatat sejak {fmtClock(since)}</p>}
        </>
      )}
    </section>
  );
}
```

`src/src/screens/overview/SungaiSpec.tsx`:
```tsx
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { fmtDuration } from "./format";

// Lebar arus (unit SVG) sebanding jumlahnya; minimal 4 agar arus nol tetap terbaca sebagai sungai kering.
const width = (n: number, max: number) => 4 + (max > 0 ? (n / max) * 36 : 0);

export function SungaiSpec({ overview }: { overview: OverviewDTO | null; now: number }) {
  const r = overview?.river ?? null;
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-river">
      <h3 id="ovk-river" className="hn-ovk-kicker">Sungai spec</h3>
      {!r ? <p className="hn-ov-meta">Belum ada data spec.</p> : (() => {
        const max = Math.max(r.created, r.started, r.landed);
        const [a, b, c] = [width(r.created, max), width(r.started, max), width(r.landed, max)];
        const y = 26;
        const d = `M0,${y - a / 2} C40,${y - a / 2} 40,${y - b / 2} 80,${y - b / 2} C120,${y - b / 2} 120,${y - c / 2} 160,${y - c / 2}`
          + ` L160,${y + c / 2} C120,${y + c / 2} 120,${y + b / 2} 80,${y + b / 2} C40,${y + b / 2} 40,${y + a / 2} 0,${y + a / 2} Z`;
        return (
          <>
            <svg className="hn-ovk-river" viewBox="0 0 160 52" aria-hidden="true" focusable="false"><path d={d} /></svg>
            <p className="hn-ovk-river-labels"><span>dibuat {r.created}</span><span>jalan {r.started}</span><span>selesai {r.landed}</span></p>
            {r.leadTimeMedMs !== null && (
              <p className="hn-ov-meta hn-ovk-mono">
                {`lead time ${fmtDuration(r.leadTimeMedMs)}${r.cycleTimeMedMs !== null ? ` · cycle ${fmtDuration(r.cycleTimeMedMs)}` : ""}`}
              </p>
            )}
          </>
        );
      })()}
    </section>
  );
}
```

`src/src/screens/overview/Rekor.tsx`:
```tsx
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";

const SHORT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const shortDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return SHORT.format(new Date(y!, m! - 1, d!)).replace(".", "");
};

export function Rekor({ overview }: { overview: OverviewDTO | null; now: number }) {
  const r = overview?.records ?? null;
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-rekor">
      <h3 id="ovk-rekor" className="hn-ovk-kicker">Rekor</h3>
      {!r ? <p className="hn-ov-meta">Belum ada riwayat sesi.</p> : (
        <>
          <p className="hn-ovk-lede">{r.streakDays} hari tanpa sesi tumbang</p>
          <p className="hn-ov-meta">
            {[`rekor ${r.bestStreak} hari`, r.bestLandedDay && `terbanyak ${r.bestLandedDay.count} spec (${shortDate(r.bestLandedDay.date)})`]
              .filter(Boolean).join(" · ")}
          </p>
          {r.landedRecordToday && <p className="hn-ovk-tone--good">Rekor baru hari ini.</p>}
        </>
      )}
    </section>
  );
}
```
Catatan: `Intl` id-ID memformat `12 Okt` (tanpa titik pada kebanyakan runtime). `.replace(".", "")` membuang titik bila runtime menambahkannya.

`src/src/screens/overview/Bensin.tsx`:
```tsx
import React from "react";
import type { OverviewBensin, OverviewDTO } from "@hanoman/shared";
import { Tabs } from "../../ds";
import { fmtClock } from "./format";

function verdictText(b: OverviewBensin): string {
  if (b.verdict === "habis" && b.exhaustAt) return `habis ±${fmtClock(b.exhaustAt)}`;
  if (b.verdict === "aman") return "aman sampai reset";
  if (b.verdict === "stabil") return "laju stabil";
  return "mengumpulkan data…";
}

// Garis sampel 60 menit terakhir; bila habis, garis putus-putus memproyeksikan ke 100% di exhaustAt.
function Spark({ b }: { b: OverviewBensin }) {
  if (b.samples.length < 2) return null;
  const pts = b.samples.map((p) => ({ x: Date.parse(p.at), y: p.pct }));
  const end = b.exhaustAt ? Date.parse(b.exhaustAt) : pts.at(-1)!.x;
  const x0 = pts[0]!.x;
  const span = Math.max(1, end - x0);
  const sx = (x: number) => ((x - x0) / span) * 140;
  const sy = (y: number) => 40 - (y / 100) * 38;
  const line = pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const last = pts.at(-1)!;
  return (
    <svg className="hn-ovk-spark" viewBox="0 0 140 42" aria-hidden="true" focusable="false">
      <line className="hn-ovk-spark-limit" x1="0" y1={sy(100)} x2="140" y2={sy(100)} />
      <polyline points={line} />
      {b.exhaustAt && <line className="hn-ovk-spark-proj" x1={sx(last.x)} y1={sy(last.y)} x2="140" y2={sy(100)} />}
    </svg>
  );
}

export function Bensin({ overview }: { overview: OverviewDTO | null; now: number }) {
  const all = overview?.bensin ?? [];
  const hasCodex = all.some((b) => b.source === "codex");
  const [tab, setTab] = React.useState<"claude" | "codex">("claude");
  const src = hasCodex ? tab : "claude";
  const list = all.filter((b) => b.source === src);
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-bensin">
      <h3 id="ovk-bensin" className="hn-ovk-kicker">Bensin</h3>
      {hasCodex && (
        <Tabs aria-label="Sumber limit" value={src}
          tabs={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }]}
          onChange={(v) => setTab(v === "codex" ? "codex" : "claude")} />
      )}
      {list.length === 0 ? <p className="hn-ov-meta">Belum ada data limit.</p> : list.map((b) => (
        <div key={`${b.source}:${b.key}`} className="hn-ovk-bensin">
          <p className="hn-ov-meta">{b.label}</p>
          <p className="hn-ovk-figure"><span className="hn-ovk-big">{b.usedPct}%</span>
            <span className={`hn-ovk-pill${b.verdict === "habis" ? " hn-ovk-pill--bad" : ""}`}>{verdictText(b)}</span></p>
          <Spark b={b} />
          {b.resetsAt && <p className="hn-ov-meta">reset {fmtClock(b.resetsAt)}</p>}
        </div>
      ))}
    </section>
  );
}
```

`src/src/screens/overview/EkonomiToken.tsx`:
```tsx
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { Delta } from "./Delta";
import { fmtTokens } from "./format";

export function EkonomiToken({ overview }: { overview: OverviewDTO | null; now: number }) {
  const t = overview?.tokens ?? null;
  return (
    <section className="hn-ovk-panel" aria-labelledby="ovk-token">
      <h3 id="ovk-token" className="hn-ovk-kicker">Ekonomi token</h3>
      {!t || t.total === 0 ? <p className="hn-ov-meta">Belum ada agen tercatat hari ini.</p> : (
        <>
          <p className="hn-ovk-figure"><span className="hn-ovk-big">{fmtTokens(t.total)}</span>
            {t.cacheHitPct !== null && <span className="hn-ovk-tone--good">cache {t.cacheHitPct}%</span>}</p>
          <Delta now={t.total} prev={t.yesterdayTotal} goodWhen="neutral" />
          {t.perLanded !== null && <p className="hn-ov-meta hn-ovk-mono">{fmtTokens(t.perLanded)} per spec mendarat</p>}
          {t.topAgent && <p className="hn-ov-meta hn-ovk-mono">paling boros: {t.topAgent.name}</p>}
          <p className="hn-ov-meta">token agen tercatat</p>
        </>
      )}
    </section>
  );
}
```
Catatan: dengan `goodWhen="neutral"`, Delta merender `↑1200000 vs kemarin` (angka mentah). Supaya terbaca, tambahkan prop opsional `format?: (n: number) => string` ke `Delta`. Di Delta: `{up ? "↑" : "↓"}{format ? format(Math.abs(diff)) : Math.abs(diff)} vs kemarin`. Di sini panggil `<Delta … format={fmtTokens} />`.

`src/src/screens/overview/PetaPanas.tsx`:
```tsx
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { fmtMinutes } from "./format";

const SHORT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const label = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return SHORT.format(new Date(y!, m! - 1, d!)).replace(".", "");
};
// Lima tingkat intensitas brass; sel kosong tingkat 0.
const level = (min: number, max: number) => (min <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((min / max) * 4)));

export function PetaPanas({ overview }: { overview: OverviewDTO | null; now: number }) {
  const h = overview?.heatmap ?? null;
  return (
    <section className="hn-ovk-panel hn-ovk-heatwrap" aria-labelledby="ovk-heat">
      <h3 id="ovk-heat" className="hn-ovk-kicker">Jam kerja agen</h3>
      {!h ? <p className="hn-ov-meta">Belum ada riwayat sesi.</p> : (() => {
        const max = Math.max(0, ...h.minutes.flat());
        const total = h.minutes.flat().reduce((a, b) => a + b, 0);
        return (
          <div className="hn-ovk-heat" role="img" aria-label={`Jam kerja agen 7 hari: total ${fmtMinutes(total)}`}>
            {h.days.map((day, di) => (
              <React.Fragment key={day}>
                <span className="hn-ovk-heat-day" aria-hidden="true">{label(day)}</span>
                {h.minutes[di]!.map((m, hr) => (
                  <span key={hr} className={`hn-ovk-heat-cell hn-ovk-heat-cell--${level(m, max)}`}
                    title={m > 0 ? `Sel ${label(day)} ${String(hr).padStart(2, "0")}.00 · ${fmtMinutes(m)}` : undefined} />
                ))}
              </React.Fragment>
            ))}
          </div>
        );
      })()}
    </section>
  );
}
```

- [x] **Step 3: Pasang panel di `OverviewScreen.tsx`**

Hapus import `LimitWindows`, `useLimits`, `useCodexLimits`, `Tabs`, state `limitTab`, variabel `codexOn`/`tab`/`limitMeta`, dan seluruh section `ov-limit`. Tambahkan import keenam panel. Ganti blok `<div className="hn-ovk-cols">…</div>` dengan:
```tsx
      <div className="hn-ovk-cols">
        <div className="hn-ovk-col hn-ovk-col--lead">
          <Denyut live={live} nameById={nameById} specById={specById} now={now} onOpen={onOpenSession} onGoto={onGoto} />
          <Bottleneck overview={overview} now={now} />
        </div>
        <div className="hn-ovk-col hn-ovk-col--mid">
          <SungaiSpec overview={overview} now={now} />
          <Rekor overview={overview} now={now} />
        </div>
        <div className="hn-ovk-col hn-ovk-col--side">
          <Bensin overview={overview} now={now} />
          <EkonomiToken overview={overview} now={now} />
        </div>
      </div>
      <PetaPanas overview={overview} now={now} />
```
Badge limit di Shell (`LimitIndicator`) tetap memakai `LimitWindows`; jangan menyentuh `LimitIndicator.tsx`.

- [x] **Step 4: CSS panel** — tambahkan di `overview.css`:
```css
.hn-ovk-panel { background: var(--surface-card); border: 1px solid var(--border-hair); border-radius: 6px;
  padding: 12px; display: grid; gap: 6px; min-width: 0; }
.hn-ovk-figure { margin: 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.hn-ovk-big { font-family: var(--font-display); font-size: 32px; line-height: 1; color: var(--text-strong); }
.hn-ovk-unit { font-size: 13px; color: var(--text-muted); }
.hn-ovk-lede { margin: 0; font-family: var(--font-display); font-size: 17px; color: var(--text-strong); }
.hn-ovk-mono { font-family: var(--font-mono); }
.hn-ovk-pill { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px;
  background: var(--brass-100); color: var(--brass-700); }
.hn-ovk-pill--bad { background: var(--clay-100); color: var(--clay-600); }
.hn-ovk-river { width: 100%; height: 56px; }
.hn-ovk-river path { fill: var(--brass-100); stroke: var(--brass-500); stroke-width: 1; }
.hn-ovk-river-labels { margin: 0; display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); }
.hn-ovk-spark { width: 100%; height: 44px; }
.hn-ovk-spark polyline { fill: none; stroke: var(--brass-500); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.hn-ovk-spark-proj { stroke: var(--brass-500); stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; }
.hn-ovk-spark-limit { stroke: var(--clay-500); stroke-width: .6; vector-effect: non-scaling-stroke; }
.hn-ovk-heatwrap { margin-top: 16px; }
.hn-ovk-heat { display: grid; grid-template-columns: 48px repeat(24, minmax(0, 1fr)); gap: 2px; align-items: center; }
.hn-ovk-heat-day { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
.hn-ovk-heat-cell { aspect-ratio: 1; border-radius: 2px; background: var(--bone-200); }
.hn-ovk-heat-cell--1 { background: var(--brass-100); }
.hn-ovk-heat-cell--2 { background: var(--brass-300); }
.hn-ovk-heat-cell--3 { background: var(--brass-400); }
.hn-ovk-heat-cell--4 { background: var(--brass-600); }
@media (max-width: 720px) {
  .hn-ovk-heat { grid-template-columns: 36px repeat(24, minmax(0, 1fr)); gap: 1px; }
}
```

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `TEST src/test/overview-panels.test.tsx src/test/overview-screen.test.tsx`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/overview src/src/screens/OverviewScreen.tsx src/src/screens/styles/overview.css src/test/overview-panels.test.tsx src/test/overview-screen.test.tsx docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "feat(overview): panel bottleneck, sungai, rekor, bensin, token, peta panas (ADR-0220)"
```

---

### Task 10: Docs frontend dan verifikasi nyata

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian baru sesudah bagian Fase 3B Overview, sekitar baris 573), `internal/docs/frontend/ui-ux-audit-2026-10.md:94-95,177-178` (catatan amandemen)

- [x] **Step 1: Docs** — tambahkan di `frontend-implementation.md`, tepat sebelum `## Audit UI/UX 2026-10 · Fase 3B · Overview "Hari ini"…`:
```md
## Overview "Koran Pagi" (ADR-0220)

Mengamandemen susunan Overview Fase 3B di bawah. `screens/OverviewScreen.tsx` kini kerangka koran, dan
panelnya ada di `screens/overview/`: `Masthead` ("Kabar Hanoman", tanggal, edisi langsung), `Headline`
(template server, nada clay/leaf), `Koreksi` (pengganti "Perlu perhatian", hanya tampil bila ada),
`Denyut` (EKG per sesi hidup di panel `--term-*`, menggantikan "Sesi berjalan"; animasi CSS murni,
mati di `prefers-reduced-motion`), `Bottleneck`, `SungaiSpec`, `Rekor`, `Bensin` (menggantikan seksi
limit; badge Shell tetap `LimitWindows`), `EkonomiToken`, `PetaPanas`, dan `IndeksProject` (daftar project
bergaya tabel bursa + footer backlog). Agregat datang dari grup siar ke-12 `overview` (`App.tsx`, state
`overview`, `null` sampai frame pertama). Tiga kolom `1.4fr 1fr 1fr` ≥1100px, dua kolom 720–1100px,
satu kolom <720px. Test: `test/overview-screen.test.tsx`, `test/overview-panels.test.tsx`.
Desain: [spec](../../../docs/superpowers/specs/2026-10-13-overview-koran-pagi-design.md).
```
Lalu, di dua tempat `ui-ux-audit-2026-10.md` yang menyebut susunan Overview (baris ~94–95 dan ~177–178), tambahkan satu kalimat di akhir paragrafnya: `Susunan ini diamandemen ADR-0220 (Overview "Koran Pagi").`

- [x] **Step 2: Jalankan semua test yang tersentuh**

Run: `TEST shared/src/overview.test.ts server/test/overview-metrics.test.ts server/test/overview-recorder.test.ts server/test/overview.route.test.ts server/test/events.test.ts server/test/mcp-coverage.test.ts server/test/agent-capabilities.test.ts server/test/agent-doc-contract.test.ts src/test/overview-screen.test.tsx src/test/overview-panels.test.tsx src/test/app-snapshot-digest.test.tsx`
Expected: semua PASS.

- [x] **Step 3: Typecheck paket tersentuh** (bukan `pnpm -r typecheck`): `pnpm --filter ./shared exec tsc --noEmit && pnpm --filter ./server exec tsc --noEmit && pnpm --filter ./src exec tsc --noEmit`
Expected: tanpa error. Bila nama filter paket berbeda, lihat `pnpm-workspace.yaml`.

- [x] **Step 4: Verifikasi nyata** — boot `pnpm dev`, buka dashboard di browser, lalu periksa:
- masthead, headline, dan panel tampil; panel menunjukkan kerangka sebelum frame `overview` pertama tiba;
- `curl` `/api/overview` mengembalikan angka yang sama dengan yang tampil;
- jejak EKG bergerak, dan sesi yang menunggu datar berwarna clay; klik baris membuka Terminal;
- lebar 390px: satu kolom, tanpa scroll horizontal;
- emulasikan `prefers-reduced-motion` di DevTools: jejak diam.

Kalau ada yang tidak sesuai, perbaiki dulu sebelum commit.

- [x] **Step 5: Commit**

```bash
git add internal/docs/frontend/frontend-implementation.md internal/docs/frontend/ui-ux-audit-2026-10.md docs/superpowers/plans/2026-10-13-overview-koran-pagi.md
git commit -m "docs(overview): susunan Koran Pagi di frontend-implementation + amandemen audit 3B (ADR-0220)"
```
