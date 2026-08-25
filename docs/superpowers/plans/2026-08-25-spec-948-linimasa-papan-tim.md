# SPEC-948 — Linimasa Gantt papan tim · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan mode tampilan **Linimasa** di layar Tim — baris = task, batang = `startDate → dueDate`, zoom hari/minggu/bulan — digambar CSS grid + token DS tanpa library chart, dengan seluruh geometri batang hidup sebagai fungsi murni di `team-rules.ts`.

**Architecture:** Aritmetika tanggal (`taskSpan` · `timelineWindow` · `barGeometry` · `todayOffset` · `timelineRows`) masuk `src/src/screens/team-rules.ts` — nol React, nol I/O, `today` selalu argumen. Piksel masuk `src/src/screens/team-timeline.tsx` yang mengekspor `TimelineCanvas` **generik** (menerima baris + batang, tak tahu apa itu `Task`) plus `TeamTimeline` yang membungkusnya untuk mode task. `TeamScreen.tsx` hanya bertambah satu entri `TEAM_VIEWS`, satu Select zoom, dan satu cabang render — datanya `board` yang sudah dimuat mode Papan, jadi nol fetch dan nol langganan baru.

**Tech Stack:** React 18 + TypeScript strict (Vite), vitest + @testing-library/react (jsdom), token CSS design system hanoman, lucide-react 0.400.0.

## Global Constraints

- **Rencana saja.** Tak ada batang "aktual", tak ada persen selesai, tak ada critical path, tak ada dependency antar-task.
- **Nol dependency baru.** Tak ada library chart, tak ada library tanggal. `Intl.DateTimeFormat` bawaan platform.
- **Nol perubahan skema, route, dan kontrak sync.** SPEC-948 murni frontend.
- **Gulir mendatar HANYA di dalam kanvas.** Badan halaman tak boleh ikut menggulir samping (SPEC-879).
- **`team-timeline.tsx` wajib bisa dipakai ulang mode Lintas project (item E).** `TimelineCanvas` menerima `rows: TimelineRowSpec[]` dengan `bars` **jamak**; ia tak boleh menyebut `Task` sama sekali.
- **`team-rules.ts` tetap murni.** Nol import React, nol I/O, dan **tak satu pun fungsi membaca jam sistem** — `today` selalu argumen.
- **Nol nilai warna baru.** Hanya token DS yang sudah ada.
- **Seluruh teks UI Bahasa Indonesia**, mengikuti gaya berkas sekitarnya.
- **Komentar hanya untuk yang tak terbaca dari kode** (alasan, trade-off, invariant, rujukan SPEC/ADR).
- Perintah test: `cd src && pnpm vitest --run <path>` (project frontend, jsdom). **Jangan** menjalankan suite penuh.

---

### Task 1: Aritmetika rentang — `taskSpan`, dan `taskDates` pindah rumah

**Files:**
- Modify: `src/src/screens/team-rules.ts` (tambah di akhir berkas)
- Modify: `src/src/screens/team-board.tsx:24-36` (hapus `DATE_FMT`/`shortDate`/`taskDates`, impor dari `team-rules`)
- Test: `src/test/team-rules.test.ts` (tambah)

**Interfaces:**
- Consumes: `TaskView` dari `@hanoman/shared` (sudah dipakai berkas ini).
- Produces:
  - `taskSpan(task: Pick<TaskView,"startDate"|"dueDate">): TaskSpan | null`
  - `type TaskSpan = { start: number; end: number; invalid: boolean }`
  - `taskDates(t: Pick<TaskView,"startDate"|"dueDate">): string | null` (dipindah dari `team-board.tsx`, tanda tangannya dilonggarkan dari `TaskView` ke `Pick<…>`)
  - `DAY: number` (tidak diekspor — internal modul)

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/test/team-rules.test.ts`, dan tambahkan `taskSpan, taskDates` ke daftar impor di baris 4-7 berkas itu:

```ts
/* SPEC-948 · rentang task. Akhir INKLUSIF: task yang mulai dan selesai di hari yang sama harus
   selebar satu hari, bukan nol — batang selebar nol tak terlihat sama sekali dan kartunya seolah
   tak bertanggal padahal bertanggal, tanpa satu pun galat. */
describe("taskSpan", () => {
  const DAY = 86_400_000;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

  it("tanpa tanggal sama sekali = null — satu-satunya arti 'belum dijadwalkan'", () => {
    expect(taskSpan(task())).toBeNull();
  });

  it("mulai dan tenggat di hari yang SAMA selebar satu hari, bukan nol", () => {
    const s = taskSpan(task({ startDate: "2026-09-12T12:00:00.000Z", dueDate: "2026-09-12T12:00:00.000Z" }))!;
    expect(s.start).toBe(at("2026-09-12"));
    expect(s.end - s.start).toBe(DAY);
    expect(s.invalid).toBe(false);
  });

  it("rentang penuh berakhir di AKHIR hari tenggat", () => {
    const s = taskSpan(task({ startDate: "2026-09-01T12:00:00.000Z", dueDate: "2026-09-03T12:00:00.000Z" }))!;
    expect(s.start).toBe(at("2026-09-01"));
    expect(s.end).toBe(at("2026-09-04"));
  });

  // Kartu ber-`dueDate` saja adalah TENGGAT, dan tenggat justru hal yang dicari linimasa.
  it("satu tanggal saja tetap terjadwal — batang satu hari", () => {
    const only = taskSpan(task({ dueDate: "2026-09-12T12:00:00.000Z" }))!;
    expect(only.end - only.start).toBe(DAY);
    expect(only.start).toBe(at("2026-09-12"));
    expect(taskSpan(task({ startDate: "2026-09-12T12:00:00.000Z" }))!.start).toBe(at("2026-09-12"));
  });

  // Ditukar diam-diam = layar menampilkan rencana yang tak pernah diketik siapa pun.
  it("tenggat mendahului mulai digambar apa adanya dan DITANDAI", () => {
    const s = taskSpan(task({ startDate: "2026-09-10T12:00:00.000Z", dueDate: "2026-09-02T12:00:00.000Z" }))!;
    expect(s.invalid).toBe(true);
    expect(s.start).toBe(at("2026-09-02"));
    expect(s.end).toBe(at("2026-09-11"));
  });

  // `NaN` yang lolos meracuni Math.min seluruh papan — jendela jadi NaN dan kanvasnya kosong.
  it("tanggal tak sah jadi null, bukan NaN", () => {
    expect(taskSpan(task({ startDate: "besok", dueDate: null } as never))).toBeNull();
    expect(taskSpan(task({ startDate: "besok", dueDate: "2026-09-02T12:00:00.000Z" } as never))!.start)
      .toBe(at("2026-09-02"));
  });

  // Stempel ditulis TENGAH HARI UTC (`dateInputToIso`), jadi pembulatan harus UTC di kedua sisi.
  it("tengah hari UTC dibulatkan ke awal hari UTC yang sama", () => {
    expect(taskSpan(task({ startDate: "2026-09-12T12:00:00.000Z" }))!.start).toBe(at("2026-09-12"));
  });
});

/* Dipindah dari `team-board.tsx` supaya kanvas linimasa bisa memakainya tanpa mengimpor papan. */
describe("taskDates", () => {
  it("rentang penuh, tenggat saja, mulai saja, dan tanpa tanggal", () => {
    expect(taskDates(task({ startDate: "2026-09-01T12:00:00.000Z", dueDate: "2026-09-03T12:00:00.000Z" })))
      .toBe("1 Sep → 3 Sep");
    expect(taskDates(task({ dueDate: "2026-09-03T12:00:00.000Z" }))).toBe("→ 3 Sep");
    expect(taskDates(task({ startDate: "2026-09-01T12:00:00.000Z" }))).toBe("1 Sep");
    expect(taskDates(task())).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd src && pnpm vitest --run test/team-rules.test.ts`
Expected: FAIL — `taskSpan is not a function` / `taskDates is not a function` (impor tak ada).

- [x] **Step 3: Pindahkan `taskDates` ke `team-rules.ts` dan tulis `taskSpan`**

Hapus dari `src/src/screens/team-board.tsx` blok berikut (baris ±24-36):

```tsx
const DATE_FMT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const shortDate = (iso: string | null): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null);

/** Rentang yang boleh setengah terisi. Kartu tanpa tanggal tak merender barisnya sama sekali —
    "—" adalah ruang yang terpakai untuk mengatakan "tidak ada". */
export function taskDates(t: TaskView): string | null {
  const a = shortDate(t.startDate);
  const b = shortDate(t.dueDate);
  if (a && b) return `${a} → ${b}`;
  if (b) return `→ ${b}`;
  return a;
}
```

dan ganti impor `team-rules` di baris 4 `team-board.tsx` menjadi:

```tsx
import { TEAM_COLUMNS, canDropTask, taskDates, type Board } from "./team-rules";
```

Tambahkan di **akhir** `src/src/screens/team-rules.ts`:

```ts
/* ── SPEC-948 · aritmetika linimasa ───────────────────────────────────────────────────────────
   Nol React, nol I/O, dan `today` SELALU argumen: fungsi yang membaca jam sistem sendiri hanya
   bisa diuji dengan membekukan waktu global, dan membekukan `Date.now` di repo ini sudah pernah
   menjatuhkan test lain. */

const DAY = 86_400_000;

/** Awal hari **UTC**. UTC di kedua sisi karena `dateInputToIso` menulis tengah hari UTC: menghitung
    dengan awal hari LOKAL berarti membandingkan tengah hari dengan tengah malam, dan selisih 12
    jam itu cukup untuk menggeser batang setengah sel di zoom hari. */
const dayStart = (ms: number): number => Math.floor(ms / DAY) * DAY;

/** `new Date("besok").getTime()` adalah `NaN`, dan satu `NaN` yang lolos ke `Math.min` jendela
    membuat SELURUH kanvas kosong tanpa satu pun galat. Disaring di satu pintu masuk. */
const stamp = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
};

export type TaskSpan = { start: number; end: number; invalid: boolean };

/**
 * Dua tanggal menjadi satu rentang setengah terbuka `[start, end)` dalam epoch ms.
 *
 * Akhir **inklusif**: task yang mulai dan selesai di hari yang sama punya `end - start === DAY`,
 * bukan 0. Ini kesalahan Gantt paling senyap — batang selebar nol tak terlihat sama sekali, jadi
 * kartunya seolah tak bertanggal padahal bertanggal.
 *
 * `null` HANYA untuk "tak punya tanggal sah sama sekali" — satu-satunya arti "belum dijadwalkan".
 * Satu tanggal saja tetap terjadwal (batang 1 hari): kartu ber-`dueDate` saja adalah tenggat, dan
 * tenggat justru yang dicari linimasa. `taskDates` di bawah sudah merender rentang setengah terisi
 * sejak SPEC-946; menyembunyikannya di sini membuat dua permukaan berselisih tentang apa artinya
 * "punya tanggal".
 *
 * Tenggat yang mendahului mulai **digambar**, tidak ditukar: `zCreateTask` tak memaksa
 * `due >= start` dan `TaskModal` tak memvalidasinya, jadi keadaan ini bisa ada di DB. Menukarnya
 * diam-diam membuat layar menampilkan rencana yang tak pernah diketik siapa pun; menolak
 * menggambarnya membuat kartunya lenyap tanpa sebab. `invalid` yang membuat barisnya mengaku.
 */
export function taskSpan(task: Pick<TaskView, "startDate" | "dueDate">): TaskSpan | null {
  const a = stamp(task.startDate);
  const b = stamp(task.dueDate);
  if (a === null && b === null) return null;
  const lo = a ?? b!;
  const hi = b ?? a!;
  return {
    start: dayStart(Math.min(lo, hi)),
    end: dayStart(Math.max(lo, hi)) + DAY,
    invalid: hi < lo,
  };
}

const DATE_FMT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
const shortDate = (iso: string | null): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null);

/** Rentang yang boleh setengah terisi. Tanpa tanggal tak merender barisnya sama sekali — "—"
    adalah ruang yang terpakai untuk mengatakan "tidak ada". Dipindah ke sini dari `team-board.tsx`
    (SPEC-948) supaya kanvas linimasa memakainya tanpa mengimpor papan. */
export function taskDates(t: Pick<TaskView, "startDate" | "dueDate">): string | null {
  const a = shortDate(t.startDate);
  const b = shortDate(t.dueDate);
  if (a && b) return `${a} → ${b}`;
  if (b) return `→ ${b}`;
  return a;
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `cd src && pnpm vitest --run test/team-rules.test.ts test/team-board.test.tsx`
Expected: PASS — seluruh test lama `team-board.test.tsx` tetap hijau (`taskDates` cuma pindah rumah).

- [x] **Step 5: Typecheck**

Run: `cd src && pnpm typecheck`
Expected: nol error.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/team-rules.ts src/src/screens/team-board.tsx src/test/team-rules.test.ts
git commit -m "feat(948): taskSpan — akhir tanggal inklusif, setengah bertanggal tetap terjadwal

taskDates pindah dari team-board.tsx ke team-rules.ts supaya kanvas linimasa
memakainya tanpa mengimpor papan; \`timeZone: UTC\` ditambahkan agar labelnya
tak bergeser sehari di zona barat.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Jendela waktu — `timelineWindow` dan tick

**Files:**
- Modify: `src/src/screens/team-rules.ts` (tambah di akhir)
- Test: `src/test/team-rules.test.ts` (tambah)

**Interfaces:**
- Consumes: `TaskSpan`, `dayStart`, `DAY` dari Task 1.
- Produces:
  - `TIMELINE_ZOOMS: readonly ["day","week","month"]`
  - `type TimelineZoom = "day" | "week" | "month"`
  - `type TimelineTick = { start: number; label: string; major: boolean }`
  - `type TimelineWindow = { from: number; to: number; zoom: TimelineZoom; ticks: TimelineTick[] }`
  - `timelineWindow(spans: TaskSpan[], zoom: TimelineZoom, today: number): TimelineWindow`
  - `zoomCell(zoom: TimelineZoom): number`
  - `MAX_TICKS: number` (nilainya `120`)

- [x] **Step 1: Tulis test yang gagal**

Tambahkan `timelineWindow, zoomCell, MAX_TICKS` ke impor `src/test/team-rules.test.ts`, lalu tambahkan di akhir berkas:

```ts
describe("timelineWindow", () => {
  const DAY = 86_400_000;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  // 2026-09-12 adalah SABTU — dipilih supaya pembulatan ke Senin benar-benar bergerak.
  const TODAY = at("2026-09-12");
  const span = (a: string, b: string) => ({ start: at(a), end: at(b) + DAY, invalid: false });

  it("papan tanpa tanggal tetap punya sumbu, dan sumbu itu memuat HARI INI", () => {
    const w = timelineWindow([], "day", TODAY);
    expect(w.ticks.length).toBe(14);
    expect(w.from).toBeLessThanOrEqual(TODAY);
    expect(w.to).toBeGreaterThan(TODAY);
  });

  it("zoom hari: tick minimum 14, satu tick = satu hari", () => {
    const w = timelineWindow([span("2026-09-10", "2026-09-11")], "day", TODAY);
    expect(w.ticks.length).toBe(14);
    expect(w.ticks[1]!.start - w.ticks[0]!.start).toBe(DAY);
  });

  it("zoom minggu dibulatkan ke SENIN, bukan ke hari data", () => {
    const w = timelineWindow([span("2026-09-12", "2026-09-12")], "week", TODAY);
    // 2026-09-12 Sabtu → Senin sebelumnya 2026-09-07.
    expect(w.from).toBe(at("2026-09-07"));
    expect(new Date(w.from).getUTCDay()).toBe(1);
    expect(w.ticks[1]!.start - w.ticks[0]!.start).toBe(7 * DAY);
  });

  it("zoom bulan dibulatkan ke tanggal 1 dan ticknya satuan KALENDER", () => {
    const w = timelineWindow([span("2026-09-20", "2026-12-05")], "month", TODAY);
    expect(w.from).toBe(at("2026-09-01"));
    expect(w.ticks[0]!.start).toBe(at("2026-09-01"));
    expect(w.ticks[1]!.start).toBe(at("2026-10-01"));
    // Sep 30 hari, Okt 31 — tick bulan memang TIDAK sama lebar dalam hari.
    expect(w.ticks[1]!.start - w.ticks[0]!.start).toBe(30 * DAY);
    expect(w.ticks[2]!.start - w.ticks[1]!.start).toBe(31 * DAY);
  });

  it("jendela MENUTUPI seluruh data, bukan cuma tick minimum", () => {
    const w = timelineWindow([span("2026-09-01", "2026-11-30")], "day", TODAY);
    expect(w.from).toBeLessThanOrEqual(at("2026-09-01"));
    expect(w.to).toBeGreaterThan(at("2026-11-30"));
  });

  it("hari ini selalu termuat meski seluruh tugas di masa lalu", () => {
    const w = timelineWindow([span("2026-06-01", "2026-06-05")], "week", TODAY);
    expect(w.from).toBeLessThanOrEqual(at("2026-06-01"));
    expect(w.to).toBeGreaterThan(TODAY);
  });

  /* Tanpa plafon, satu task bertanggal 2031 di zoom hari melahirkan ±2 000 sel header dan kanvas
     selebar 70 000 px. Yang jatuh di luar DIDAFTAR oleh `timelineRows`, bukan dihilangkan. */
  it("plafon tick melindungi DOM, jendela tetap berjangkar di mulai paling awal", () => {
    const w = timelineWindow([span("2026-09-01", "2031-01-01")], "day", TODAY);
    expect(w.ticks.length).toBe(MAX_TICKS);
    expect(w.from).toBe(at("2026-09-01"));
    expect(w.to).toBeLessThan(at("2031-01-01"));
  });

  it("`to` adalah akhir tick terakhir — 100% kanvas persis sepanjang tick", () => {
    const w = timelineWindow([], "week", TODAY);
    expect(w.to).toBe(w.ticks[w.ticks.length - 1]!.start + 7 * DAY);
  });

  it("tick major menandai awal bulan di zoom hari dan awal tahun di zoom bulan", () => {
    const d = timelineWindow([span("2026-09-25", "2026-10-05")], "day", at("2026-09-25"));
    expect(d.ticks.find((t) => t.start === at("2026-10-01"))!.major).toBe(true);
    expect(d.ticks.find((t) => t.start === at("2026-09-26"))!.major).toBe(false);
    const m = timelineWindow([span("2026-11-01", "2027-03-01")], "month", at("2026-11-01"));
    expect(m.ticks.find((t) => t.start === at("2027-01-01"))!.major).toBe(true);
    expect(m.ticks.find((t) => t.start === at("2026-12-01"))!.major).toBe(false);
  });

  it("label tick tak bergeser sehari — dibentuk di UTC", () => {
    const w = timelineWindow([span("2026-09-01", "2026-09-02")], "day", at("2026-09-01"));
    expect(w.ticks[0]!.label).toContain("1");
    expect(w.ticks[0]!.label).toContain("Sep");
  });

  it("zoom mengembalikan lebar sel yang berbeda per satuan", () => {
    expect(zoomCell("day")).toBeLessThan(zoomCell("week"));
    expect(zoomCell("week")).toBeLessThan(zoomCell("month"));
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd src && pnpm vitest --run test/team-rules.test.ts`
Expected: FAIL — `timelineWindow is not a function`.

- [x] **Step 3: Implementasi**

Tambahkan di akhir `src/src/screens/team-rules.ts`:

```ts
export const TIMELINE_ZOOMS = ["day", "week", "month"] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

/** Lebar sel & panjang sumbu minimum per zoom. Minimum ada supaya papan yang seluruh tugasnya
    jatuh di satu minggu tetap punya sumbu yang bisa dibaca, bukan satu sel selebar layar. */
const ZOOM: Record<TimelineZoom, { cell: number; minTicks: number }> = {
  day: { cell: 34, minTicks: 14 },
  week: { cell: 56, minTicks: 8 },
  month: { cell: 84, minTicks: 6 },
};
export const zoomCell = (zoom: TimelineZoom): number => ZOOM[zoom].cell;

/**
 * Plafon jumlah sel header. Tanpa ini satu task bertanggal 2031 di zoom hari melahirkan ±2 000 sel
 * dan kanvas selebar 70 000 px. Task yang lalu jatuh di luar jendela **didaftar** di bawah kanvas
 * (`timelineRows`) — plafon yang menghilangkan baris tanpa jejak adalah kelas bug yang sudah
 * dijawab ADR-0151 dengan "menampilkan N dari M".
 */
export const MAX_TICKS = 120;

export type TimelineTick = { start: number; label: string; major: boolean };
export type TimelineWindow = {
  from: number; to: number; zoom: TimelineZoom; ticks: TimelineTick[];
};

/** Awal satuan zoom yang MEMUAT `ms`. Minggu mulai **Senin** (ISO, dan konvensi kerja di sini);
    `getUTCDay()` memberi 0 untuk Minggu, jadi pergeserannya `(hari + 6) % 7`. */
const unitStart = (ms: number, zoom: TimelineZoom): number => {
  const d = dayStart(ms);
  if (zoom === "day") return d;
  if (zoom === "week") return d - ((new Date(d).getUTCDay() + 6) % 7) * DAY;
  const t = new Date(d);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
};

/** Satuan bulan adalah satuan **kalender**, bukan 30 hari — jadi tick bulan tak sama lebar dalam
    hari. Itulah sebabnya batang diposisikan oleh WAKTU (persen) sementara gridline oleh PIKSEL:
    di zoom bulan, garis grid adalah penanda bulan, bukan koordinat presisi batang. */
const nextUnit = (ms: number, zoom: TimelineZoom): number => {
  if (zoom === "day") return ms + DAY;
  if (zoom === "week") return ms + 7 * DAY;
  const t = new Date(ms);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
};

// `timeZone: "UTC"` di keempatnya: tanpa itu label bergeser sehari di zona barat, dan sumbu yang
// menyebut tanggal yang salah adalah bug yang tak memunculkan satu pun error.
const TICK_D = new Intl.DateTimeFormat("id-ID", { day: "numeric", timeZone: "UTC" });
const TICK_DM = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
const TICK_M = new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" });
const TICK_MY = new Intl.DateTimeFormat("id-ID", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Tick yang mendapat garis lebih tegas — satu-satunya cara membaca sumbu panjang tanpa menghitung
    sel satu per satu. */
const tickMajor = (ms: number, zoom: TimelineZoom): boolean => {
  const d = new Date(ms);
  if (zoom === "day") return d.getUTCDate() === 1;
  if (zoom === "week") return new Date(ms + 6 * DAY).getUTCMonth() !== d.getUTCMonth() || d.getUTCDate() <= 7;
  return d.getUTCMonth() === 0;
};

const tickLabel = (ms: number, zoom: TimelineZoom, major: boolean): string => {
  const d = new Date(ms);
  if (zoom === "day") return (major ? TICK_DM : TICK_D).format(d);
  if (zoom === "week") return TICK_DM.format(d);
  return (major ? TICK_MY : TICK_M).format(d);
};

/**
 * Jendela lahir dari **data ∪ hari ini**, dibulatkan keluar ke batas satuan zoom.
 *
 * Jendela tetap ("hari ini ± N") membuat papan berisi rencana kuartal depan tampak kosong; jendela
 * dari data saja membuat papan yang seluruh tugasnya bulan lalu tak memperlihatkan "sekarang".
 */
export function timelineWindow(
  spans: TaskSpan[], zoom: TimelineZoom, today: number,
): TimelineWindow {
  const t = dayStart(today);
  let lo = t;
  let hi = t + DAY;
  for (const s of spans) {
    if (s.start < lo) lo = s.start;
    if (s.end > hi) hi = s.end;
  }
  const from = unitStart(lo, zoom);
  const { minTicks } = ZOOM[zoom];
  const ticks: TimelineTick[] = [];
  let cur = from;
  // Berhenti saat sumbu sudah MENUTUPI `hi` DAN sudah mencapai tick minimum — jendela sempit tetap
  // terbaca, jendela lebar tetap memuat seluruh data sampai plafon.
  while (ticks.length < MAX_TICKS && (cur < hi || ticks.length < minTicks)) {
    const major = tickMajor(cur, zoom);
    ticks.push({ start: cur, label: tickLabel(cur, zoom, major), major });
    cur = nextUnit(cur, zoom);
  }
  return { from, to: cur, zoom, ticks };
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `cd src && pnpm vitest --run test/team-rules.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/team-rules.ts src/test/team-rules.test.ts
git commit -m "feat(948): timelineWindow — jendela dari data + hari ini, tick berplafon

Minggu mulai Senin, bulan satuan kalender (tick TIDAK sama lebar dalam hari),
label dibentuk di UTC agar tak bergeser sehari, dan plafon 120 tick melindungi
DOM dari task bertanggal jauh.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Geometri batang — `barGeometry`, `todayOffset`, `timelineRows`

**Files:**
- Modify: `src/src/screens/team-rules.ts` (tambah di akhir)
- Test: `src/test/team-rules.test.ts` (tambah)

**Interfaces:**
- Consumes: `taskSpan`, `TimelineWindow`, `dayStart`, `DAY`.
- Produces:
  - `type BarGeometry = { left: number; width: number; clippedStart: boolean; clippedEnd: boolean; invalid: boolean }`
  - `barGeometry(task: Pick<TaskView,"startDate"|"dueDate">, window: TimelineWindow): BarGeometry | null`
  - `todayOffset(window: TimelineWindow, today: number): number | null`
  - `type TimelineTaskRow = { task: TaskView; geometry: BarGeometry }`
  - `timelineRows(tasks: TaskView[], window: TimelineWindow): { rows: TimelineTaskRow[]; unscheduled: TaskView[]; outside: TaskView[] }`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan `barGeometry, todayOffset, timelineRows` ke impor, lalu tambahkan di akhir `src/test/team-rules.test.ts`:

```ts
describe("barGeometry", () => {
  const DAY = 86_400_000;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const iso = (d: string) => `${d}T12:00:00.000Z`;
  // Jendela 10 hari yang dibuat tangan: aritmetikanya jadi bisa dihitung di kepala.
  const win = {
    from: at("2026-09-01"), to: at("2026-09-11"), zoom: "day" as const,
    ticks: Array.from({ length: 10 }, (_, i) => ({ start: at("2026-09-01") + i * DAY, label: `${i + 1}`, major: false })),
  };

  it("tanpa tanggal = null — pemanggil yang memutuskan ia 'belum dijadwalkan'", () => {
    expect(barGeometry(task(), win)).toBeNull();
  });

  it("batang di tengah jendela: persen dihitung dari rentang WAKTU", () => {
    // 3 Sep s/d 4 Sep inklusif = hari ke-2 dan ke-3 dari 10 → left 20%, width 20%.
    const g = barGeometry(task({ startDate: iso("2026-09-03"), dueDate: iso("2026-09-04") }), win)!;
    expect(g.left).toBeCloseTo(20, 6);
    expect(g.width).toBeCloseTo(20, 6);
    expect(g.clippedStart).toBe(false);
    expect(g.clippedEnd).toBe(false);
  });

  it("batang satu hari selebar satu sel, bukan nol", () => {
    const g = barGeometry(task({ dueDate: iso("2026-09-01") }), win)!;
    expect(g.left).toBeCloseTo(0, 6);
    expect(g.width).toBeCloseTo(10, 6);
  });

  /* `clippedStart`/`clippedEnd` yang TERTUKAR lolos sempurna dari uji "batang terpotong" —
     karena itu keduanya diuji terpisah, dengan sisi yang lain dipastikan MATI. */
  it("terpotong di kiri menyalakan clippedStart saja", () => {
    const g = barGeometry(task({ startDate: iso("2026-08-20"), dueDate: iso("2026-09-03") }), win)!;
    expect(g.left).toBeCloseTo(0, 6);
    expect(g.clippedStart).toBe(true);
    expect(g.clippedEnd).toBe(false);
  });

  it("terpotong di kanan menyalakan clippedEnd saja", () => {
    const g = barGeometry(task({ startDate: iso("2026-09-08"), dueDate: iso("2026-09-30") }), win)!;
    expect(g.clippedEnd).toBe(true);
    expect(g.clippedStart).toBe(false);
    expect(g.left + g.width).toBeCloseTo(100, 6);
  });

  it("batang tak pernah melewati tepi kanvas", () => {
    const g = barGeometry(task({ startDate: iso("2026-01-01"), dueDate: iso("2027-01-01") }), win)!;
    expect(g.left).toBeCloseTo(0, 6);
    expect(g.width).toBeCloseTo(100, 6);
    expect(g.clippedStart && g.clippedEnd).toBe(true);
  });

  it("di luar jendela = null di kedua arah", () => {
    expect(barGeometry(task({ dueDate: iso("2026-08-01") }), win)).toBeNull();
    expect(barGeometry(task({ startDate: iso("2026-12-01") }), win)).toBeNull();
  });

  /* Irisan SETENGAH TERBUKA. Tanpa aturan ini, task yang berakhir tepat sebelum jendela muncul
     sebagai garis rambut selebar nol di tepi kiri — kartu yang seolah dijadwalkan hari ini. */
  it("rentang yang berakhir tepat di tepi kiri tidak beririsan", () => {
    expect(barGeometry(task({ dueDate: iso("2026-08-31") }), win)).toBeNull();
  });

  it("rentang yang mulai tepat di tepi kanan tidak beririsan", () => {
    expect(barGeometry(task({ startDate: iso("2026-09-11") }), win)).toBeNull();
  });

  it("tanggal terbalik tetap punya batang, dan batangnya MENGAKU salah", () => {
    const g = barGeometry(task({ startDate: iso("2026-09-05"), dueDate: iso("2026-09-02") }), win)!;
    expect(g.invalid).toBe(true);
    expect(g.width).toBeGreaterThan(0);
  });
});

describe("todayOffset", () => {
  const DAY = 86_400_000;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const win = {
    from: at("2026-09-01"), to: at("2026-09-11"), zoom: "day" as const,
    ticks: Array.from({ length: 10 }, (_, i) => ({ start: at("2026-09-01") + i * DAY, label: `${i + 1}`, major: false })),
  };

  it("persen hari ini di dalam jendela", () => {
    expect(todayOffset(win, at("2026-09-06") + 3_600_000)).toBeCloseTo(50, 6);
  });

  // Garis "hari ini" yang dipaksa menempel di tepi menandai hari yang SALAH.
  it("null di luar jendela, bukan dijepit ke tepi", () => {
    expect(todayOffset(win, at("2026-08-01"))).toBeNull();
    expect(todayOffset(win, at("2026-09-11"))).toBeNull();
  });
});

describe("timelineRows", () => {
  const DAY = 86_400_000;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const iso = (d: string) => `${d}T12:00:00.000Z`;
  const win = {
    from: at("2026-09-01"), to: at("2026-09-11"), zoom: "day" as const,
    ticks: Array.from({ length: 10 }, (_, i) => ({ start: at("2026-09-01") + i * DAY, label: `${i + 1}`, major: false })),
  };

  it("tiga ember, dan tak satu pun task boleh jatuh di luar ketiganya", () => {
    const tasks = [
      task({ id: "a", startDate: iso("2026-09-03") }),
      task({ id: "b" }),
      task({ id: "c", dueDate: iso("2027-01-01") }),
    ];
    const r = timelineRows(tasks, win);
    expect(r.rows.map((x) => x.task.id)).toEqual(["a"]);
    expect(r.unscheduled.map((x) => x.id)).toEqual(["b"]);
    expect(r.outside.map((x) => x.id)).toEqual(["c"]);
    expect(r.rows.length + r.unscheduled.length + r.outside.length).toBe(tasks.length);
  });

  /* Urutan harus STABIL: empat langganan per kolom mendarat kapan saja, jadi urutan masukan
     bukan sesuatu yang boleh dipercaya. */
  it("baris urut mulai paling awal, tak peduli urutan masukan", () => {
    const tasks = [
      task({ id: "c", title: "C", startDate: iso("2026-09-08") }),
      task({ id: "a", title: "A", startDate: iso("2026-09-02") }),
      task({ id: "b", title: "B", startDate: iso("2026-09-05") }),
    ];
    expect(timelineRows(tasks, win).rows.map((x) => x.task.id)).toEqual(["a", "b", "c"]);
    expect(timelineRows([...tasks].reverse(), win).rows.map((x) => x.task.id)).toEqual(["a", "b", "c"]);
  });

  it("mulai yang sama dipecah judul lalu id", () => {
    const tasks = [
      task({ id: "z", title: "Beta", startDate: iso("2026-09-02") }),
      task({ id: "y", title: "Alfa", startDate: iso("2026-09-02") }),
    ];
    expect(timelineRows(tasks, win).rows.map((x) => x.task.id)).toEqual(["y", "z"]);
  });

  it("baris membawa geometrinya, bukan menghitungnya lagi di layar", () => {
    const r = timelineRows([task({ startDate: iso("2026-09-03"), dueDate: iso("2026-09-04") })], win);
    expect(r.rows[0]!.geometry.left).toBeCloseTo(20, 6);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd src && pnpm vitest --run test/team-rules.test.ts`
Expected: FAIL — `barGeometry is not a function`.

- [x] **Step 3: Implementasi**

Tambahkan di akhir `src/src/screens/team-rules.ts`:

```ts
export type BarGeometry = {
  /** Persen `0..100` terhadap `[window.from, window.to)`. */
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  invalid: boolean;
};

/**
 * Tanggal menjadi `{left%, width%}` dengan clamping di kedua tepi jendela.
 *
 * `null` berarti **tak ada batang di jendela ini** — task tanpa tanggal, atau rentangnya tak
 * beririsan sama sekali. Pemanggil yang membedakan keduanya lewat `taskSpan`, jadi tak ada
 * informasi yang hilang di sini.
 *
 * `clippedStart`/`clippedEnd` menyala saat rentang aslinya melewati tepi. Batang terpotong yang
 * tak mengaku terpotong berbohong tentang tenggat.
 *
 * Lebar PIKSEL minimum sengaja **tidak** ada di sini — itu urusan CSS. Memaksa lebar minimum ke
 * dalam persen membuat batang satu hari di zoom bulan tampak lebih panjang dari waktunya, dan itu
 * kebohongan yang sama jenisnya.
 */
export function barGeometry(
  task: Pick<TaskView, "startDate" | "dueDate">, window: TimelineWindow,
): BarGeometry | null {
  const span = taskSpan(task);
  if (!span) return null;
  const total = window.to - window.from;
  if (total <= 0) return null;
  // Irisan SETENGAH TERBUKA: rentang yang berakhir tepat di tepi kiri tak beririsan. Tanpa aturan
  // ini, task yang berakhir kemarin muncul sebagai garis rambut selebar nol di tepi kiri.
  if (span.end <= window.from || span.start >= window.to) return null;
  const left = Math.max(span.start, window.from);
  const right = Math.min(span.end, window.to);
  return {
    left: ((left - window.from) / total) * 100,
    width: ((right - left) / total) * 100,
    clippedStart: span.start < window.from,
    clippedEnd: span.end > window.to,
    invalid: span.invalid,
  };
}

/** Persen posisi hari ini, atau `null` bila di luar jendela — garis "hari ini" yang dijepit ke
    tepi menandai hari yang salah. */
export function todayOffset(window: TimelineWindow, today: number): number | null {
  const t = dayStart(today);
  if (t < window.from || t >= window.to) return null;
  return ((t - window.from) / (window.to - window.from)) * 100;
}

export type TimelineTaskRow = { task: TaskView; geometry: BarGeometry };

/**
 * Satu-satunya tempat ketiga ember dibagi, jadi tak ada task yang bisa jatuh di luar ketiganya —
 * invarian `rows + unscheduled + outside === tasks` diuji langsung.
 *
 * `outside` ada karena jendela berplafon (`MAX_TICKS`): task yang tak muat **didaftar**, bukan
 * dihilangkan.
 */
export function timelineRows(tasks: TaskView[], window: TimelineWindow): {
  rows: TimelineTaskRow[]; unscheduled: TaskView[]; outside: TaskView[];
} {
  const scheduled: (TimelineTaskRow & { start: number })[] = [];
  const unscheduled: TaskView[] = [];
  const outside: TaskView[] = [];
  for (const task of tasks) {
    const span = taskSpan(task);
    if (!span) { unscheduled.push(task); continue; }
    const geometry = barGeometry(task, window);
    if (!geometry) { outside.push(task); continue; }
    scheduled.push({ task, geometry, start: span.start });
  }
  // Diurutkan oleh `span.start`, BUKAN oleh `geometry.left`: batang yang terpotong di kiri
  // semuanya ber-`left` 0 dan urutannya akan runtuh jadi urutan kedatangan.
  scheduled.sort((a, b) =>
    a.start - b.start
    || a.task.title.localeCompare(b.task.title, "id")
    || a.task.id.localeCompare(b.task.id));
  return { rows: scheduled.map(({ task, geometry }) => ({ task, geometry })), unscheduled, outside };
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `cd src && pnpm vitest --run test/team-rules.test.ts`
Expected: PASS.

- [x] **Step 5: Typecheck**

Run: `cd src && pnpm typecheck`
Expected: nol error.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/team-rules.ts src/test/team-rules.test.ts
git commit -m "feat(948): barGeometry, todayOffset, timelineRows

Clamping dua tepi dengan flag terpisah per sisi, irisan setengah terbuka supaya
task yang berakhir kemarin tak jadi garis rambut di tepi kiri, dan tiga ember
berinvariant jumlah supaya tak ada task yang hilang tanpa jejak.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Kanvas — `team-timeline.tsx` + CSS

**Files:**
- Create: `src/src/screens/team-timeline.tsx`
- Modify: `src/src/app.css:108` (tambah `.hn-timeline-scroll` tepat di bawah `.hn-board-local-overflow`)
- Test: `src/test/team-timeline.test.tsx` (baru)

**Interfaces:**
- Consumes: `TimelineWindow`, `BarGeometry`, `barGeometry`, `timelineRows`, `timelineWindow`, `todayOffset`, `zoomCell`, `taskSpan`, `taskDates`, `TimelineZoom` dari `./team-rules`; `MemberView`/`TaskView` dari `@hanoman/shared`; `Icon`, `StateBlock` dari `../ds`.
- Produces:
  - `type TimelineBarSpec = { key: string; geometry: BarGeometry; tone: "brass"|"err"|"muted"; title: string; onClick?: () => void }`
  - `type TimelineRowSpec = { key: string; label: React.ReactNode; meta?: React.ReactNode; bars: TimelineBarSpec[] }`
  - `TimelineCanvas(props: { window: TimelineWindow; rows: TimelineRowSpec[]; today: number; emptyHint?: string }): JSX.Element`
  - `TeamTimeline(props: { tasks: TaskView[]; members: MemberView[]; zoom: TimelineZoom; today: number; hidden: number; onOpen: (t: TaskView) => void }): JSX.Element`

- [x] **Step 1: Tulis test yang gagal**

Create `src/test/team-timeline.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { MemberView, TaskView } from "@hanoman/shared";
import { TeamTimeline } from "../src/screens/team-timeline";
import { barGeometry, taskSpan, timelineWindow } from "../src/screens/team-rules";

const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (d: string) => `${d}T12:00:00.000Z`;
const TODAY = at("2026-09-12");

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p1", title: "Desain", detail: null, status: "doing",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: iso("2026-08-25"), updatedAt: iso("2026-08-25"),
  ...over,
});
const members: MemberView[] = [{
  id: "dena@x.id", name: "Dena", email: "dena@x.id", role: null, active: true,
  createdAt: iso("2026-08-25"), updatedAt: iso("2026-08-25"),
}];

const view = (tasks: TaskView[], over: Partial<Parameters<typeof TeamTimeline>[0]> = {}) => {
  const onOpen = vi.fn();
  render(<TeamTimeline tasks={tasks} members={members} zoom="day" today={TODAY}
    hidden={0} onOpen={onOpen} {...over} />);
  return { onOpen };
};

describe("TeamTimeline · kanvas", () => {
  it("batang memakai persen yang SAMA dengan barGeometry untuk masukan yang sama", () => {
    const t = task({ startDate: iso("2026-09-10"), dueDate: iso("2026-09-14") });
    view([t]);
    const win = timelineWindow([taskSpan(t)!], "day", TODAY);
    const g = barGeometry(t, win)!;
    const bar = screen.getByTestId("timeline-bar-t1");
    expect(bar.style.left).toBe(`${g.left}%`);
    expect(bar.style.width).toBe(`${g.width}%`);
  });

  it("jumlah sel header sama dengan jumlah tick jendela, dan berubah saat zoom berubah", () => {
    const t = task({ startDate: iso("2026-09-01"), dueDate: iso("2026-11-30") });
    const { unmount } = render(<TeamTimeline tasks={[t]} members={members} zoom="day"
      today={TODAY} hidden={0} onOpen={vi.fn()} />);
    const hari = screen.getAllByTestId("timeline-tick").length;
    expect(hari).toBe(timelineWindow([taskSpan(t)!], "day", TODAY).ticks.length);
    unmount();
    render(<TeamTimeline tasks={[t]} members={members} zoom="month" today={TODAY}
      hidden={0} onOpen={vi.fn()} />);
    expect(screen.getAllByTestId("timeline-tick").length).toBeLessThan(hari);
  });

  it("klik batang membuka task yang benar", () => {
    const { onOpen } = view([task({ id: "t9", startDate: iso("2026-09-12") })]);
    fireEvent.click(screen.getByTestId("timeline-bar-t9"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0].id).toBe("t9");
  });

  it("garis hari ini ada saat hari ini di dalam jendela", () => {
    view([task({ startDate: iso("2026-09-12") })]);
    expect(screen.getByTestId("timeline-today")).toBeInTheDocument();
  });

  /* SPEC-879 · gulir mendatar hidup DI DALAM kanvas; badan halaman tak boleh ikut. Dan anak blok
     yang menyusut mengikuti containernya membuat scroller-nya tak punya apa pun untuk digulir —
     lebar pembungkus dalam karena itu EKSPLISIT. */
  it("gulir mendatar milik kanvas, dengan pembungkus dalam berlebar eksplisit", () => {
    view([task({ startDate: iso("2026-09-12") })]);
    const scroller = screen.getByTestId("team-timeline");
    expect(scroller.className).toContain("hn-timeline-scroll");
    expect(scroller.style.overflowX).toBe("auto");
    const inner = screen.getByTestId("timeline-canvas");
    expect(parseInt(inner.style.minWidth, 10)).toBeGreaterThan(0);
  });
});

describe("TeamTimeline · yang tidak digambar", () => {
  it("task tanpa tanggal masuk daftar 'belum dijadwalkan', bukan disembunyikan", () => {
    view([task({ id: "kosong", title: "Tanpa tanggal" }), task({ id: "ada", startDate: iso("2026-09-12") })]);
    const list = screen.getByTestId("timeline-unscheduled");
    expect(list).toHaveTextContent("Tanpa tanggal");
    expect(screen.queryByTestId("timeline-bar-kosong")).toBeNull();
    expect(screen.getByTestId("timeline-bar-ada")).toBeInTheDocument();
  });

  it("daftar 'belum dijadwalkan' tak dirender saat semua tugas bertanggal", () => {
    view([task({ startDate: iso("2026-09-12") })]);
    expect(screen.queryByTestId("timeline-unscheduled")).toBeNull();
  });

  it("task di luar jendela berplafon didaftar dengan saran zoom, bukan dihilangkan", () => {
    view([task({ id: "jauh", title: "Jauh sekali", dueDate: iso("2031-01-01") }),
      task({ id: "dekat", startDate: iso("2026-09-12") })]);
    const list = screen.getByTestId("timeline-outside");
    expect(list).toHaveTextContent("Jauh sekali");
    expect(list.textContent).toMatch(/zoom/i);
  });

  it("plafon 200/kolom tetap diakui di linimasa", () => {
    view([task({ startDate: iso("2026-09-12") })], { hidden: 7 });
    expect(screen.getByTestId("timeline-truncated")).toHaveTextContent("7");
  });

  it("seluruh tugas tanpa tanggal: kanvas mengaku kosong, daftarnya tetap berisi", () => {
    view([task({ id: "a", title: "Satu" }), task({ id: "b", title: "Dua" })]);
    expect(screen.getByTestId("timeline-empty")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-unscheduled")).toHaveTextContent("Satu");
  });
});

describe("TeamTimeline · kejujuran batang", () => {
  it("tenggat mendahului mulai dirender dengan nada galat dan judul yang menyebut sebabnya", () => {
    view([task({ id: "kacau", startDate: iso("2026-09-14"), dueDate: iso("2026-09-10") })]);
    const bar = screen.getByTestId("timeline-bar-kacau");
    expect(bar.getAttribute("data-invalid")).toBe("true");
    expect(bar.getAttribute("title")).toMatch(/tenggat mendahului mulai/i);
  });

  it("batang terpotong mengaku terpotong", () => {
    view([task({ id: "panjang", startDate: iso("2026-09-01"), dueDate: iso("2027-06-01") })]);
    const bar = screen.getByTestId("timeline-bar-panjang");
    expect(bar.getAttribute("data-clipped-end")).toBe("true");
    expect(bar.getAttribute("title")).toMatch(/melewati tepi/i);
  });

  it("nama pemilik baris ikut dirender, kartu tanpa assignee tetap punya kalimat", () => {
    view([task({ id: "x", startDate: iso("2026-09-12"), memberId: "dena@x.id" }),
      task({ id: "y", title: "Yatim", startDate: iso("2026-09-12") })]);
    expect(screen.getByTestId("timeline-row-x")).toHaveTextContent("Dena");
    expect(screen.getByTestId("timeline-row-y")).toHaveTextContent("belum ditugaskan");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd src && pnpm vitest --run test/team-timeline.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/screens/team-timeline"`.

- [x] **Step 3: Tambahkan CSS**

Di `src/src/app.css`, tepat **di bawah** baris 108 (`.hn-board-local-overflow { … }`), tambahkan:

```css
/* SPEC-948 · kanvas linimasa. `overflow: auto` DUA sumbu: baris bisa lebih tinggi dari kotaknya
   sementara sumbu waktu lebih lebar, dan `overscroll-behavior` menahan gulir agar tak merembet ke
   badan halaman saat kanvas sudah mentok (SPEC-879). */
.hn-timeline-scroll {
  max-width: 100%;
  min-width: 0;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
```

- [x] **Step 4: Tulis `team-timeline.tsx`**

Create `src/src/screens/team-timeline.tsx`:

```tsx
import React from "react";
import type { MemberView, TaskView } from "@hanoman/shared";
import { Icon, StateBlock, FIXED_ROW_STYLE } from "../ds";
import {
  taskDates, taskSpan, timelineRows, timelineWindow, todayOffset, zoomCell,
  type BarGeometry, type TimelineWindow, type TimelineZoom,
} from "./team-rules";

/* SPEC-948 · kanvas Gantt RENCANA. Tak ada batang aktual, tak ada persen selesai, tak ada critical
   path, tak ada dependency antar-task — yang digambar hanya `startDate → dueDate` yang diketik
   manusia (ADR-0150).

   `TimelineCanvas` di bawah tak menyebut `Task` sama sekali: ia menerima baris, batang, dan
   jendela. Mode Lintas project (item E) memakainya apa adanya dengan baris per PROJECT, dan itulah
   sebabnya `bars` jamak meski mode task selalu mengirim satu. */

const LABEL_W = 232;
const ROW_H = 30;
const BAR_INSET = 5;

export type TimelineBarSpec = {
  key: string;
  geometry: BarGeometry;
  tone: "brass" | "err" | "muted";
  title: string;
  onClick?: () => void;
};

export type TimelineRowSpec = {
  key: string;
  label: React.ReactNode;
  meta?: React.ReactNode;
  bars: TimelineBarSpec[];
};

const TONE: Record<TimelineBarSpec["tone"], { bg: string; border: string }> = {
  brass: { bg: "var(--brass-300)", border: "var(--brass-500)" },
  err: { bg: "var(--status-err-tint)", border: "var(--status-err)" },
  muted: { bg: "var(--bone-300)", border: "var(--border-strong)" },
};

const stickyLabel: React.CSSProperties = {
  position: "sticky", left: 0, zIndex: 1, flex: `0 0 ${LABEL_W}px`, width: LABEL_W,
  boxSizing: "border-box", padding: "4px 10px", minWidth: 0,
  background: "var(--surface-card)", borderRight: "1px solid var(--border-hair)",
};

function Bar({ spec }: { spec: TimelineBarSpec }) {
  const g = spec.geometry;
  const tone = TONE[spec.tone];
  const square = "2px";
  return (
    <button type="button" data-testid={`timeline-bar-${spec.key}`}
      data-invalid={g.invalid ? "true" : "false"}
      data-clipped-start={g.clippedStart ? "true" : "false"}
      data-clipped-end={g.clippedEnd ? "true" : "false"}
      title={spec.title} aria-label={spec.title} onClick={spec.onClick}
      style={{
        position: "absolute", top: BAR_INSET, height: ROW_H - BAR_INSET * 2,
        left: `${g.left}%`, width: `${g.width}%`,
        // Minimum PIKSEL, bukan persen: memaksanya ke persen membuat batang satu hari di zoom
        // bulan tampak lebih panjang dari waktunya.
        minWidth: 3,
        display: "flex", alignItems: "center", gap: 2, padding: 0, overflow: "hidden",
        background: tone.bg, border: `1px solid ${tone.border}`,
        // Sudut SIKU di sisi yang terpotong — batang terpotong yang tak mengaku terpotong
        // berbohong tentang tenggat.
        borderTopLeftRadius: g.clippedStart ? square : "var(--radius-sm)",
        borderBottomLeftRadius: g.clippedStart ? square : "var(--radius-sm)",
        borderTopRightRadius: g.clippedEnd ? square : "var(--radius-sm)",
        borderBottomRightRadius: g.clippedEnd ? square : "var(--radius-sm)",
        cursor: spec.onClick ? "pointer" : "default",
      }}>
      {g.clippedStart && <Icon name="chevron-left" size={11} color={tone.border} />}
      <span style={{ flex: 1 }} />
      {g.clippedEnd && <Icon name="chevron-right" size={11} color={tone.border} />}
    </button>
  );
}

export function TimelineCanvas({ window: win, rows, today, emptyHint }: {
  window: TimelineWindow; rows: TimelineRowSpec[]; today: number; emptyHint?: string;
}) {
  const cell = zoomCell(win.zoom);
  const trackW = win.ticks.length * cell;
  const marker = todayOffset(win, today);
  /* Gridline sebagai GRADIEN, bukan satu div per sel per baris: 40 baris x 120 tick = 4 800 node
     kosong yang tak pernah dibaca siapa pun. Ia tetap sejajar dengan header karena kanvasnya
     sama-sama `N x cell` px. */
  const track: React.CSSProperties = {
    position: "relative", width: trackW, height: ROW_H, flex: `0 0 ${trackW}px`,
    backgroundImage:
      `repeating-linear-gradient(to right, var(--border-hair) 0 1px, transparent 1px ${cell}px)`,
  };
  return (
    <div data-testid="team-timeline" className="hn-timeline-scroll"
      style={{ flex: "1 1 auto", minHeight: 0, overflowX: "auto", overflowY: "auto" }}>
      {/* Lebar EKSPLISIT: anak blok di dalam container `overflow: auto` menyusut mengikuti
          containernya, dan scroller-nya lalu tak punya apa pun untuk digulir (SPEC-879). */}
      <div data-testid="timeline-canvas"
        style={{ position: "relative", minWidth: LABEL_W + trackW, width: LABEL_W + trackW }}>
        <div style={{
          display: "flex", position: "sticky", top: 0, zIndex: 2,
          background: "var(--bone-100)", borderBottom: "1px solid var(--border-hair)",
        }}>
          <div style={{ ...stickyLabel, zIndex: 3, background: "var(--bone-100)" }}>
            <span className="hn-eyebrow">Tugas</span>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: `repeat(${win.ticks.length}, ${cell}px)`,
            width: trackW, flex: `0 0 ${trackW}px`,
          }}>
            {win.ticks.map((t) => (
              <div key={t.start} data-testid="timeline-tick" style={{
                borderLeft: `1px solid ${t.major ? "var(--border-strong)" : "var(--border-hair)"}`,
                padding: "5px 4px", fontFamily: "var(--font-mono)", fontSize: 10,
                whiteSpace: "nowrap", overflow: "hidden",
                color: t.major ? "var(--text-body)" : "var(--text-subtle)",
              }}>{t.label}</div>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div data-testid="timeline-empty" style={{
            ...stickyLabel, position: "static", width: "auto", flex: "none",
            borderRight: "none", padding: "18px 10px",
            fontSize: "var(--text-xs)", color: "var(--text-muted)",
          }}>{emptyHint ?? "Tak ada yang bisa dihamparkan di jendela ini."}</div>
        ) : rows.map((r) => (
          <div key={r.key} data-testid={`timeline-row-${r.key}`}
            style={{ display: "flex", borderBottom: "1px solid var(--border-hair)" }}>
            <div style={stickyLabel}>
              <div style={{
                fontSize: 12, fontWeight: "var(--weight-medium)", color: "var(--text-strong)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{r.label}</div>
              {r.meta && <div style={{
                fontSize: 10, color: "var(--text-subtle)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{r.meta}</div>}
            </div>
            <div style={track}>
              {r.bars.map((b) => <Bar key={b.key} spec={b} />)}
            </div>
          </div>
        ))}

        {marker !== null && (
          <div data-testid="timeline-today" aria-hidden="true" style={{
            position: "absolute", top: 0, bottom: 0, width: 2, pointerEvents: "none",
            left: LABEL_W + (marker / 100) * trackW,
            background: "var(--brass-500)", opacity: 0.5,
          }} />
        )}
      </div>
    </div>
  );
}

/* ── mode task ──────────────────────────────────────────────────────────────────────────────── */

function Aside({ testId, icon, title, hint, tasks, onOpen }: {
  testId: string; icon: string; title: string; hint?: string;
  tasks: TaskView[]; onOpen: (t: TaskView) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div data-testid={testId} style={{
      ...FIXED_ROW_STYLE, marginTop: 10, padding: 10,
      background: "var(--bone-100)", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-lg)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Icon name={icon} size={13} color="var(--text-subtle)" />
        <span className="hn-eyebrow">{title} · {tasks.length}</span>
        {hint && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{hint}</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tasks.map((t) => (
          <button key={t.id} type="button" onClick={() => onOpen(t)} style={{
            padding: "3px 8px", background: "var(--surface-card)",
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-body)", cursor: "pointer",
          }}>{t.title}</button>
        ))}
      </div>
    </div>
  );
}

export function TeamTimeline({ tasks, members, zoom, today, hidden, onOpen }: {
  tasks: TaskView[]; members: MemberView[]; zoom: TimelineZoom; today: number;
  /** Selisih `total` vs yang termuat, akibat plafon 200/kolom (ADR-0151). */
  hidden: number;
  onOpen: (t: TaskView) => void;
}) {
  const win = React.useMemo(() => {
    const spans = tasks.map(taskSpan).filter((s): s is NonNullable<typeof s> => s !== null);
    return timelineWindow(spans, zoom, today);
  }, [tasks, zoom, today]);

  const { rows, unscheduled, outside } = React.useMemo(
    () => timelineRows(tasks, win), [tasks, win]);

  const rowSpecs = React.useMemo<TimelineRowSpec[]>(() => rows.map(({ task, geometry }) => {
    // Anggota bisa lenyap dari daftar sebelum kartunya menyusul (frame sync mendahului). Yang
    // dirender tetap kalimat manusia, bukan id mentah — cermin `TaskCard` di papan.
    const assignee = members.find((m) => m.id === task.memberId)?.name ?? "belum ditugaskan";
    const dates = taskDates(task);
    const notes = [
      geometry.invalid ? "tenggat mendahului mulai" : null,
      geometry.clippedStart || geometry.clippedEnd ? "melewati tepi jendela" : null,
    ].filter(Boolean);
    return {
      key: task.id,
      label: task.title,
      meta: dates ? `${assignee} · ${dates}` : assignee,
      bars: [{
        key: task.id,
        geometry,
        tone: geometry.invalid ? "err" as const
          : task.status === "done" ? "muted" as const : "brass" as const,
        title: [task.title, dates, ...notes].filter(Boolean).join(" · "),
        onClick: () => onOpen(task),
      }],
    };
  }), [rows, members, onOpen]);

  return (
    <>
      <TimelineCanvas window={win} rows={rowSpecs} today={today}
        emptyHint="Belum ada tugas bertanggal — isi mulai atau tenggat di kartunya." />
      {hidden > 0 && (
        <div data-testid="timeline-truncated" style={{
          ...FIXED_ROW_STYLE, marginTop: 8, fontSize: "var(--text-xs)", color: "var(--amber-600)",
        }}>
          {hidden} tugas tak termuat karena plafon 200 per kolom — persempit penyaring
        </div>
      )}
      <Aside testId="timeline-unscheduled" icon="calendar-off" title="Belum dijadwalkan"
        tasks={unscheduled} onOpen={onOpen} />
      <Aside testId="timeline-outside" icon="chevrons-left-right" title="Di luar jendela"
        hint="pilih zoom yang lebih lebar" tasks={outside} onOpen={onOpen} />
    </>
  );
}
```

**Catatan impor:** `StateBlock` **tidak** dipakai di berkas ini — hapus dari daftar impor sebelum commit bila linter/typecheck mengeluh `noUnusedLocals`.

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `cd src && pnpm vitest --run test/team-timeline.test.tsx`
Expected: PASS (18 test).

- [x] **Step 6: Verifikasi nama ikon benar-benar ada di lucide**

Run:
```bash
node -e "const {icons}=require('./src/node_modules/lucide-react');
for (const n of ['CalendarOff','ChevronsLeftRight','ChevronLeft','ChevronRight','GanttChart'])
  console.log(n, n in icons ? 'OK' : 'MISSING');"
```
Expected: kelimanya `OK`. SPEC-906 menunjukkan nama yang salah jatuh ke `Circle` tanpa satu pun galat — nama baru tak boleh masuk tanpa dicek.

- [x] **Step 7: Typecheck**

Run: `cd src && pnpm typecheck`
Expected: nol error.

- [x] **Step 8: Commit**

```bash
git add src/src/screens/team-timeline.tsx src/src/app.css src/test/team-timeline.test.tsx
git commit -m "feat(948): kanvas linimasa — TimelineCanvas generik + mode task

Canvas tak menyebut Task sama sekali dan menerima bars JAMAK supaya mode Lintas
project (item E) memakainya apa adanya. Gridline gradien menggantikan 4 800 div
kosong; lebar pembungkus dalam eksplisit supaya scroller-nya hidup (SPEC-879);
task tanpa tanggal & di luar jendela DIDAFTAR, bukan dihilangkan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Integrasi layar — tab Linimasa + Select zoom

**Files:**
- Modify: `src/src/screens/TeamScreen.tsx` (impor, `TEAM_VIEWS`, state zoom, toolbar, cabang render)
- Test: `src/test/team-screen.test.tsx` (tambah)

**Interfaces:**
- Consumes: `TeamTimeline` dari `./team-timeline`; `TIMELINE_ZOOMS`, `type TimelineZoom` dari `./team-rules`; `usePersistedState`, `oneOf` dari `../ui-state`.
- Produces: (tak ada yang dikonsumsi task lain)

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/test/team-screen.test.tsx`:

```tsx
/* SPEC-948 · mode kedua. Datanya `board` yang SUDAH dimuat mode Papan — berpindah mode tak boleh
   melahirkan satu pun request baru. */
describe("TeamScreen · mode Linimasa", () => {
  const dated = () => task({ id: "t1", title: "Desain", startDate: "2026-09-10T12:00:00.000Z" });

  it("tab Linimasa ada dan memilihnya mengganti papan dengan kanvas", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([dated()]) : page([]));
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("tab", { name: /linimasa/i }));
    expect(await screen.findByTestId("team-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("team-board")).toBeNull();
  });

  it("berpindah mode tidak memuat ulang data", async () => {
    view();
    await screen.findByTestId("team-board");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    vi.mocked(api.listTasks).mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /linimasa/i }));
    await screen.findByTestId("team-timeline");
    expect(api.listTasks).not.toHaveBeenCalled();
  });

  it("Select zoom hanya hidup di mode Linimasa", async () => {
    view();
    await screen.findByTestId("team-board");
    expect(screen.queryByLabelText("Zoom linimasa")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /linimasa/i }));
    const zoom = await screen.findByLabelText("Zoom linimasa");
    expect((zoom as HTMLSelectElement).value).toBe("week");
  });

  it("ganti zoom mengubah kerapatan sumbu tanpa menyentuh server", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([task({ startDate: "2026-09-01T12:00:00.000Z", dueDate: "2026-11-30T12:00:00.000Z" })]) : page([]));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /linimasa/i }));
    await screen.findByTestId("team-timeline");
    const minggu = screen.getAllByTestId("timeline-tick").length;
    vi.mocked(api.listTasks).mockClear();
    fireEvent.change(screen.getByLabelText("Zoom linimasa"), { target: { value: "day" } });
    await waitFor(() => expect(screen.getAllByTestId("timeline-tick").length).toBeGreaterThan(minggu));
    expect(api.listTasks).not.toHaveBeenCalled();
  });

  it("penyaring kolom ikut mempersempit linimasa", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([task({ id: "b1", title: "Di backlog", startDate: "2026-09-10T12:00:00.000Z" })])
        : p?.status === "doing" ? page([task({ id: "d1", title: "Dikerjakan", status: "doing", startDate: "2026-09-10T12:00:00.000Z" })])
        : page([]));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /linimasa/i }));
    await screen.findByTestId("timeline-bar-b1");
    fireEvent.change(screen.getByLabelText("Filter kolom"), { target: { value: "doing" } });
    await waitFor(() => expect(screen.queryByTestId("timeline-bar-b1")).toBeNull());
    expect(screen.getByTestId("timeline-bar-d1")).toBeInTheDocument();
  });

  it("klik batang membuka kartunya di modal yang sama", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([dated()]) : page([]));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /linimasa/i }));
    fireEvent.click(await screen.findByTestId("timeline-bar-t1"));
    expect(await screen.findByLabelText("Judul tugas")).toHaveValue("Desain");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd src && pnpm vitest --run test/team-screen.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "tab" and name /linimasa/i`.

- [x] **Step 3: Ubah `TeamScreen.tsx`**

**(a)** Ganti impor `team-rules` dan tambahkan impor `team-timeline` (baris ±13-16):

```tsx
import { TeamBoard } from "./team-board";
import { TeamTimeline } from "./team-timeline";
import { TaskModal } from "./TaskModal";
import { EscalateDialog } from "./EscalateDialog";
import { MembersPanel } from "./MembersPanel";
import {
  TEAM_COLUMNS, TIMELINE_ZOOMS, emptyBoard, moveCard, nextOrder, replaceCard,
  type Board, type TimelineZoom,
} from "./team-rules";
```

**(b)** Ganti blok `TEAM_VIEWS` (baris ±38-40) menjadi:

```tsx
// Item E (Lintas project) menambahkan entri ke array yang SAMA — bukan memasang mekanisme baru.
const TEAM_VIEWS = [
  { value: "board", label: "Papan", icon: "kanban" },
  // `gantt-chart` → `GanttChart` DIVERIFIKASI ada di lucide 0.400.0: SPEC-906 menunjukkan nama yang
  // salah jatuh ke `Circle` tanpa satu pun galat, di ±123 call site sekaligus.
  { value: "timeline", label: "Linimasa", icon: "gantt-chart" },
];

const ZOOM_LABEL: Record<TimelineZoom, string> = { day: "Hari", week: "Minggu", month: "Bulan" };
```

**(c)** Tepat di bawah `const [memberFilter, setMemberFilter] = …`, tambahkan:

```tsx
  // Bawaan `week`: hari terlalu sempit untuk melihat tabrakan, bulan terlalu kasar untuk melihat
  // tenggat. Zoom bukan PENYARING — ia tak ikut `activeFilters` dan tak menyentuh server.
  const [zoom, setZoom] = usePersistedState<TimelineZoom>("team", "zoom", "week", oneOf(...TIMELINE_ZOOMS));
  const timeline = view === "timeline";
  // Dibekukan sekali per mount: jendela yang bergeser di tengah interaksi lebih membingungkan
  // daripada tanggal yang basi satu hari sampai tab dimuat ulang.
  const today = React.useRef(Date.now()).current;
```

**(d)** Tepat di bawah `const empty = columns.every(…)`, tambahkan:

```tsx
  const tasks = React.useMemo(() => columns.flatMap((c) => board[c.key]), [board, columns]);
  const hiddenTasks = columns.reduce((n, c) => n + Math.max(0, (totals[c.key] ?? 0) - board[c.key].length), 0);
```

**(e)** Di baris filter toolbar, tepat **sesudah** `Select` "Filter anggota", tambahkan:

```tsx
          {timeline && (
            <Select size="sm" aria-label="Zoom linimasa" value={zoom}
              onChange={(e) => setZoom(e.target.value as TimelineZoom)}
              options={TIMELINE_ZOOMS.map((z) => ({ value: z, label: ZOOM_LABEL[z] }))} />
          )}
```

**(f)** Ganti cabang render terakhir (`: <TeamBoard … />`) menjadi:

```tsx
        : timeline
          ? <TeamTimeline tasks={tasks} members={members} zoom={zoom} today={today}
              hidden={hiddenTasks} onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />
          : <TeamBoard board={board} totals={totals} columns={columns} members={members}
              onMove={move} onAssign={assign} onEscalate={setEscalating} onUnlink={unlink}
              onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />}
```

**(g)** Perbarui komentar `usePersistedState` di atasnya agar menyebut zoom, dan pastikan `oneOf` sudah ada di impor `../ui-state` (sudah ada sejak SPEC-946).

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `cd src && pnpm vitest --run test/team-screen.test.tsx test/team-timeline.test.tsx test/team-rules.test.ts test/team-board.test.tsx test/team-escalate.test.tsx test/team-nav.test.tsx`
Expected: PASS semua — termasuk seluruh test SPEC-946/947 yang lama.

- [x] **Step 5: Typecheck**

Run: `cd src && pnpm typecheck`
Expected: nol error.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/TeamScreen.tsx src/test/team-screen.test.tsx
git commit -m "feat(948): mode Linimasa di layar Tim

Satu entri TEAM_VIEWS + Select zoom (hanya di mode ini, bukan penyaring) +
satu cabang render. Datanya \`board\` yang sudah dimuat mode Papan: berpindah
mode & ganti zoom tak melahirkan satu pun request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Docs — ADR-0153 + index + frontend-implementation

**Files:**
- Create: `internal/docs/adr/0153-linimasa-gantt-papan-tim.md`
- Modify: `internal/docs/README.md` (tambah butir setelah butir ADR-0152)
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian layar Tim)

**Interfaces:**
- Consumes: keputusan yang sudah dikunci Task 1-5.
- Produces: —

- [x] **Step 1: Konfirmasi nomor ADR masih bebas**

Run: `ls internal/docs/adr/ | grep -c '^0153'`
Expected: `0`. Bila bukan nol, ADR/SPEC bentrok antar-worktree — ambil nomor bebas berikutnya dan pakai nomor itu di seluruh langkah berikut.

- [x] **Step 2: Tulis ADR-0153**

Create `internal/docs/adr/0153-linimasa-gantt-papan-tim.md` mengikuti struktur ADR-0151 (Status · Konteks · Keputusan · Konsekuensi · Alternatif yang ditolak). Isi yang **wajib** tercatat, karena semuanya adalah keputusan yang tak terbaca dari kode:

1. **Akhir tanggal inklusif.** `end = dayStart(due) + DAY`. Tanpa itu, task sehari punya lebar nol dan kartunya seolah tak bertanggal — gagal senyap tanpa satu pun galat.
2. **"Belum dijadwalkan" berarti KEDUA tanggal null.** Satu tanggal saja tetap terjadwal sebagai batang satu hari, konsisten dengan `taskDates` yang sudah merender rentang setengah terisi sejak SPEC-946.
3. **Tenggat yang mendahului mulai digambar + ditandai, bukan ditukar.** `zCreateTask` tak memaksa urutannya dan `TaskModal` tak memvalidasinya, jadi keadaan ini ada di DB.
4. **Jendela lahir dari data ∪ hari ini**, dibulatkan keluar ke batas satuan zoom, dengan tick minimum per zoom.
5. **Plafon `MAX_TICKS = 120`** melindungi DOM, dan task yang jatuh di luar **didaftar** — cermin "menampilkan N dari M" ADR-0151.
6. **Tick bulan adalah satuan kalender**, jadi tak sama lebar dalam hari; batang diposisikan oleh **waktu** (persen) sementara gridline oleh **piksel**. Konsekuensinya: di zoom bulan garis grid adalah penanda bulan, bukan koordinat presisi batang.
7. **Aritmetika UTC di kedua sisi**, karena `dateInputToIso` menulis tengah hari UTC — dan setiap `Intl.DateTimeFormat` di jalur ini ber-`timeZone: "UTC"`.
8. **`today` selalu argumen**, tak pernah dibaca dari jam sistem di dalam `team-rules.ts`.
9. **Nol fetch baru:** linimasa membaca `board` yang sudah dilanggan per kolom (ADR-0151), jadi plafon 200/kolom berlaku dan tetap dirender.
10. **`TimelineCanvas` generik dengan `bars` jamak**, tak menyebut `Task` — kontrak yang membuat mode Lintas project (item E) memakainya ulang tanpa membongkar tanda tangannya.
11. **Gridline sebagai gradien, bukan div per sel** (40 × 120 = 4 800 node kosong).
12. **Alternatif yang ditolak:** library Gantt (dependency + tak bisa memakai token DS); menyeret batang untuk mengubah tanggal (butuh kuantisasi, snapping, undo — `TaskModal` tetap satu-satunya penulis tanggal); menyimpan geometri di state (dua kebenaran yang bisa drift); jendela tetap "hari ini ± N" (papan berisi rencana kuartal depan tampak kosong).

- [x] **Step 3: Tautkan di index**

Tambahkan satu butir di `internal/docs/README.md`, **tepat setelah** butir ADR-0152, dengan bentuk yang sama seperti tetangganya (judul tebal + nomor ADR, tautan doc yang tersentuh, lalu ringkasan keputusan yang padat):

```markdown
- **Layar `Tim` — mode Linimasa (ADR-0153)** — mode tampilan kedua di atas papan yang sama ([frontend-implementation](frontend/frontend-implementation.md)). Baris = task, batang = `startDate → dueDate`, zoom hari/minggu/bulan, digambar CSS grid + token DS **tanpa library chart**. Seluruh aritmetikanya fungsi MURNI di `team-rules.ts` (`taskSpan` · `timelineWindow` · `barGeometry` · `todayOffset` · `timelineRows`) dan `today` **selalu argumen**. Akhir tanggal **inklusif** — tanpa itu task sehari berlebar nol dan kartunya seolah tak bertanggal; "belum dijadwalkan" karena itu berarti **kedua** tanggal null, satu tanggal saja tetap batang satu hari. Tenggat yang mendahului mulai **digambar + ditandai**, tidak ditukar diam-diam. Jendela lahir dari **data ∪ hari ini** dibulatkan ke batas satuan zoom; tick berplafon **120** untuk melindungi DOM dan yang jatuh di luar **didaftar** ("Di luar jendela"), cermin "menampilkan N dari M" ADR-0151. Tick bulan satuan **kalender** → batang diposisikan oleh WAKTU (persen), gridline oleh PIKSEL. Aritmetika & label **UTC** di kedua sisi (`dateInputToIso` menulis tengah hari UTC). **Nol fetch baru**: linimasa membaca `board` yang sudah dilanggan per kolom. `TimelineCanvas` generik ber-`bars` **jamak** dan tak menyebut `Task` sama sekali — kontrak yang dipakai ulang mode Lintas project
```

- [x] **Step 4: Perbarui `frontend-implementation.md`**

Run: `grep -n "Tim\b\|team-board\|TeamScreen" internal/docs/frontend/frontend-implementation.md`

Di bagian yang mendaftar layar Tim (ditulis SPEC-946), perbarui daftar mode tampilan dari satu menjadi dua, dan tambahkan baris berkas:

```
team-timeline.tsx   kanvas Gantt generik (TimelineCanvas) + mode task (TeamTimeline)
```

sebutkan bahwa mode Linimasa memakai data papan yang sama (nol fetch), zoom persisten lewat `uiKey("team","zoom")`, dan dua daftar di bawah kanvas ("Belum dijadwalkan", "Di luar jendela"). Cocokkan gaya & tingkat detail dengan paragraf tetangganya — jangan menyalin isi ADR ke sini.

- [x] **Step 5: Verifikasi integritas index**

Run: `node dist/cli.js docs index --check 2>/dev/null || pnpm --filter ./runner exec tsx src/cli.ts docs index --check`
Expected: index konsisten. Bila perintahnya tak tersedia di worktree ini, cukup pastikan tautan relatif di butir baru menunjuk berkas yang benar-benar ada:
`ls internal/docs/frontend/frontend-implementation.md internal/docs/adr/0153-linimasa-gantt-papan-tim.md`

- [x] **Step 6: Commit**

```bash
git add internal/docs/adr/0153-linimasa-gantt-papan-tim.md internal/docs/README.md internal/docs/frontend/frontend-implementation.md
git commit -m "docs(948): ADR-0153 linimasa Gantt papan tim + index + frontend

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Verifikasi akhir & penyapuan

**Files:** —

**Interfaces:**
- Consumes: seluruh perubahan Task 1-6.
- Produces: —

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

Run:
```bash
cd src && env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS \
  pnpm vitest --run test/team-rules.test.ts test/team-timeline.test.tsx \
  test/team-screen.test.tsx test/team-board.test.tsx test/team-escalate.test.tsx test/team-nav.test.tsx
```
Expected: seluruh berkas PASS, dan jumlah test **naik** dibanding sebelum SPEC-948. Jangan menerima "no test files" sebagai bukti.

- [ ] **Step 2: Typecheck paket yang tersentuh**

Run: `cd src && pnpm typecheck`
Expected: nol error. **Jangan** `pnpm -r typecheck`.

- [ ] **Step 3: Penyapuan blast-radius**

Dispatch subagent `blast-radius` dengan lingkup: "SPEC-948 memindahkan `taskDates` dari `team-board.tsx` ke `team-rules.ts` dan menambah entri kedua ke `TEAM_VIEWS` di `TeamScreen.tsx`. Cari tempat LAIN yang seharusnya ikut berubah tapi tidak: cermin daftar mode tampilan, doc yang menyebut layar Tim hanya punya satu mode, test kontrak nav, daftar kunci `uiKey`, dan pemakaian `taskDates` yang tertinggal." Terapkan temuan yang benar-benar berlaku.

- [ ] **Step 4: Verifikasi bahwa test yang lulus memang menguji perubahannya**

Dispatch subagent `qa-verifier` dengan lingkup berkas di Task 1-5. Ia harus membuktikan test barunya benar-benar berjalan (bukan `passWithNoTests`) dan memisahkan gagal palsu (env sesi, Node 25/jsdom) dari regresi.

- [ ] **Step 5: Centang plan & commit penutup**

Pastikan setiap `- [ ]` di berkas plan ini sudah `- [x]`, lalu:

```bash
git add docs/superpowers/plans/2026-08-25-spec-948-linimasa-papan-tim.md
git commit -m "docs(plan-948): centang tuntas + hasil penyapuan subagent

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Cakupan spec → task:**

| Bagian spec | Task |
|---|---|
| `taskSpan` — inklusif, setengah bertanggal, terbalik, `NaN` | 1 |
| `taskDates` pindah rumah | 1 |
| `timelineWindow` + tick + zoom + plafon | 2 |
| `barGeometry` + clamping dua sisi | 3 |
| `todayOffset` | 3 |
| `timelineRows` + tiga ember | 3 |
| `TimelineCanvas` generik (`bars` jamak, tak menyebut `Task`) | 4 |
| Sticky label, gridline gradien, lebar eksplisit (SPEC-879) | 4 |
| Daftar "Belum dijadwalkan" & "Di luar jendela" | 4 |
| Plafon 200/kolom dirender di linimasa | 4, 5 |
| Entri `TEAM_VIEWS` + ikon terverifikasi | 5 |
| Select zoom persisten, bukan penyaring | 5 |
| Nol fetch baru saat pindah mode / ganti zoom | 5 |
| Klik batang membuka `TaskModal` | 4, 5 |
| ADR-0153 + index + frontend-implementation | 6 |

**Tak ada placeholder.** Setiap langkah kode membawa kodenya; setiap langkah perintah membawa perintah dan hasil yang diharapkan. Task 6 langkah 2 & 4 menyebut isi yang wajib tercatat butir demi butir alih-alih naskah utuh — itu doc prosa yang harus mengikuti gaya berkas tetangganya, bukan kode yang harus persis.

**Konsistensi tipe:** `TaskSpan` (Task 1) dipakai `timelineWindow` (Task 2) dan `timelineRows` (Task 3). `TimelineWindow` (Task 2) dipakai `barGeometry`/`todayOffset` (Task 3) dan `TimelineCanvas` (Task 4). `BarGeometry` (Task 3) dipakai `TimelineBarSpec` (Task 4). `TimelineZoom` (Task 2) dipakai `TeamTimeline` (Task 4) dan `TeamScreen` (Task 5). Nama fungsi identik di seluruh task.
