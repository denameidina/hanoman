# Cronjob per project di scheduler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiap project punya daftar cronjob-nya sendiri di panel scheduler; saat jatuh tempo, engine scheduler yang sudah ada membuka sesi agen di worktree project itu dengan prompt operator, tunduk pada cap concurrency, antrean, dan Pause.

**Architecture:** Dua tabel LOCAL-ONLY (`SchedulerCron` + `SchedulerCronRun`) di atas engine ADR-0072 yang sudah ada — **tanpa timer kedua**. Tick yang sudah berjalan bertambah satu langkah `sweepCronDue()` (materialisasi jatuh tempo → baris run, idempoten lewat `@@unique([cronId, dueAt])`), lalu `drain()` membelanjakan anggaran slot yang sama untuk cron lebih dulu baru antrean spec. Sesi cron adalah sesi project-level ber-id deterministik `cron-<cronId>` di worktree isolasi, sehingga "satu sesi per cron" struktural. Penjadwalan dihitung modul murni di `@hanoman/shared` yang dipakai server **dan** browser.

**Tech Stack:** TypeScript strict · Prisma 6 + SQLite · Fastify · React + Vite · vitest · zod.

## Global Constraints

- Engine tetap **in-process**: satu `setInterval` di `services/scheduler/engine.ts`, di-`start` **hanya dari `server.ts`**, timer `.unref()`; `app.ts` tetap **bebas-timer**. Tanpa cron OS, worker terpisah, atau message queue (ADR-0024/ADR-0072).
- Peluncuran wajib melewati governor sehingga cap `pty.listSessions()`, antrean durable, dan `Setting.scheduler.paused` tetap berlaku. **Cron tak boleh menembus cap.**
- Kedua model baru **LOCAL-ONLY**: tak masuk `FIELDS`/`DATE_FIELDS` di `server/src/services/sync.ts`, tanpa kolom `version` — cermin `SchedulerQueueItem`.
- **Default aman:** tak ada cron bawaan; cron baru lahir `enabled = false`; seluruh fitur mati saat `Setting.scheduler.enabled === false`.
- **Idempoten:** satu jatuh tempo = paling banyak satu sesi walau tick berulang, restart di tengah, atau server mati saat jatuh tempo. Jatuh tempo tertunggak **tak pernah** menembak burst — dicatat sebagai `skipped`.
- **Satu sesi per cron:** sesi cron sebelumnya masih hidup → jatuh tempo berikutnya `skipped` dengan alasan tercatat.
- Penjadwalan memakai **zona waktu lokal server** dan aman DST.
- UI mengikuti design system (editorial, bone paper, brass accent) dan paginasi ADR-0107 (`serverPage` + `Pager`).
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama**, termasuk tautan di `internal/docs/README.md` dan `internal/docs/adr/README.md`.
- **Nomor ADR: 0112.** Verifikasi ulang tepat sebelum push (`ls internal/docs/adr`, `git branch -a`, `git worktree list`).
- Test dijalankan dengan DB terisolasi: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan `--no-file-parallelism` bila menyentuh test server. Test web dijalankan dengan `env -u NODE_ENV`.
- Jangan `pkill -f`/`killall`. Bunuh per-PID.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/cron-expr.ts` (baru) | Parser cron 5-field, `nextRun`, preset ↔ expr, `describeCron`. Murni, nol I/O. Dipakai server & browser. |
| `shared/src/cron-expr.test.ts` (baru) | Test tabel modul di atas. |
| `shared/src/dto.ts` | `zCreateCron`/`zPatchCron`/`zSchedulerCron`/`zSchedulerCronRun` + tipe view. |
| `shared/src/api.ts` | Enam path baru di bawah `/scheduler/crons`. |
| `shared/src/index.ts` | Re-export `./cron-expr`. |
| `server/prisma/schema.prisma` | Model `SchedulerCron` + `SchedulerCronRun`. |
| `server/prisma/migrations/20260811000000_scheduler_cron/migration.sql` (baru) | DDL kedua tabel. |
| `cli/src/commands/migrate-pg.ts` | `PG_ORDER` + dua model baru (gerbang test DMMF). |
| `server/src/services/scheduler/cron.ts` (baru) | Query cron/run, `sweepCronDue()`, transisi run, notifikasi. |
| `server/src/services/scheduler/cron-session.ts` (baru) | `startCronSession()` — worktree + `createSession`. |
| `server/src/services/scheduler/governor.ts` | `drainCrons` di anggaran slot yang sama, sebelum loop spec. |
| `server/src/services/scheduler/engine.ts` | `sweepCronDue` di tick + `prodDeps.drainCrons`. |
| `server/src/services/notifications.ts` | `recordCronRun()`. |
| `server/src/services/agent-capabilities.ts` | `/scheduler/crons*` → `COOKIE_ONLY`. |
| `server/src/routes/scheduler.ts` | Enam endpoint CRUD + run-now + riwayat. |
| `runner/src/prompt.ts` | `cronPrompt()`. |
| `src/src/api/client.ts` | Enam metode klien. |
| `src/src/screens/SchedulerCrons.tsx` (baru) | Panel cron: daftar, form modal, riwayat run berhalaman. |
| `src/src/screens/SchedulerScreen.tsx` | Pasang panel cron. |

---

### Task 1: Modul jadwal murni (`shared/src/cron-expr.ts`)

**Files:**
- Create: `shared/src/cron-expr.ts`
- Create: `shared/src/cron-expr.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: tak ada.
- Produces:
  - `type CronSpec = { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domRestricted: boolean; dowRestricted: boolean }`
  - `parseCron(expr: string): CronSpec | null`
  - `nextRun(spec: CronSpec, after: Date, limitDays?: number): Date | null`
  - `nextRunFor(expr: string, after: Date): Date | null`
  - `type CronPreset = { kind: "harian"; hour: number; minute: number } | { kind: "hari-kerja"; hour: number; minute: number } | { kind: "mingguan"; hour: number; minute: number; weekday: number } | { kind: "tiap-n-jam"; everyHours: number; minute: number }`
  - `presetToExpr(p: CronPreset): string`
  - `exprToPreset(expr: string): CronPreset | null`
  - `describeCron(expr: string): string`
  - `WEEKDAY_LABELS: readonly string[]`

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/cron-expr.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseCron, nextRun, nextRunFor, presetToExpr, exprToPreset, describeCron,
} from "./cron-expr";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe("parseCron", () => {
  it("menerima lima field dan bentuk yang didukung", () => {
    expect(parseCron("0 7 * * *")).not.toBeNull();
    expect(parseCron("30 9 * * 1-5")).not.toBeNull();
    expect(parseCron("0 */6 * * *")).not.toBeNull();
    expect(parseCron("0,30 8-10 1,15 1-6/2 *")).not.toBeNull();
  });
  it("menolak bentuk yang tak sah", () => {
    for (const bad of ["", "0 7 * *", "0 7 * * * *", "60 7 * * *", "0 24 * * *",
      "0 7 0 * *", "0 7 * 13 *", "0 7 * * 8", "a 7 * * *", "0 7 * * 1-", "0 /2 * * *", "0 */0 * * *"]) {
      expect(parseCron(bad), bad).toBeNull();
    }
  });
  it("dow 7 dinormalkan ke 0 (Minggu)", () => {
    expect([...parseCron("0 7 * * 7")!.dow]).toEqual([0]);
  });
});

describe("nextRun", () => {
  it("harian: jatuh tempo berikutnya di hari yang sama bila jamnya belum lewat", () => {
    expect(nextRunFor("0 7 * * *", at(2026, 8, 11, 3, 0))).toEqual(at(2026, 8, 11, 7, 0));
  });
  it("harian: pindah ke besok bila jamnya sudah lewat", () => {
    expect(nextRunFor("0 7 * * *", at(2026, 8, 11, 7, 0))).toEqual(at(2026, 8, 12, 7, 0));
  });
  it("hari kerja: Sabtu 09:30 melompat ke Senin", () => {
    // 2026-08-15 adalah Sabtu.
    expect(nextRunFor("30 9 * * 1-5", at(2026, 8, 15, 0, 0))).toEqual(at(2026, 8, 17, 9, 30));
  });
  it("mingguan: Senin berikutnya", () => {
    expect(nextRunFor("0 8 * * 1", at(2026, 8, 11, 9, 0))).toEqual(at(2026, 8, 17, 8, 0));
  });
  it("tiap N jam: kelipatan berikutnya", () => {
    expect(nextRunFor("0 */6 * * *", at(2026, 8, 11, 7, 30))).toEqual(at(2026, 8, 11, 12, 0));
  });
  it("melompati batas bulan", () => {
    expect(nextRunFor("0 0 1 * *", at(2026, 8, 20, 12, 0))).toEqual(at(2026, 9, 1, 0, 0));
  });
  it("tanggal & hari-pekan sama-sama dibatasi → OR (aturan Vixie)", () => {
    // 2026-08-12 Rabu; dom=15 ATAU dow=3 → Rabu 12 Agustus lebih dulu daripada tanggal 15.
    expect(nextRunFor("0 0 15 * 3", at(2026, 8, 11, 12, 0))).toEqual(at(2026, 8, 12, 0, 0));
  });
  it("hasilnya SELALU lebih besar dari `after` (invarian DST)", () => {
    const spec = parseCron("*/1 * * * *")!;
    let cur = at(2026, 3, 1, 0, 0);
    for (let i = 0; i < 200; i++) {
      const nxt = nextRun(spec, cur)!;
      expect(nxt.getTime()).toBeGreaterThan(cur.getTime());
      cur = nxt;
    }
  });
  it("mengembalikan null bila tak ada yang cocok dalam batas hari", () => {
    // 30 Februari tak pernah ada.
    expect(nextRunFor("0 0 30 2 *", at(2026, 1, 1))).toBeNull();
  });
});

describe("preset", () => {
  it("round-trip keempat bentuk", () => {
    const presets = [
      { kind: "harian", hour: 7, minute: 0 },
      { kind: "hari-kerja", hour: 9, minute: 30 },
      { kind: "mingguan", hour: 8, minute: 5, weekday: 1 },
      { kind: "tiap-n-jam", everyHours: 6, minute: 0 },
    ] as const;
    for (const p of presets) expect(exprToPreset(presetToExpr(p))).toEqual(p);
  });
  it("expr lanjutan tak punya preset", () => {
    expect(exprToPreset("0,30 8-10 1,15 * *")).toBeNull();
    expect(exprToPreset("0 7 1 * *")).toBeNull();
  });
});

describe("describeCron", () => {
  it("menerjemahkan preset ke bahasa manusia, sisanya apa adanya", () => {
    expect(describeCron("0 7 * * *")).toBe("setiap hari 07:00");
    expect(describeCron("30 9 * * 1-5")).toBe("hari kerja 09:30");
    expect(describeCron("0 8 * * 1")).toBe("setiap Senin 08:00");
    expect(describeCron("0 */6 * * *")).toBe("tiap 6 jam (menit 0)");
    expect(describeCron("0,30 8-10 1,15 * *")).toBe("0,30 8-10 1,15 * *");
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-646
./node_modules/.bin/vitest --run shared/src/cron-expr.test.ts
```

Expected: FAIL — `Failed to resolve import "./cron-expr"`.

- [x] **Step 3: Tulis implementasinya**

Buat `shared/src/cron-expr.ts`:

```ts
// SPEC-646 · ADR-0112 — jadwal cron sebagai fungsi MURNI.
//
// Ia hidup di `shared` (bukan di server) karena dua pemakainya harus sepakat: server yang
// menghitung `nextRunAt` dan browser yang menampilkan preview "jalan berikutnya" sembari operator
// mengetik. Dua implementasi yang wajib sepakat adalah kelas bug "satu definisi, N call site"
// (SPEC-431/448/475/481) — di sini bahkan tanpa tipe yang memaksanya.
//
// Dependensi cron eksternal sengaja tak dipakai: yang dibutuhkan hanyalah subset 5-field, dan
// paket npm apa pun tak bisa dijamin memberi jawaban identik di kedua sisi.

export type CronSpec = {
  minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>;
  // Aturan Vixie: tanggal DAN hari-pekan sama-sama dibatasi → keduanya di-OR, bukan di-AND.
  // Karena itu "dibatasi" harus diingat dari TEKS field-nya; himpunan penuh tak bisa dibedakan
  // dari `*` sesudah di-expand.
  domRestricted: boolean; dowRestricted: boolean;
};

// dow menerima 7 (= Minggu, konvensi Vixie) lalu dinormalkan ke 0.
const BOUNDS: readonly (readonly [number, number])[] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function parseField(raw: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const slash = part.indexOf("/");
    const rangePart = slash === -1 ? part : part.slice(0, slash);
    const stepPart = slash === -1 ? undefined : part.slice(slash + 1);
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d{1,2}$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }
    let from: number; let to: number;
    if (rangePart === "*") { from = lo; to = hi; }
    else if (/^\d{1,2}$/.test(rangePart)) {
      from = Number(rangePart);
      to = stepPart === undefined ? from : hi;   // `5/2` berarti 5,7,9,… sampai batas atas
    } else {
      const m = /^(\d{1,2})-(\d{1,2})$/.exec(rangePart);
      if (!m) return null;
      from = Number(m[1]); to = Number(m[2]);
    }
    if (from < lo || to > hi || from > to) return null;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out.size ? out : null;
}

export function parseCron(expr: string): CronSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const [lo, hi] = BOUNDS[i]!;
    const s = parseField(parts[i]!, lo, hi);
    if (!s) return null;
    sets.push(s);
  }
  return {
    minute: sets[0]!, hour: sets[1]!, dom: sets[2]!, month: sets[3]!,
    dow: new Set([...sets[4]!].map((n) => (n === 7 ? 0 : n))),
    domRestricted: parts[2] !== "*", dowRestricted: parts[4] !== "*",
  };
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.month.has(d.getMonth() + 1)) return false;
  const dom = spec.dom.has(d.getDate());
  const dow = spec.dow.has(d.getDay());
  return spec.domRestricted && spec.dowRestricted ? dom || dow : dom && dow;
}

/**
 * Jatuh tempo pertama SESUDAH `after`, dalam zona waktu LOKAL.
 *
 * Kandidatnya dibangun `new Date(y, mo, d, h, mi)` — konstruktor komponen-lokal, bukan geseran
 * dari UTC. Itulah yang membuatnya aman DST: jam lokal yang tak ada (lompat maju) dinormalkan JS
 * ke depan dan tetap lolos gerbang `> after`, sementara jam ganda (mundur) memberi kemunculan
 * pertama sehingga jadwalnya jalan SEKALI. Menghitung dari komponen UTC lalu menggesernya justru
 * yang akan salah dua kali setahun.
 *
 * `limitDays` = 400 supaya jadwal setahun sekali (mis. `0 0 1 1 *`) tetap terjangkau, dan jadwal
 * yang mustahil (`0 0 30 2 *`) berhenti alih-alih beriterasi selamanya.
 */
export function nextRun(spec: CronSpec, after: Date, limitDays = 400): Date | null {
  const hours = [...spec.hour].sort((a, b) => a - b);
  const minutes = [...spec.minute].sort((a, b) => a - b);
  const t = after.getTime();
  for (let d = 0; d <= limitDays; d++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + d);
    if (!dayMatches(spec, day)) continue;
    for (const h of hours) {
      for (const mi of minutes) {
        const cand = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
        if (cand.getTime() > t) return cand;
      }
    }
  }
  return null;
}

export function nextRunFor(expr: string, after: Date): Date | null {
  const spec = parseCron(expr);
  return spec ? nextRun(spec, after) : null;
}

export type CronPreset =
  | { kind: "harian"; hour: number; minute: number }
  | { kind: "hari-kerja"; hour: number; minute: number }
  | { kind: "mingguan"; hour: number; minute: number; weekday: number }
  | { kind: "tiap-n-jam"; everyHours: number; minute: number };

export function presetToExpr(p: CronPreset): string {
  switch (p.kind) {
    case "harian": return `${p.minute} ${p.hour} * * *`;
    case "hari-kerja": return `${p.minute} ${p.hour} * * 1-5`;
    case "mingguan": return `${p.minute} ${p.hour} * * ${p.weekday}`;
    case "tiap-n-jam": return `${p.minute} */${p.everyHours} * * *`;
  }
}

/**
 * Kebalikan `presetToExpr`, dan sengaja KETAT: hanya bentuk yang persis dihasilkannya yang
 * dikenali. Menyimpan preset sebagai kolom kedua di samping `expr` akan melahirkan drift yang tak
 * punya arbiter — jadi preset selalu diturunkan, dan apa pun di luar keempat bentuk itu jatuh ke
 * kolom cron expression lanjutan.
 */
export function exprToPreset(expr: string): CronPreset | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [mi, h, dom, mo, dow] = p as [string, string, string, string, string];
  if (dom !== "*" || mo !== "*") return null;
  if (!/^\d{1,2}$/.test(mi)) return null;
  const minute = Number(mi);
  if (minute > 59) return null;
  const every = /^\*\/(\d{1,2})$/.exec(h);
  if (every) {
    if (dow !== "*") return null;
    const everyHours = Number(every[1]);
    return everyHours >= 1 && everyHours <= 23 ? { kind: "tiap-n-jam", everyHours, minute } : null;
  }
  if (!/^\d{1,2}$/.test(h)) return null;
  const hour = Number(h);
  if (hour > 23) return null;
  if (dow === "*") return { kind: "harian", hour, minute };
  if (dow === "1-5") return { kind: "hari-kerja", hour, minute };
  if (/^[0-6]$/.test(dow)) return { kind: "mingguan", hour, minute, weekday: Number(dow) };
  return null;
}

export const WEEKDAY_LABELS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export function describeCron(expr: string): string {
  const p = exprToPreset(expr);
  if (!p) return expr.trim();
  switch (p.kind) {
    case "harian": return `setiap hari ${hhmm(p.hour, p.minute)}`;
    case "hari-kerja": return `hari kerja ${hhmm(p.hour, p.minute)}`;
    case "mingguan": return `setiap ${WEEKDAY_LABELS[p.weekday]} ${hhmm(p.hour, p.minute)}`;
    case "tiap-n-jam": return `tiap ${p.everyHours} jam (menit ${p.minute})`;
  }
}
```

Tambahkan ke `shared/src/index.ts`, tepat sesudah baris `export * from "./changelog";`:

```ts
export * from "./cron-expr";
```

- [x] **Step 4: Jalankan test sampai hijau**

```bash
./node_modules/.bin/vitest --run shared/src/cron-expr.test.ts
```

Expected: PASS, seluruh test di berkas itu.

- [x] **Step 5: Commit**

```bash
git add shared/src/cron-expr.ts shared/src/cron-expr.test.ts shared/src/index.ts
git commit -m "feat(spec-646): modul jadwal cron murni di shared"
```

---

### Task 2: Skema + migration + `PG_ORDER`

**Files:**
- Modify: `server/prisma/schema.prisma` (sisipkan sesudah model `SchedulerQueueItem`)
- Create: `server/prisma/migrations/20260811000000_scheduler_cron/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts` (konstanta `PG_ORDER`)

**Interfaces:**
- Consumes: tak ada.
- Produces: model Prisma `SchedulerCron` & `SchedulerCronRun` → `prisma.schedulerCron` / `prisma.schedulerCronRun`.

- [x] **Step 1: Jalankan test gerbang untuk melihatnya HIJAU dulu (baseline)**

```bash
./node_modules/.bin/vitest --run cli/test/migrate-pg.test.ts -t "PG_ORDER"
```

Expected: PASS (2 test). Ini baseline: sesudah model ditambahkan tanpa memperbarui `PG_ORDER`, test yang sama harus MERAH — itulah gerbangnya.

- [x] **Step 2: Tambahkan model ke `schema.prisma`**

Sisipkan tepat sesudah blok `model SchedulerQueueItem { … }` (berakhir di sekitar baris 440):

```prisma
// SPEC-646 · ADR-0112 · cronjob per project. LOCAL-ONLY (cermin SchedulerQueueItem): jadwal adalah
// properti MESIN INI — worktree, tmux, dan cap concurrency-nya lokal. Tak masuk whitelist FIELDS
// sync, tanpa kolom `version`.
model SchedulerCron {
  id        String    @id @default(cuid())
  projectId String
  name      String
  expr      String    // cron 5-field, dievaluasi di zona waktu LOKAL SERVER
  prompt    String
  // null = warisi default sesi (terminalAgentDefaults). Sengaja BUKAN blok zAgentEngine: blok itu
  // membawa `enabled` sendiri, dan dua boolean bernama sama di satu bentuk adalah jebakan.
  agent     String?
  model     String?
  effort    String?
  enabled   Boolean   @default(false)   // default aman: cron baru lahir nonaktif
  nextRunAt DateTime?                   // jadwal berikutnya, durable lintas restart
  lastRunAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([projectId])
  @@index([enabled])
}

// SPEC-646 · satu baris = satu JATUH TEMPO yang diklaim. `@@unique([cronId, dueAt])` adalah kunci
// idempotensinya: tick berulang, dua tick yang balapan, maupun restart di tengah tak bisa
// melahirkan baris kedua untuk jatuh tempo yang sama (insert kedua kena P2002, diabaikan).
// Tabel ini merangkap ANTREAN dan RIWAYAT — pola WebhookDelivery (ADR-0100).
model SchedulerCronRun {
  id        String    @id @default(cuid())
  cronId    String
  projectId String
  dueAt     DateTime
  startedAt DateTime?
  status    String    @default("queued")   // queued | launched | skipped | failed
  sessionId String?
  note      String?                        // alasan skipped/failed
  manual    Boolean   @default(false)      // dari tombol "Jalankan sekarang"
  createdAt DateTime  @default(now())

  @@unique([cronId, dueAt])
  @@index([cronId, dueAt])
  @@index([status])
}
```

- [x] **Step 3: Tulis migration SQL**

Buat `server/prisma/migrations/20260811000000_scheduler_cron/migration.sql`:

```sql
-- SPEC-646 · ADR-0112 · cronjob per project (LOCAL-ONLY, aditif murni).
CREATE TABLE "SchedulerCron" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expr" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "agent" TEXT,
    "model" TEXT,
    "effort" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "SchedulerCron_projectId_idx" ON "SchedulerCron"("projectId");
CREATE INDEX "SchedulerCron_enabled_idx" ON "SchedulerCron"("enabled");

CREATE TABLE "SchedulerCronRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cronId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sessionId" TEXT,
    "note" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SchedulerCronRun_cronId_dueAt_key" ON "SchedulerCronRun"("cronId", "dueAt");
CREATE INDEX "SchedulerCronRun_cronId_dueAt_idx" ON "SchedulerCronRun"("cronId", "dueAt");
CREATE INDEX "SchedulerCronRun_status_idx" ON "SchedulerCronRun"("status");
```

- [x] **Step 4: Generate klien Prisma & pastikan gerbang `PG_ORDER` MERAH**

```bash
./node_modules/.bin/prisma generate --schema server/prisma/schema.prisma
./node_modules/.bin/vitest --run cli/test/migrate-pg.test.ts -t "PG_ORDER"
```

Expected: FAIL pada "memuat setiap model Prisma tepat sekali" — `SchedulerCron`/`SchedulerCronRun` ada di DMMF tapi tak ada di `PG_ORDER`.

- [x] **Step 5: Perbarui `PG_ORDER`**

Di `cli/src/commands/migrate-pg.ts`, ganti baris

```ts
  "SchedulerQueueItem", "RuntimeConfig", "LeadFlow", "LeadDecision",
```

menjadi

```ts
  // SPEC-646 · ADR-0112 · SchedulerCron SEBELUM SchedulerCronRun: `cronId` menunjuk ke sana.
  // Tanpa FK (cermin SchedulerQueueItem/LeadDecision), tapi urutan tabel tetap harus mencerminkan
  // arah tautannya bagi pembaca berikutnya.
  "SchedulerQueueItem", "SchedulerCron", "SchedulerCronRun",
  "RuntimeConfig", "LeadFlow", "LeadDecision",
```

- [x] **Step 6: Jalankan gerbang sampai hijau**

```bash
./node_modules/.bin/vitest --run cli/test/migrate-pg.test.ts
```

Expected: PASS seluruhnya.

- [x] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260811000000_scheduler_cron cli/src/commands/migrate-pg.ts
git commit -m "feat(spec-646): skema SchedulerCron + SchedulerCronRun (LOCAL-only)"
```

---

### Task 3: Kontrak `shared` (DTO + path API)

**Files:**
- Modify: `shared/src/dto.ts` (tambah di akhir berkas)
- Modify: `shared/src/api.ts` (blok scheduler, sesudah `schedulerQueue`)

**Interfaces:**
- Consumes: `parseCron` dari Task 1.
- Produces:
  - `zCreateCron`, `zPatchCron`
  - `zSchedulerCron` → `type SchedulerCronView = { id, projectId, name, expr, prompt, agent, model, effort, enabled, nextRunAt, lastRunAt, createdAt }`
  - `zSchedulerCronRun` → `type SchedulerCronRunView = { id, cronId, projectId, dueAt, startedAt, status, sessionId, note, manual, createdAt }`
  - `paths.schedulerCrons`, `paths.schedulerCron(id)`, `paths.schedulerCronRunNow(id)`, `paths.schedulerCronRuns(id)`

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/cron-dto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zCreateCron, zPatchCron } from "./dto";
import { paths } from "./api";

describe("zCreateCron", () => {
  const ok = { project: "p1", name: "Cek error pagi", expr: "0 7 * * *", prompt: "Periksa error produksi." };
  it("menerima bentuk minimal dan default enabled=false", () => {
    const r = zCreateCron.parse(ok);
    expect(r.enabled).toBe(false);
    expect(r.agent).toBeUndefined();
  });
  it("menolak expr yang tak bisa diparse", () => {
    expect(zCreateCron.safeParse({ ...ok, expr: "0 99 * * *" }).success).toBe(false);
    expect(zCreateCron.safeParse({ ...ok, expr: "tiap pagi" }).success).toBe(false);
  });
  it("menolak prompt & nama kosong", () => {
    expect(zCreateCron.safeParse({ ...ok, prompt: "   " }).success).toBe(false);
    expect(zCreateCron.safeParse({ ...ok, name: "" }).success).toBe(false);
  });
  it("menerima knob sesi opsional", () => {
    const r = zCreateCron.parse({ ...ok, agent: "codex", model: "gpt-5.6-sol", effort: "high" });
    expect(r.agent).toBe("codex");
  });
});

describe("zPatchCron", () => {
  it("semuanya opsional; body kosong sah", () => {
    expect(zPatchCron.parse({})).toEqual({});
  });
  it("expr tetap divalidasi bila disebut", () => {
    expect(zPatchCron.safeParse({ expr: "0 7 * * *" }).success).toBe(true);
    expect(zPatchCron.safeParse({ expr: "* * *" }).success).toBe(false);
  });
  it("agent null mengosongkan (kembali ke warisan)", () => {
    expect(zPatchCron.parse({ agent: null }).agent).toBeNull();
  });
});

describe("paths cron", () => {
  it("hidup di bawah prefix /scheduler", () => {
    expect(paths.schedulerCrons).toBe("/api/scheduler/crons");
    expect(paths.schedulerCron("c1")).toBe("/api/scheduler/crons/c1");
    expect(paths.schedulerCronRunNow("c1")).toBe("/api/scheduler/crons/c1/run");
    expect(paths.schedulerCronRuns("c1")).toBe("/api/scheduler/crons/c1/runs");
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
./node_modules/.bin/vitest --run shared/src/cron-dto.test.ts
```

Expected: FAIL — `zCreateCron` tak diekspor.

- [x] **Step 3: Tulis implementasinya**

Di `shared/src/dto.ts`, tambahkan `import { parseCron } from "./cron-expr";` ke blok import teratas, lalu tempelkan di akhir berkas:

```ts
// SPEC-646 · ADR-0112 · cronjob per project. `expr` divalidasi lewat parser yang SAMA dengan yang
// menghitung jadwalnya (`parseCron`) — validasi yang memakai regex terpisah akan menerima expr
// yang kemudian tak pernah punya jatuh tempo, dan cron itu diam selamanya tanpa satu pun error.
const zCronExpr = z.string().trim().refine((v) => parseCron(v) !== null, "cron expression tak sah");
const zCronAgent = zAgent;

export const zCreateCron = z.object({
  project: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  expr: zCronExpr,
  prompt: z.string().trim().min(1).max(8000),
  agent: zCronAgent.optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  enabled: z.boolean().default(false),   // default aman: cron baru lahir nonaktif
});

// `null` = kosongkan (kembali ke warisan default sesi); `undefined` = jangan sentuh. Bedanya
// bermakna di ketiga knob sesi — cermin `branchFrom` di zPatchSpec.
export const zPatchCron = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  expr: zCronExpr.optional(),
  prompt: z.string().trim().min(1).max(8000).optional(),
  agent: zCronAgent.nullable().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const zSchedulerCron = z.object({
  id: z.string(), projectId: z.string(), name: z.string(), expr: z.string(), prompt: z.string(),
  agent: z.string().nullable(), model: z.string().nullable(), effort: z.string().nullable(),
  enabled: z.boolean(),
  nextRunAt: z.string().nullable(), lastRunAt: z.string().nullable(), createdAt: z.string(),
});
export type SchedulerCronView = z.infer<typeof zSchedulerCron>;

export const zSchedulerCronRun = z.object({
  id: z.string(), cronId: z.string(), projectId: z.string(),
  dueAt: z.string(), startedAt: z.string().nullable(),
  status: z.string(), sessionId: z.string().nullable(), note: z.string().nullable(),
  manual: z.boolean(), createdAt: z.string(),
});
export type SchedulerCronRunView = z.infer<typeof zSchedulerCronRun>;
```

Di `shared/src/api.ts`, tepat sesudah baris `schedulerQueue: \`${API}/scheduler/queue\`,` tambahkan:

```ts
  // SPEC-646 · ADR-0112 · cronjob per project. Di bawah prefix `scheduler` seperti tetangganya,
  // TAPI capability-nya bukan turunan otomatis: `capabilityForRoute` memberi `crons` cabang
  // COOKIE_ONLY sendiri — sebuah cron adalah `POST /terminal/sessions` yang ditunda.
  schedulerCrons: `${API}/scheduler/crons`,
  schedulerCron: (id: string) => `${API}/scheduler/crons/${encodeURIComponent(id)}`,
  schedulerCronRunNow: (id: string) => `${API}/scheduler/crons/${encodeURIComponent(id)}/run`,
  schedulerCronRuns: (id: string) => `${API}/scheduler/crons/${encodeURIComponent(id)}/runs`,
```

- [x] **Step 4: Jalankan test sampai hijau**

```bash
./node_modules/.bin/vitest --run shared/src/cron-dto.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts shared/src/cron-dto.test.ts
git commit -m "feat(spec-646): kontrak DTO & path API cronjob"
```

---

### Task 4: Layanan cron — query, sweep jatuh tempo, notifikasi

**Files:**
- Create: `server/src/services/scheduler/cron.ts`
- Create: `server/test/scheduler-cron-sweep.test.ts`
- Modify: `server/src/services/notifications.ts`

**Interfaces:**
- Consumes: `parseCron`/`nextRun` (Task 1), `prisma.schedulerCron`/`prisma.schedulerCronRun` (Task 2).
- Produces:
  - `GRACE_MS: number` (= `30 * 60_000`)
  - `computeNextRun(expr: string, after: Date): Date | null`
  - `sweepCronDue(now: number): Promise<void>`
  - `queuedCronRuns(): Promise<SchedulerCronRun[]>`
  - `markCronLaunched(id: string, sessionId: string): Promise<boolean>`
  - `markCronFailed(id: string, note: string): Promise<void>`
  - `markCronSkipped(id: string, note: string): Promise<void>`
  - `noteCronRun(id: string, note: string): Promise<void>`
  - `listCronRunsPage(cronId, f): Promise<{ items; total; page; pageSize }>`
  - `recordCronRun(cronId, cronName, projectId, dueAt, status, note)` (di `notifications.ts`)

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/scheduler-cron-sweep.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { sweepCronDue, GRACE_MS, queuedCronRuns } from "../src/services/scheduler/cron";
import { setScheduler } from "../src/services/scheduler/config";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = async () => {
  await prisma.schedulerCronRun.deleteMany();
  await prisma.schedulerCron.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => { await clean(); await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: true }); });
afterAll(clean);

const mkCron = (over: Record<string, unknown> = {}) => prisma.schedulerCron.create({
  data: {
    projectId: "p1", name: "Cek pagi", expr: "0 7 * * *", prompt: "Periksa error.",
    enabled: true, nextRunAt: new Date(2026, 7, 11, 7, 0), ...over,
  },
});

describe("sweepCronDue", () => {
  it("materialisasi SATU baris queued saat jatuh tempo dalam grace", async () => {
    const c = await mkCron();
    await sweepCronDue(new Date(2026, 7, 11, 7, 0, 30).getTime());
    const runs = await prisma.schedulerCronRun.findMany({ where: { cronId: c.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("queued");
    expect(runs[0]!.dueAt.getTime()).toBe(new Date(2026, 7, 11, 7, 0).getTime());
  });

  it("tick berulang tak menduplikasi baris untuk jatuh tempo yang sama", async () => {
    const c = await mkCron();
    const t = new Date(2026, 7, 11, 7, 0, 30).getTime();
    await sweepCronDue(t);
    // Paksa nextRunAt mundur lagi seolah tulisan sebelumnya gagal — kunci idempotensinya harus
    // baris run, bukan kolom nextRunAt.
    await prisma.schedulerCron.update({ where: { id: c.id }, data: { nextRunAt: new Date(2026, 7, 11, 7, 0) } });
    await sweepCronDue(t + 1000);
    expect(await prisma.schedulerCronRun.count({ where: { cronId: c.id } })).toBe(1);
  });

  // DEVIASI dari draf plan (dikoreksi saat Execute): draf ini semula satu test yang mengharapkan
  // `skipped` pada now=08:05, padahal 08:05 masih DI DALAM grace terhadap jatuh tempo 08:00 —
  // menjalankannya justru perilaku yang benar. "Tertunggak" tak sama dengan "terlambat": yang
  // dilarang adalah BURST, sementara jatuh tempo TERBARU tetap dinilai dengan grace yang sama.
  it("jatuh tempo tertunggak: 21 yang lewat jadi SATU baris, bukan burst", async () => {
    const c = await mkCron({ expr: "0 * * * *", nextRunAt: new Date(2026, 7, 10, 12, 0) });
    await sweepCronDue(new Date(2026, 7, 11, 8, 5).getTime());
    const runs = await prisma.schedulerCronRun.findMany({ where: { cronId: c.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("queued");
    expect(runs[0]!.dueAt.getTime()).toBe(new Date(2026, 7, 11, 8, 0).getTime());
  });

  it("jatuh tempo terbaru di LUAR grace → satu baris skipped ber-alasan terlewat", async () => {
    const c = await mkCron({ expr: "0 * * * *", nextRunAt: new Date(2026, 7, 10, 12, 0) });
    await sweepCronDue(new Date(2026, 7, 11, 8, 45).getTime());
    const runs = await prisma.schedulerCronRun.findMany({ where: { cronId: c.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("skipped");
    expect(runs[0]!.note).toContain("terlewat 20 jatuh tempo");
    expect(runs[0]!.dueAt.getTime()).toBe(new Date(2026, 7, 11, 8, 0).getTime());
  });

  it("baris queued yang lewat grace jadi skipped membawa note terakhirnya", async () => {
    const c = await mkCron();
    await prisma.schedulerCronRun.create({
      data: { cronId: c.id, projectId: "p1", dueAt: new Date(2026, 7, 11, 7, 0), note: "cap penuh" },
    });
    await sweepCronDue(new Date(2026, 7, 11, 7, 0).getTime() + GRACE_MS + 60_000);
    const run = await prisma.schedulerCronRun.findFirst({ where: { cronId: c.id } });
    expect(run!.status).toBe("skipped");
    expect(run!.note).toContain("cap penuh");
  });

  it("cron nonaktif tak pernah dimaterialisasi", async () => {
    const c = await mkCron({ enabled: false });
    await sweepCronDue(new Date(2026, 7, 11, 7, 0, 30).getTime());
    expect(await prisma.schedulerCronRun.count({ where: { cronId: c.id } })).toBe(0);
  });

  it("baris terminal menerbitkan notifikasi ber-key stabil (tak dobel)", async () => {
    const c = await mkCron({ expr: "0 * * * *", nextRunAt: new Date(2026, 7, 10, 12, 0) });
    const t = new Date(2026, 7, 11, 8, 45).getTime();
    await sweepCronDue(t);
    await sweepCronDue(t + 1000);
    const notifs = await prisma.notification.findMany({ where: { type: "cron" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.key).toContain(c.id);
  });

  it("nextRunAt selalu bergerak MAJU melewati now", async () => {
    const c = await mkCron();
    const t = new Date(2026, 7, 11, 7, 0, 30).getTime();
    await sweepCronDue(t);
    const after = await prisma.schedulerCron.findUnique({ where: { id: c.id } });
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(t);
  });

  it("queuedCronRuns mengembalikan baris queued urut jatuh tempo", async () => {
    const c = await mkCron({ enabled: false });
    for (const h of [9, 7, 8]) {
      await prisma.schedulerCronRun.create({ data: { cronId: c.id, projectId: "p1", dueAt: new Date(2026, 7, 11, h, 0) } });
    }
    expect((await queuedCronRuns()).map((r) => r.dueAt.getHours())).toEqual([7, 8, 9]);
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism server/test/scheduler-cron-sweep.test.ts
```

Expected: FAIL — `services/scheduler/cron` tak ada.

- [x] **Step 3: Tulis `recordCronRun` di `notifications.ts`**

Tambahkan di akhir `server/src/services/notifications.ts`, sebelum `export function __resetAwaiting`:

```ts
// SPEC-646 · ADR-0112 · hasil satu eksekusi cron. `key` diturunkan dari (cronId, dueAt) — stempel
// yang STABIL lintas restart, jadi tick berulang tak bisa menduplikasinya (P2002 diabaikan, pola
// recordCompletion). `skipped` ikut dinotifikasi dengan sengaja: "cek pagi tak jalan karena cap
// penuh" justru yang paling perlu dibaca operator, dan diam adalah kegagalan yang tak terlihat.
export async function recordCronRun(
  cronId: string, cronName: string, projectId: string, dueAt: Date,
  status: "launched" | "skipped" | "failed", note: string | null,
): Promise<void> {
  const verb = status === "launched" ? "berjalan" : status === "skipped" ? "dilewati" : "gagal";
  const title = `Cron "${cronName}" ${verb}${note ? ` — ${note}` : ""}`;
  await prisma.notification.create({
    data: { type: "cron", key: `cron:${cronId}:${dueAt.toISOString()}`, title, projectId },
  }).catch(() => { /* P2002: sudah ada untuk jatuh tempo ini */ });
}
```

- [x] **Step 4: Tulis `server/src/services/scheduler/cron.ts`**

```ts
import { prisma } from "../../db";
import type { SchedulerCron, SchedulerCronRun } from "@prisma/client";
import { parseCron, nextRun } from "@hanoman/shared";
import { recordCronRun } from "../notifications";

// SPEC-646 · ADR-0112 · seberapa terlambat sebuah jatuh tempo masih boleh dijalankan. Ia menjawab
// DUA pertanyaan sekaligus dengan satu angka, dan itu disengaja: "server mati saat jatuh tempo"
// dan "cap penuh saat jatuh tempo" adalah keterlambatan yang sama dari sudut pandang operator —
// jadwal pukul 07:00 kehilangan maknanya bila berjalan pukul 09:00, apa pun sebabnya.
export const GRACE_MS = 30 * 60_000;

export function computeNextRun(expr: string, after: Date): Date | null {
  const spec = parseCron(expr);
  return spec ? nextRun(spec, after) : null;
}

// Jatuh tempo TERBARU yang ≤ now, berikut jumlah yang dilompati. Inilah yang membuat "jangan
// menembak burst run tertunggak setelah restart" jadi sifat struktural alih-alih niat baik:
// jatuh tempo yang dilompati tak pernah menjadi baris antrean, ia menjadi angka di dalam alasan
// SATU baris `skipped`.
function latestDue(expr: string, from: Date, now: number): { due: Date; missed: number } | null {
  let cursor = from;
  let due: Date | null = null;
  let missed = -1;
  // Batas iterasi menjaga cron bermenit (`* * * * *`) yang tertinggal berbulan-bulan tak
  // menggantung tick: sesudah batasnya, yang tercatat tetap jatuh tempo terakhir yang terhitung.
  for (let i = 0; i < 20_000; i++) {
    const nxt = computeNextRun(expr, cursor);
    if (!nxt || nxt.getTime() > now) break;
    due = nxt; missed++; cursor = nxt;
  }
  return due ? { due, missed: Math.max(0, missed) } : null;
}

/**
 * Materialisasi jatuh tempo → baris `SchedulerCronRun`, lalu kedaluwarsakan baris yang menua.
 *
 * Dipanggil tiap tick SEBELUM gerbang `paused`, dan itu disengaja: Pause adalah rem PELUNCURAN,
 * bukan penghapus antrean (ADR-0072 keputusan 4). Jatuh tempo yang lewat selama jeda tetap
 * tercatat, dan melanjutkan jeda dalam grace tetap menjalankannya.
 */
export async function sweepCronDue(now: number): Promise<void> {
  const nowDate = new Date(now);
  const crons = await prisma.schedulerCron.findMany({
    where: { enabled: true, nextRunAt: { lte: nowDate } },
  });
  for (const cron of crons) await materialize(cron, now);
  await expireStale(now);
}

async function materialize(cron: SchedulerCron, now: number): Promise<void> {
  // `nextRunAt` yang kosong (cron baru diaktifkan tanpa jadwal terhitung) tak pernah lolos filter
  // di atas; yang tersisa cuma nilai nyata.
  const from = new Date(cron.nextRunAt!.getTime() - 1);
  const hit = latestDue(cron.expr, from, now);
  // Selalu majukan `nextRunAt` walau tak ada jatuh tempo yang terklaim — expr yang jadwalnya sudah
  // habis (mis. tanggal yang tak pernah ada) tak boleh membuat cron ini dipungut tiap tick.
  const next = computeNextRun(cron.expr, new Date(now));
  await prisma.schedulerCron.update({ where: { id: cron.id }, data: { nextRunAt: next } });
  if (!hit) return;

  const late = now - hit.due.getTime() > GRACE_MS;
  const missedNote = hit.missed > 0
    ? `terlewat ${hit.missed} jatuh tempo — scheduler tak berjalan`
    : "terlewat — scheduler tak berjalan saat jatuh tempo";
  try {
    await prisma.schedulerCronRun.create({
      data: {
        cronId: cron.id, projectId: cron.projectId, dueAt: hit.due,
        ...(late ? { status: "skipped", note: missedNote } : {}),
      },
    });
  } catch {
    return;   // P2002: jatuh tempo ini sudah pernah diklaim — justru kunci idempotensinya
  }
  if (late) await recordCronRun(cron.id, cron.name, cron.projectId, hit.due, "skipped", missedNote);
}

// Baris `queued` yang tak terluncurkan sampai grace habis ditutup sebagai `skipped`, membawa
// alasan TERAKHIR yang menghalanginya (mis. "cap penuh"). Tanpa ini sebuah jatuh tempo pukul 07:00
// bisa diam-diam berjalan pukul 15:00 begitu slot kosong — persis yang membuat jadwal jam tertentu
// kehilangan maknanya.
async function expireStale(now: number): Promise<void> {
  const cutoff = new Date(now - GRACE_MS);
  const stale = await prisma.schedulerCronRun.findMany({
    where: { status: "queued", dueAt: { lt: cutoff } },
  });
  for (const run of stale) {
    const note = run.note ?? "tak terluncurkan sampai batas keterlambatan";
    await prisma.schedulerCronRun.update({ where: { id: run.id }, data: { status: "skipped", note } });
    const cron = await prisma.schedulerCron.findUnique({ where: { id: run.cronId } });
    await recordCronRun(run.cronId, cron?.name ?? run.cronId, run.projectId, run.dueAt, "skipped", note);
  }
}

// Urut jatuh tempo (FIFO waktu), bukan prioritas: cron tak punya prioritas, dan yang paling lama
// menunggu adalah yang paling dekat kedaluwarsa.
export function queuedCronRuns(): Promise<SchedulerCronRun[]> {
  return prisma.schedulerCronRun.findMany({ where: { status: "queued" }, orderBy: { dueAt: "asc" } });
}

// CAS seperti `markLaunched` antrean spec: operator bisa menonaktifkan/menghapus cron SELAGI
// sesinya lahir, dan `update` polos akan menimpa keadaan itu diam-diam.
export async function markCronLaunched(id: string, sessionId: string): Promise<boolean> {
  const { count } = await prisma.schedulerCronRun.updateMany({
    where: { id, status: "queued" },
    data: { status: "launched", sessionId, startedAt: new Date(), note: null },
  });
  return count > 0;
}
export async function markCronFailed(id: string, note: string): Promise<void> {
  await prisma.schedulerCronRun.updateMany({ where: { id, status: "queued" }, data: { status: "failed", note } });
}
export async function markCronSkipped(id: string, note: string): Promise<void> {
  await prisma.schedulerCronRun.updateMany({ where: { id, status: "queued" }, data: { status: "skipped", note } });
}
// Ditulis HANYA saat berubah: tick berdenyut tiap 10 detik, dan menulis note identik tiap tick
// berarti ribuan write/hari untuk informasi yang sama (cermin `noteRow` antrean spec).
export async function noteCronRun(id: string, note: string): Promise<void> {
  const row = await prisma.schedulerCronRun.findUnique({ where: { id }, select: { note: true } });
  if (row?.note === note) return;
  await prisma.schedulerCronRun.updateMany({ where: { id, status: "queued" }, data: { note } });
}

export async function listCronRunsPage(cronId: string, f: { page?: string; limit?: string } = {}):
  Promise<{ items: SchedulerCronRun[]; total: number; page: number; pageSize: number }> {
  const where = { cronId };
  const total = await prisma.schedulerCronRun.count({ where });
  const pageSize = f.limit ? Math.max(1, Math.floor(+f.limit) || 1) : (total || 1);
  const page = f.page ? Math.max(1, Math.floor(+f.page) || 1) : 1;
  const items = await prisma.schedulerCronRun.findMany({
    where, orderBy: { dueAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
  });
  return { items, total, page, pageSize };
}
```

- [x] **Step 5: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism server/test/scheduler-cron-sweep.test.ts
```

Expected: PASS, 9 test.

- [x] **Step 6: Commit**

```bash
git add server/src/services/scheduler/cron.ts server/src/services/notifications.ts server/test/scheduler-cron-sweep.test.ts
git commit -m "feat(spec-646): sweep jatuh tempo cron + notifikasi per eksekusi"
```

---

### Task 5: Prompt cron + peluncuran sesi

**Files:**
- Modify: `runner/src/prompt.ts` (tambah di akhir berkas)
- Create: `runner/test/cron-prompt.test.ts`
- Create: `server/src/services/scheduler/cron-session.ts`

**Interfaces:**
- Consumes: `ProjectBrief` (`runner/src/types`), `terminalAgentDefaults` (`server/src/services/settings`), `createSession`/`getSession` (`server/src/services/pty`), `resolveRepoDir`, `ensureCodexTrust`, `realGit`.
- Produces:
  - `cronPrompt(project: ProjectBrief, cron: { name: string; prompt: string }): string` (runner)
  - `cronSessionId(cronId: string): string` (server)
  - `startCronSession(cron: { id: string; projectId: string; name: string; prompt: string; agent: string | null; model: string | null; effort: string | null }): Promise<{ id: string }>` (server)

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/cron-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cronPrompt } from "../src/prompt";
import { CODE_STYLE_CLAUSE } from "../src/code-style";

const project = { id: "p1", name: "Nafanesia", desc: "CRM", stack: "TS" };

describe("cronPrompt", () => {
  it("memuat instruksi operator APA ADANYA", () => {
    const p = cronPrompt(project, { name: "Cek pagi", prompt: "Periksa error produksi 24 jam terakhir." });
    expect(p).toContain("Periksa error produksi 24 jam terakhir.");
  });
  it("menyebut nama cron dan project", () => {
    const p = cronPrompt(project, { name: "Cek pagi", prompt: "x" });
    expect(p).toContain("Cek pagi");
    expect(p).toContain("p1");
  });
  it("mengarahkan temuan ke backlog lewat POST /api/specs", () => {
    const p = cronPrompt(project, { name: "c", prompt: "x" });
    expect(p).toContain("POST /api/specs");
  });
  it("membawa klausa gaya kode (ADR-0108)", () => {
    expect(cronPrompt(project, { name: "c", prompt: "x" })).toContain(CODE_STYLE_CLAUSE);
  });
  it("menyebut worktree detached supaya agen tak bingung", () => {
    expect(cronPrompt(project, { name: "c", prompt: "x" })).toContain("detached HEAD");
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
./node_modules/.bin/vitest --run runner/test/cron-prompt.test.ts
```

Expected: FAIL — `cronPrompt` tak diekspor.

- [x] **Step 3: Tulis `cronPrompt` di `runner/src/prompt.ts`**

Tambahkan di akhir berkas:

```ts
// SPEC-646 · ADR-0112 · sesi cron. TANPA `flow`: ia tak punya fase, tak punya plan berkotak, dan
// tak menggerakkan stage backlog mana pun — yang dikerjakannya adalah pemeriksaan rutin, dan
// temuannya masuk antrean kerja sebagai backlog BARU, bukan sebagai commit di sesi ini.
//
// Instruksi operator disisipkan APA ADANYA. Memparafrasekannya berarti hanoman ikut menentukan apa
// yang diperiksa, dan itu persis yang tak boleh: kolom prompt adalah kontraknya dengan operator.
//
// CODE_STYLE_CLAUSE dipasang tanpa gerbang `writesCode` — sesi cron tak punya `Flow` untuk
// digerbangi, dan klausanya menggerbangi dirinya sendiri di baris pertama ("berlaku setiap kali
// kamu menulis atau mengubah kode", ADR-0108).
export function cronPrompt(project: ProjectBrief, cron: { name: string; prompt: string }): string {
  return [
    `hanoman cron "${cron.name}". Pemeriksaan rutin terjadwal di project ini — bukan sesi backlog: `
      + `tak ada fase, tak ada plan, tak ada stage yang harus digerakkan.`,
    `Bila kamu menemukan masalah yang layak dikerjakan, FILEKAN sebagai backlog item lewat `
      + `\`POST /api/specs\` (lihat docs/agent-integration.md untuk bentuk payload & auth), jangan `
      + `hanya melaporkannya ke terminal — temuan yang cuma tertulis di log sesi akan hilang. `
      + `Satu masalah = satu backlog item, judul spesifik.`,
    `Jangan mengerjakan sendiri perbaikan besar dalam sesi ini kecuali instruksi di bawah memintanya.`,
    CODE_STYLE_CLAUSE,
    `Worktree ini detached HEAD — memang disengaja. Bila kamu memang perlu meninggalkan perubahan `
      + `berkas, commit dan katakan itu di ringkasan akhir; jangan gagal diam-diam.`,
    `Project ${project.id} · ${project.name}\nDeskripsi: ${project.desc || "—"}\nStack: ${project.stack || "—"}`,
    `=== INSTRUKSI OPERATOR ===\n${cron.prompt}`,
  ].join("\n\n");
}
```

- [x] **Step 4: Jalankan test sampai hijau**

```bash
./node_modules/.bin/vitest --run runner/test/cron-prompt.test.ts
```

Expected: PASS, 5 test.

- [x] **Step 5: Tulis `server/src/services/scheduler/cron-session.ts`**

```ts
import { prisma } from "../../db";
import { realGit, cronPrompt } from "@hanoman/runner";
import type { Agent } from "@hanoman/shared";
import { resolveRepoDir } from "../local-binding";
import { terminalAgentDefaults } from "../settings";
import { ensureCodexTrust } from "../codex-trust";
import { createSession, getSession } from "../pty";

export type CronLaunchInput = {
  id: string; projectId: string; name: string; prompt: string;
  agent: string | null; model: string | null; effort: string | null;
};

// SPEC-646 · ADR-0112 · id sesi DETERMINISTIK per cron. Ia bukan kenyamanan penamaan melainkan
// mekanisme "satu sesi per unit kerja" (ADR-0015) itu sendiri: pane `cron-<id>` yang masih hidup
// adalah satu-satunya bukti yang dibutuhkan, dan bukti itu selamat dari restart server tanpa satu
// pun kolom yang bisa basi.
export const cronSessionId = (cronId: string) => `cron-${cronId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;

/** Sesi cron sudah berjalan? Mengembalikan id pane hidup, atau null. */
export function liveCronSession(cronId: string): string | null {
  const s = getSession(cronSessionId(cronId));
  return s && !s.exited ? s.id : null;
}

/**
 * Lahirkan sesi cron di worktree isolasi project. Cermin cabang `reverse` di `routes/terminal.ts`:
 * project-level, tanpa `flow`, worktree lahir dari HEAD dan DIPAKAI ULANG bila masih sah
 * (SPEC-394 — `addWorktree` selalu merebut path lebih dulu, dan itu fatal untuk pekerjaan yang
 * belum sempat di-commit).
 *
 * Melempar bila project belum di-bind atau worktree gagal lahir; pemanggil (governor) yang
 * menandai barisnya `failed` beserta pesannya.
 */
export async function startCronSession(cron: CronLaunchInput): Promise<{ id: string }> {
  const repoDir = await resolveRepoDir(cron.projectId);
  if (!repoDir) throw new Error(`project "${cron.projectId}" belum di-bind ke checkout lokal`);
  const project = await prisma.project.findUnique({ where: { id: cron.projectId } });
  if (!project) throw new Error(`project "${cron.projectId}" tak ada`);

  // SPEC-517 · resolver yang SAMA dengan form "Sesi baru": knob cron tak boleh bisa berselisih
  // dengan knob sesi manual. Kolom null = warisi.
  const { agent, model, effort } = await terminalAgentDefaults({
    agent: (cron.agent ?? undefined) as Agent | undefined,
    model: cron.model ?? undefined,
    effort: cron.effort ?? undefined,
  });
  // SPEC-377/383 · diturunkan dari agen HASIL resolusi, bukan Setting.agent — keduanya bisa berbeda,
  // dan membaca yang salah membuat sesi mentok di layar trust codex tanpa manusia di pane.
  if (agent === "codex") ensureCodexTrust(repoDir);

  const id = cronSessionId(cron.id);
  const wt = `${repoDir}/.worktrees/${id}`;
  if (!realGit.worktreeAlive(wt)) realGit.addWorktree(repoDir, wt, "HEAD");

  const s = createSession(cron.projectId, wt, {
    id, agent, model, effort,
    prompt: cronPrompt(
      { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
      { name: cron.name, prompt: cron.prompt },
    ),
  });
  return { id: s.id };
}
```

- [x] **Step 6: Typecheck kedua paket**

```bash
pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck
```

Expected: keluar 0, tanpa error.

- [x] **Step 7: Commit**

```bash
git add runner/src/prompt.ts runner/test/cron-prompt.test.ts server/src/services/scheduler/cron-session.ts
git commit -m "feat(spec-646): prompt cron + peluncuran sesi di worktree project"
```

---

### Task 6: Governor & engine — drain cron di anggaran slot yang sama

**Files:**
- Modify: `server/src/services/scheduler/governor.ts`
- Modify: `server/src/services/scheduler/engine.ts`
- Create: `server/test/scheduler-cron-drain.test.ts`

**Interfaces:**
- Consumes: `queuedCronRuns`/`markCronLaunched`/`markCronFailed`/`markCronSkipped`/`noteCronRun` (Task 4), `startCronSession`/`liveCronSession` (Task 5), `recordCronRun` (Task 4).
- Produces:
  - `GovernorDeps.drainCrons: (slots: number) => Promise<number>` (field baru, WAJIB)
  - `drainCronRuns(slots: number, deps: CronDeps): Promise<number>` diekspor dari `governor.ts`
  - `type CronDeps = { liveCron: (cronId: string) => string | null; launchCron: (cron: CronLaunchInput) => Promise<string> }`
  - `prodCronDeps: CronDeps` (engine)

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/scheduler-cron-drain.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { drainCronRuns, type CronDeps } from "../src/services/scheduler/governor";

const clean = async () => {
  await prisma.schedulerCronRun.deleteMany();
  await prisma.schedulerCron.deleteMany();
  await prisma.project.deleteMany();
  await prisma.notification.deleteMany();
};
beforeEach(clean); afterAll(clean);

const mk = async (over: Record<string, unknown> = {}, projectOver: Record<string, unknown> = {}) => {
  await prisma.project.upsert({
    where: { id: "p1" },
    update: { schedulerOptIn: true, ...projectOver },
    create: { id: "p1", name: "P1", desc: "", kind: "existing", schedulerOptIn: true, ...projectOver },   // `desc` WAJIB di skema
  });
  const cron = await prisma.schedulerCron.create({
    data: { projectId: "p1", name: "Cek pagi", expr: "0 7 * * *", prompt: "x", enabled: true, ...over },
  });
  const run = await prisma.schedulerCronRun.create({
    data: { cronId: cron.id, projectId: "p1", dueAt: new Date(2026, 7, 11, 7, 0) },
  });
  return { cron, run };
};
const deps = (over: Partial<CronDeps> = {}): CronDeps => ({
  liveCron: () => null,
  launchCron: async () => "cron_s1",
  ...over,
});
const statusOf = async (id: string) => (await prisma.schedulerCronRun.findUnique({ where: { id } }))!;

describe("drainCronRuns", () => {
  it("meluncurkan dan mengembalikan sisa slot", async () => {
    const { run } = await mk();
    expect(await drainCronRuns(2, deps())).toBe(1);
    const r = await statusOf(run.id);
    expect(r.status).toBe("launched");
    expect(r.sessionId).toBe("cron_s1");
    expect(r.startedAt).not.toBeNull();
  });

  it("slot habis → baris tetap queued ber-note 'cap penuh', tak meluncur", async () => {
    const { run } = await mk();
    let launches = 0;
    expect(await drainCronRuns(0, deps({ launchCron: async () => { launches++; return "s"; } }))).toBe(0);
    expect(launches).toBe(0);
    const r = await statusOf(run.id);
    expect(r.status).toBe("queued");
    expect(r.note).toContain("cap penuh");
  });

  it("sesi cron sebelumnya masih hidup → skipped, slot tak terpakai", async () => {
    const { cron, run } = await mk();
    let launches = 0;
    const left = await drainCronRuns(2, deps({
      liveCron: (id) => (id === cron.id ? "cron_live" : null),
      launchCron: async () => { launches++; return "s"; },
    }));
    expect(left).toBe(2);
    expect(launches).toBe(0);
    const r = await statusOf(run.id);
    expect(r.status).toBe("skipped");
    expect(r.note).toContain("masih berjalan");
  });

  it("cron dinonaktifkan selagi mengantre → skipped", async () => {
    const { cron, run } = await mk();
    await prisma.schedulerCron.update({ where: { id: cron.id }, data: { enabled: false } });
    await drainCronRuns(2, deps());
    const r = await statusOf(run.id);
    expect(r.status).toBe("skipped");
    expect(r.note).toContain("nonaktif");
  });

  it("cron dihapus selagi mengantre → skipped", async () => {
    const { cron, run } = await mk();
    await prisma.schedulerCron.delete({ where: { id: cron.id } });
    await drainCronRuns(2, deps());
    expect((await statusOf(run.id)).status).toBe("skipped");
  });

  it("project belum opt-in scheduler → skipped dengan alasan tercatat", async () => {
    const { run } = await mk({}, { schedulerOptIn: false });
    await drainCronRuns(2, deps());
    const r = await statusOf(run.id);
    expect(r.status).toBe("skipped");
    expect(r.note).toContain("opt-in");
  });

  it("launch melempar → failed dengan pesannya, slot tak terpakai", async () => {
    const { run } = await mk();
    const left = await drainCronRuns(2, deps({
      launchCron: async () => { throw new Error("project \"p1\" belum di-bind ke checkout lokal"); },
    }));
    expect(left).toBe(2);
    const r = await statusOf(run.id);
    expect(r.status).toBe("failed");
    expect(r.note).toContain("belum di-bind");
  });

  it("peluncuran sukses menstempel lastRunAt cron", async () => {
    const { cron } = await mk();
    await drainCronRuns(1, deps());
    expect((await prisma.schedulerCron.findUnique({ where: { id: cron.id } }))!.lastRunAt).not.toBeNull();
  });

  it("tiap keadaan terminal menerbitkan tepat satu notifikasi", async () => {
    await mk();
    await drainCronRuns(1, deps());
    expect(await prisma.notification.count({ where: { type: "cron" } })).toBe(1);
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism server/test/scheduler-cron-drain.test.ts
```

Expected: FAIL — `drainCronRuns` tak diekspor dari `governor`.

- [x] **Step 3: Tambahkan `drainCronRuns` + integrasi di `governor.ts`**

Di `server/src/services/scheduler/governor.ts`, tambahkan import:

```ts
import { prisma } from "../../db";
import {
  queuedCronRuns, markCronLaunched, markCronFailed, markCronSkipped, noteCronRun,
} from "./cron";
import type { CronLaunchInput } from "./cron-session";
import { recordCronRun } from "../notifications";
```

Tambahkan tipe `CronDeps` dan field baru di `GovernorDeps`:

```ts
// SPEC-646 · ADR-0112 · seam peluncuran cron, di-inject agar teruji tanpa tmux/git nyata —
// cermin `launch`/`isLive` milik antrean spec.
export type CronDeps = {
  liveCron: (cronId: string) => string | null;      // sessionId pane cron yang hidup, atau null
  launchCron: (cron: CronLaunchInput) => Promise<string>;   // → sessionId; throw = gagal
};
```

Di `GovernorDeps`, tambahkan field WAJIB (bukan opsional — tipe wajib adalah jaminan kompilasi
bahwa jalurnya tak pernah lupa dipasang, alasan yang sama dengan `blockers` SPEC-447):

```ts
  // SPEC-646 · ADR-0112 · cron memakai ANGGARAN SLOT YANG SAMA. Ia dibelanjakan lebih dulu karena
  // jatuh temponya punya makna waktu (terlambat = kehilangan makna), sedangkan baris antrean spec
  // tak punya tenggat dan tak kehilangan apa pun dengan menunggu satu tick.
  drainCrons: (slots: number) => Promise<number>;   // → sisa slot
```

Tambahkan konstanta alasan dan fungsi drain-nya (sebelum `export async function drain`):

```ts
// SPEC-646 · alasan yang dibaca operator di riwayat run. `CAP_FULL_NOTE` sengaja BUKAN status
// terminal: ia catatan pada baris yang masih `queued`, dan `expireStale` (cron.ts) yang
// mengubahnya jadi `skipped` bila keterlambatannya melewati grace.
export const CAP_FULL_NOTE = "cap penuh — tak ada slot sesi";
export const cronLiveNote = (sessionId: string) =>
  `sesi cron sebelumnya masih berjalan (${sessionId})`;
export const CRON_GONE_NOTE = "cron sudah dihapus atau dinonaktifkan";
export const CRON_OPTOUT_NOTE = "project belum di-opt-in scheduler";

export async function drainCronRuns(slots: number, deps: CronDeps): Promise<number> {
  for (const run of await queuedCronRuns()) {
    const cron = await prisma.schedulerCron.findUnique({ where: { id: run.cronId } });
    const close = async (status: "skipped" | "failed", note: string) => {
      if (status === "skipped") await markCronSkipped(run.id, note);
      else await markCronFailed(run.id, note);
      await recordCronRun(run.cronId, cron?.name ?? run.cronId, run.projectId, run.dueAt, status, note);
    };
    // Semua gerbang membaca ULANG dari DB tepat sebelum peluncuran (pola `isDone` SPEC-431 /
    // `blockers` SPEC-447): cron bisa dinonaktifkan, dihapus, atau project-nya dicabut opt-in
    // SELAGI barisnya mengantre.
    if (!cron || !cron.enabled) { await close("skipped", CRON_GONE_NOTE); continue; }
    const project = await prisma.project.findUnique({
      where: { id: cron.projectId }, select: { schedulerOptIn: true },
    });
    // ADR-0072 keputusan 5: scheduler hanya menyentuh project yang di-opt-in, dan sebuah cron yang
    // membuka sesi adalah persis itu. Bahayanya bukan gerbangnya melainkan kesenyapannya — karena
    // itu alasannya masuk riwayat run, bukan sekadar tak terjadi apa-apa.
    if (!project?.schedulerOptIn) { await close("skipped", CRON_OPTOUT_NOTE); continue; }
    // Satu sesi per cron (ADR-0015): jatuh tempo berikutnya DILEWATI, tak menumpuk sesi.
    const live = deps.liveCron(cron.id);
    if (live) { await close("skipped", cronLiveNote(live)); continue; }
    if (slots <= 0) { await noteCronRun(run.id, CAP_FULL_NOTE); continue; }
    try {
      const sessionId = await deps.launchCron({
        id: cron.id, projectId: cron.projectId, name: cron.name, prompt: cron.prompt,
        agent: cron.agent, model: cron.model, effort: cron.effort,
      });
      // CAS gagal = barisnya sudah tak `queued` (dibatalkan/kedaluwarsa selagi sesinya lahir).
      // Sesinya nyata, jadi slotnya tetap dibelanjakan — cap tak boleh dilanggar karena balapan.
      if (await markCronLaunched(run.id, sessionId)) {
        await recordCronRun(cron.id, cron.name, cron.projectId, run.dueAt, "launched", null);
      }
      await prisma.schedulerCron.update({ where: { id: cron.id }, data: { lastRunAt: new Date() } });
      slots--;
    } catch (e) {
      await close("failed", (e as Error).message);
    }
  }
  return slots;
}
```

Di dalam `drain()`, ganti dua baris pembuka anggaran slot:

```ts
    let slots = cfg.maxConcurrent - deps.liveCount();
    if (slots <= 0) return;
```

menjadi:

```ts
    let slots = cfg.maxConcurrent - deps.liveCount();
    // SPEC-646 · cron lebih dulu, ANGGARAN YANG SAMA. Dipanggil juga saat `slots <= 0` supaya
    // baris cron yang jatuh tempo tetap mendapat catatan "cap penuh" alih-alih menggantung tanpa
    // penjelasan sampai kedaluwarsa.
    slots = await deps.drainCrons(slots);
    if (slots <= 0) return;
```

- [x] **Step 4: Pasang di `engine.ts`**

Di `server/src/services/scheduler/engine.ts`, tambahkan import:

```ts
import { sweepCronDue } from "./cron";
import { drainCronRuns } from "./governor";
import { startCronSession, liveCronSession } from "./cron-session";
```

Tambahkan langkah sweep di `tick`, tepat SEBELUM baris `if (cfg.paused) return;`:

```ts
  // SPEC-646 · ADR-0112 · materialisasi jatuh tempo cron → baris run. Dijalankan SEBELUM gerbang
  // Pause dengan sengaja: Pause adalah rem PELUNCURAN, bukan penghapus antrean (ADR-0072
  // keputusan 4) — jatuh tempo yang lewat selama jeda tetap tercatat, dan melanjutkan jeda dalam
  // grace tetap menjalankannya. Master `enabled=false` sudah memulangkan tick di atas, jadi
  // seluruh fitur cron ikut mati di sana.
  try { await sweepCronDue(now); } catch (e) { console.error("scheduler cron sweep:", e); }
```

Tambahkan ke `prodDeps`, sesudah `launch`:

```ts
  // SPEC-646 · ADR-0112 · cron memakai anggaran slot yang sama dengan antrean spec.
  drainCrons: (slots) => drainCronRuns(slots, {
    liveCron: liveCronSession,
    launchCron: async (cron) => (await startCronSession(cron)).id,
  }),
```

- [x] **Step 5: Perbaiki test governor lama yang kini kurang satu field**

`server/test/scheduler-governor.test.ts` & `server/test/scheduler-engine.test.ts` merakit
`GovernorDeps` sebagai literal; field `drainCrons` yang baru wajib ada agar typecheck lolos.
Tambahkan `drainCrons: async (s) => s,` ke SETIAP literal `GovernorDeps` di kedua berkas
(pass-through: test itu menguji antrean spec, bukan cron). **Termasuk yang TAK ber-anotasi tipe** —
`scheduler-engine.test.ts` punya satu literal inline di dalam `await tick(1_000_000, { … })`, dan
vitest tak menjalankan typecheck sehingga yang terlihat bukan error kompilasi melainkan
`launches === 0`: `deps.drainCrons` yang `undefined` melempar, lalu `catch` di `tick` menelannya.

```bash
grep -n "GovernorDeps" server/test/scheduler-governor.test.ts server/test/scheduler-engine.test.ts
grep -n "await tick(" server/test/scheduler-engine.test.ts
```

- [x] **Step 6: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/scheduler-cron-drain.test.ts server/test/scheduler-governor.test.ts server/test/scheduler-engine.test.ts
```

Expected: PASS seluruhnya (9 test baru + test lama tetap hijau).

- [x] **Step 7: Typecheck server**

```bash
pnpm --filter ./server typecheck
```

Expected: keluar 0.

- [x] **Step 8: Commit**

```bash
git add server/src/services/scheduler/governor.ts server/src/services/scheduler/engine.ts server/test/scheduler-cron-drain.test.ts server/test/scheduler-governor.test.ts server/test/scheduler-engine.test.ts
git commit -m "feat(spec-646): drain cron di anggaran slot governor + sweep di tick"
```

---

### Task 7: REST + gerbang capability

**Files:**
- Modify: `server/src/routes/scheduler.ts`
- Modify: `server/src/services/agent-capabilities.ts`
- Create: `server/test/scheduler-cron.route.test.ts`

**Interfaces:**
- Consumes: `zCreateCron`/`zPatchCron` (Task 3), `computeNextRun`/`listCronRunsPage` (Task 4), `getScheduler` (ada).
- Produces: enam endpoint di §7 desain.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/scheduler-cron.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { setScheduler } from "../src/services/scheduler/config";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.schedulerCronRun.deleteMany();
  await prisma.schedulerCron.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", kind: "existing", schedulerOptIn: true } });
  await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: true });
});
afterAll(clean);

const body = { project: "p1", name: "Cek pagi", expr: "0 7 * * *", prompt: "Periksa error." };
const create = () => app.inject({ method: "POST", url: "/api/scheduler/crons", payload: body });

describe("cron CRUD", () => {
  it("POST membuat cron nonaktif + nextRunAt terhitung", async () => {
    const r = await create();
    expect(r.statusCode).toBe(201);
    expect(r.json().enabled).toBe(false);
    expect(r.json().nextRunAt).not.toBeNull();
    expect(r.json().projectId).toBe("p1");
  });
  it("POST menolak expr tak sah (400)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/scheduler/crons", payload: { ...body, expr: "0 99 * * *" } });
    expect(r.statusCode).toBe(400);
  });
  it("POST menolak project yang tak ada (404)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/scheduler/crons", payload: { ...body, project: "nope" } });
    expect(r.statusCode).toBe(404);
  });
  it("GET menyaring per project dan beramplop paginasi", async () => {
    await create();
    const r = await app.inject({ method: "GET", url: "/api/scheduler/crons?projectId=p1&page=1&limit=10" });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(1);
    expect(r.json().pageSize).toBe(10);
    expect(r.json().items[0].name).toBe("Cek pagi");
  });
  it("PATCH expr menghitung ulang nextRunAt", async () => {
    const id = (await create()).json().id;
    const before = (await prisma.schedulerCron.findUnique({ where: { id } }))!.nextRunAt;
    const r = await app.inject({ method: "PATCH", url: `/api/scheduler/crons/${id}`, payload: { expr: "0 21 * * *" } });
    expect(r.statusCode).toBe(200);
    const after = (await prisma.schedulerCron.findUnique({ where: { id } }))!.nextRunAt;
    expect(after!.getTime()).not.toBe(before!.getTime());
    expect(after!.getHours()).toBe(21);
  });
  it("PATCH enabled=true menghitung nextRunAt bila belum ada", async () => {
    const id = (await create()).json().id;
    await prisma.schedulerCron.update({ where: { id }, data: { nextRunAt: null } });
    await app.inject({ method: "PATCH", url: `/api/scheduler/crons/${id}`, payload: { enabled: true } });
    expect((await prisma.schedulerCron.findUnique({ where: { id } }))!.nextRunAt).not.toBeNull();
  });
  it("DELETE menghapus cron beserta riwayat run-nya", async () => {
    const id = (await create()).json().id;
    await prisma.schedulerCronRun.create({ data: { cronId: id, projectId: "p1", dueAt: new Date() } });
    const r = await app.inject({ method: "DELETE", url: `/api/scheduler/crons/${id}` });
    expect(r.statusCode).toBe(204);
    expect(await prisma.schedulerCronRun.count({ where: { cronId: id } })).toBe(0);
  });
  it("PATCH/DELETE cron yang tak ada → 404", async () => {
    expect((await app.inject({ method: "PATCH", url: "/api/scheduler/crons/x", payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/scheduler/crons/x" })).statusCode).toBe(404);
  });
});

describe("jalankan sekarang", () => {
  it("membuat baris run manual berstatus queued", async () => {
    const id = (await create()).json().id;
    const r = await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` });
    expect(r.statusCode).toBe(201);
    expect(r.json().manual).toBe(true);
    expect(r.json().status).toBe("queued");
  });
  it("menolak 409 bila sudah ada run yang menunggu", async () => {
    const id = (await create()).json().id;
    await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` });
    const r = await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` });
    expect(r.statusCode).toBe(409);
  });
  it("menolak 409 saat scheduler mati", async () => {
    const id = (await create()).json().id;
    await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: false });
    const r = await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain("scheduler");
  });
  it("menolak 409 saat scheduler dijeda", async () => {
    const id = (await create()).json().id;
    await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: true, paused: true });
    expect((await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` })).statusCode).toBe(409);
  });
});

describe("riwayat run", () => {
  it("beramplop paginasi, urut jatuh tempo turun", async () => {
    const id = (await create()).json().id;
    for (const h of [7, 8, 9]) {
      await prisma.schedulerCronRun.create({ data: { cronId: id, projectId: "p1", dueAt: new Date(2026, 7, 11, h, 0), status: "launched" } });
    }
    const r = await app.inject({ method: "GET", url: `/api/scheduler/crons/${id}/runs?page=1&limit=2` });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(3);
    expect(r.json().items).toHaveLength(2);
    expect(new Date(r.json().items[0].dueAt).getHours()).toBe(9);
  });
});

// SPEC-646 · gerbang capability: sebuah cron adalah `POST /terminal/sessions` yang DITUNDA, jadi
// `settings:write` tak boleh cukup untuknya.
describe("capabilityForRoute", () => {
  it("seluruh /scheduler/crons* COOKIE_ONLY di semua method", () => {
    for (const [m, p] of [
      ["GET", "/api/scheduler/crons"], ["POST", "/api/scheduler/crons"],
      ["PATCH", "/api/scheduler/crons/c1"], ["DELETE", "/api/scheduler/crons/c1"],
      ["POST", "/api/scheduler/crons/c1/run"], ["GET", "/api/scheduler/crons/c1/runs"],
    ] as const) {
      expect(capabilityForRoute(m, p), `${m} ${p}`).toBe("COOKIE_ONLY");
    }
  });
  it("endpoint scheduler lain tak berubah", () => {
    expect(capabilityForRoute("GET", "/api/scheduler/config")).toBe("settings:read");
    expect(capabilityForRoute("PUT", "/api/scheduler/config")).toBe("settings:write");
    expect(capabilityForRoute("GET", "/api/scheduler/queue")).toBe("settings:read");
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism server/test/scheduler-cron.route.test.ts
```

Expected: FAIL — 404 dari route yang belum ada dan `settings:read` dari capability yang belum bercabang.

- [x] **Step 3: Tambahkan cabang capability**

Di `server/src/services/agent-capabilities.ts`, ganti baris

```ts
  if (top === "scheduler") return rw("settings");   // SPEC-294 · scheduler = setelan instance
```

menjadi

```ts
  if (top === "scheduler") {
    // SPEC-646 · ADR-0112 · cron BUKAN knob. Ia adalah `POST /terminal/sessions` yang ditunda:
    // sebuah baris cron membuat hanoman membuka sesi agen di worktree project, berulang, tanpa
    // manusia di pane. Membiarkannya di `settings` berarti setiap agent token pemegang
    // `settings:write` bisa menjadwalkan sesi tanpa batas — persis kelas eskalasi yang ditutup
    // SPEC-405 untuk `/update/apply` (prefix status yang dipetakan tanpa melihat method) dan
    // ADR-0097/0100 untuk permukaan kredensial. ADR-0099 sudah menetapkan bahwa MCP tak
    // mengekspos tool yang mengeksekusi; cron adalah eksekusi.
    if (seg[1] === "crons") return "COOKIE_ONLY";
    return rw("settings");   // SPEC-294 · sisanya = setelan instance
  }
```

- [x] **Step 4: Tambahkan route**

Di `server/src/routes/scheduler.ts`, tambahkan import:

```ts
import { zCreateCron, zPatchCron } from "@hanoman/shared";
import { computeNextRun, listCronRunsPage } from "../services/scheduler/cron";
```

lalu tempelkan sebelum penutup `}` fungsi default export:

```ts
  // SPEC-646 · ADR-0112 · CRUD cronjob per project. Semua di bawah prefix `/scheduler` seperti
  // tetangganya, TAPI `capabilityForRoute` memberi `crons` cabang COOKIE_ONLY sendiri.
  const cronView = (c: {
    id: string; projectId: string; name: string; expr: string; prompt: string;
    agent: string | null; model: string | null; effort: string | null; enabled: boolean;
    nextRunAt: Date | null; lastRunAt: Date | null; createdAt: Date;
  }) => ({
    id: c.id, projectId: c.projectId, name: c.name, expr: c.expr, prompt: c.prompt,
    agent: c.agent, model: c.model, effort: c.effort, enabled: c.enabled,
    nextRunAt: c.nextRunAt ? c.nextRunAt.toISOString() : null,
    lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  });
  const runView = (r: {
    id: string; cronId: string; projectId: string; dueAt: Date; startedAt: Date | null;
    status: string; sessionId: string | null; note: string | null; manual: boolean; createdAt: Date;
  }) => ({
    id: r.id, cronId: r.cronId, projectId: r.projectId,
    dueAt: r.dueAt.toISOString(), startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    status: r.status, sessionId: r.sessionId, note: r.note, manual: r.manual,
    createdAt: r.createdAt.toISOString(),
  });

  app.get("/scheduler/crons", async (req) => {
    const { projectId, page, limit } = req.query as Record<string, string | undefined>;
    const where = projectId ? { projectId } : undefined;
    const total = await prisma.schedulerCron.count({ where });
    const pageSize = limit ? Math.max(1, Math.floor(+limit) || 1) : (total || 1);
    const p = page ? Math.max(1, Math.floor(+page) || 1) : 1;
    const items = await prisma.schedulerCron.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (p - 1) * pageSize, take: pageSize,
    });
    return { items: items.map(cronView), total, page: p, pageSize };
  });

  app.post("/scheduler/crons", async (req, reply) => {
    const parsed = zCreateCron.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    if (!(await prisma.project.findUnique({ where: { id: d.project } })))
      return reply.code(404).send({ error: "project not found" });
    const created = await prisma.schedulerCron.create({
      data: {
        projectId: d.project, name: d.name, expr: d.expr, prompt: d.prompt,
        agent: d.agent ?? null, model: d.model ?? null, effort: d.effort ?? null,
        enabled: d.enabled,
        // Dihitung sekarang walau cron-nya nonaktif: kolomnya juga yang memberi makan preview
        // "jalan berikutnya" di daftar, dan menghitungnya baru saat diaktifkan membuat baris yang
        // baru dibuat tampak tak berjadwal.
        nextRunAt: computeNextRun(d.expr, new Date()),
      },
    });
    return reply.code(201).send(cronView(created));
  });

  app.patch("/scheduler/crons/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPatchCron.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const cur = await prisma.schedulerCron.findUnique({ where: { id } });
    if (!cur) return reply.code(404).send({ error: "cron tak ada" });
    const d = parsed.data;
    const expr = d.expr ?? cur.expr;
    // `nextRunAt` dihitung ulang saat expr berubah ATAU saat kolomnya kosong — cron yang jadwalnya
    // sudah habis (dan karena itu ber-nextRunAt null) harus bisa dihidupkan lagi lewat PATCH.
    const recompute = d.expr !== undefined || cur.nextRunAt === null;
    const updated = await prisma.schedulerCron.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.expr !== undefined ? { expr: d.expr } : {}),
        ...(d.prompt !== undefined ? { prompt: d.prompt } : {}),
        ...(d.agent !== undefined ? { agent: d.agent } : {}),
        ...(d.model !== undefined ? { model: d.model } : {}),
        ...(d.effort !== undefined ? { effort: d.effort } : {}),
        ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
        ...(recompute ? { nextRunAt: computeNextRun(expr, new Date()) } : {}),
      },
    });
    return cronView(updated);
  });

  app.delete("/scheduler/crons/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.schedulerCron.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "cron tak ada" });
    // Riwayat run ikut terhapus: tanpa FK di skema (cermin SchedulerQueueItem/LeadDecision),
    // membiarkannya berarti baris yatim yang tak punya cara ditampilkan maupun dibersihkan.
    await prisma.schedulerCronRun.deleteMany({ where: { cronId: id } });
    await prisma.schedulerCron.delete({ where: { id } });
    return reply.code(204).send();
  });

  // SPEC-646 · "Jalankan sekarang" TIDAK melahirkan sesi langsung: ia membuat baris run manual, dan
  // tick berikutnya (≤10 dtk) yang meluncurkannya lewat governor. Itu satu-satunya cara tombol uji
  // coba tetap tunduk cap, Pause, dan master switch tanpa menyalin gerbangnya ke sini — kelas bug
  // SPEC-431/448/475/481. Karena itu penolakannya EKSPLISIT (409), bukan tombol yang diam.
  app.post("/scheduler/crons/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cron = await prisma.schedulerCron.findUnique({ where: { id } });
    if (!cron) return reply.code(404).send({ error: "cron tak ada" });
    const cfg = await getScheduler();
    if (!cfg.enabled) return reply.code(409).send({ error: "scheduler sedang berhenti — aktifkan dulu di panel Kendali" });
    if (cfg.paused) return reply.code(409).send({ error: "scheduler sedang dijeda — lanjutkan dulu di panel Kendali" });
    const pending = await prisma.schedulerCronRun.findFirst({ where: { cronId: id, status: "queued" } });
    if (pending) return reply.code(409).send({ error: "masih ada run yang menunggu dijalankan", runId: pending.id });
    try {
      const run = await prisma.schedulerCronRun.create({
        data: { cronId: id, projectId: cron.projectId, dueAt: new Date(), manual: true },
      });
      return reply.code(201).send(runView(run));
    } catch {
      // P2002: jatuh tempo dengan stempel yang sama persis sudah diklaim.
      return reply.code(409).send({ error: "run untuk jatuh tempo ini sudah ada" });
    }
  });

  app.get("/scheduler/crons/:id/runs", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.schedulerCron.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "cron tak ada" });
    const { page, limit } = req.query as Record<string, string | undefined>;
    const r = await listCronRunsPage(id, { page, limit });
    return { items: r.items.map(runView), total: r.total, page: r.page, pageSize: r.pageSize };
  });
```

- [x] **Step 5: Jalankan test sampai hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism server/test/scheduler-cron.route.test.ts
```

Expected: PASS seluruhnya (16 test).

- [x] **Step 6: Pastikan gerbang capability lama tak rusak**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism server/test/mcp-capability.test.ts server/test/agent-doc-contract.test.ts
```

Expected: PASS. (Katalog MCP tak menyebut `/scheduler/crons`, jadi keduanya harus tetap hijau apa adanya.)

- [x] **Step 7: Commit**

```bash
git add server/src/routes/scheduler.ts server/src/services/agent-capabilities.ts server/test/scheduler-cron.route.test.ts
git commit -m "feat(spec-646): endpoint CRUD cron, jalankan-sekarang, riwayat run"
```

---

### Task 8: Klien API + panel UI

**Files:**
- Modify: `src/src/api/client.ts`
- Create: `src/src/screens/SchedulerCrons.tsx`
- Create: `src/src/screens/SchedulerCrons.test.tsx`
- Modify: `src/src/screens/SchedulerScreen.tsx`

**Interfaces:**
- Consumes: `paths.schedulerCrons` dkk (Task 3), `describeCron`/`nextRunFor`/`exprToPreset`/`presetToExpr`/`WEEKDAY_LABELS` (Task 1), `runtimeModels`/`runtimeEfforts` (`./session-runtime`), `ProjectVM` (`./types`).
- Produces:
  - `api.listCrons`, `api.createCron`, `api.patchCron`, `api.deleteCron`, `api.runCronNow`, `api.listCronRuns`
  - `<SchedulerCrons projects onProjectChanged onToast />`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/src/screens/SchedulerCrons.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SchedulerCrons } from "./SchedulerCrons";

const cron = (over: Record<string, unknown> = {}) => ({
  id: "c1", projectId: "p1", name: "Cek error pagi", expr: "0 7 * * *",
  prompt: "Periksa error produksi.", agent: null, model: null, effort: null, enabled: true,
  nextRunAt: "2026-08-12T00:00:00.000Z", lastRunAt: "2026-08-11T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z", ...over,
});

const listCrons = vi.fn(async () => ({ items: [cron()], total: 1, page: 1, pageSize: 10 }));
const listCronRuns = vi.fn(async () => ({
  items: [{ id: "r1", cronId: "c1", projectId: "p1", dueAt: "2026-08-11T00:00:00.000Z",
    startedAt: null, status: "skipped", sessionId: null, note: "cap penuh — tak ada slot sesi",
    manual: false, createdAt: "2026-08-11T00:00:00.000Z" }],
  total: 1, page: 1, pageSize: 10,
}));
const createCron = vi.fn(async () => cron({ id: "c2" }));
const runCronNow = vi.fn(async () => ({ id: "r2" }));
const updateProject = vi.fn(async () => ({}));

vi.mock("../api/client", () => ({
  api: {
    listCrons: (...a: unknown[]) => listCrons(...(a as [])),
    listCronRuns: (...a: unknown[]) => listCronRuns(...(a as [])),
    createCron: (...a: unknown[]) => createCron(...(a as [])),
    patchCron: vi.fn(async () => cron()),
    deleteCron: vi.fn(async () => undefined),
    runCronNow: (...a: unknown[]) => runCronNow(...(a as [])),
    updateProject: (...a: unknown[]) => updateProject(...(a as [])),
  },
}));

const projects = [{ id: "p1", name: "P1", schedulerOptIn: true }] as never;
const props = { projects, onProjectChanged: vi.fn(), onToast: vi.fn() };

beforeEach(() => { vi.clearAllMocks(); });

describe("SchedulerCrons", () => {
  it("menampilkan cron dengan jadwal terbaca manusia", async () => {
    render(<SchedulerCrons {...props} />);
    expect(await screen.findByText("Cek error pagi")).toBeTruthy();
    expect(screen.getByText(/setiap hari 07:00/)).toBeTruthy();
  });

  it("form baru menampilkan preview 'jalan berikutnya' dari preset", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    expect(await screen.findByLabelText("Nama cron")).toBeTruthy();
    expect(screen.getByTestId("cron-next-preview").textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("mengubah preset ke lanjutan memperlihatkan kolom cron expression", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    fireEvent.change(await screen.findByLabelText("Preset jadwal"), { target: { value: "lanjutan" } });
    expect(screen.getByLabelText("Cron expression")).toBeTruthy();
  });

  it("menyimpan cron baru lewat api.createCron dengan expr hasil preset", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    fireEvent.change(await screen.findByLabelText("Nama cron"), { target: { value: "Audit docs" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Audit docs." } });
    fireEvent.change(screen.getByLabelText("Jam"), { target: { value: "09:30" } });
    fireEvent.click(screen.getByRole("button", { name: /^Simpan$/ }));
    await waitFor(() => expect(createCron).toHaveBeenCalled());
    expect(createCron.mock.calls[0]![0]).toMatchObject({ name: "Audit docs", expr: "30 9 * * *", project: "p1" });
  });

  it("tombol jalankan sekarang memanggil api.runCronNow", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Jalankan sekarang/i }));
    await waitFor(() => expect(runCronNow).toHaveBeenCalledWith("c1"));
  });

  it("riwayat run menampilkan hasil beserta alasannya", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Riwayat/i }));
    expect(await screen.findByText(/cap penuh/)).toBeTruthy();
  });

  it("project belum opt-in: peringatan + tombol opt-in inline", async () => {
    render(<SchedulerCrons {...props} projects={[{ id: "p1", name: "P1", schedulerOptIn: false }] as never} />);
    await screen.findByText("Cek error pagi");
    expect(screen.getByText(/belum di-opt-in/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Opt-in$/ }));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("p1", { schedulerOptIn: true }));
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/src/screens/SchedulerCrons.test.tsx
```

Expected: FAIL — `./SchedulerCrons` tak ada.

- [ ] **Step 3: Tambahkan metode klien**

Di `src/src/api/client.ts`, tepat sesudah `getSchedulerQueue`, tambahkan (dan tambahkan
`SchedulerCronView`, `SchedulerCronRunView` ke daftar `import type` dari `@hanoman/shared` di
kepala berkas):

```ts
  // SPEC-646 · ADR-0112 · cronjob per project. COOKIE_ONLY di server — tak pernah lewat agent token.
  listCrons: (p: { projectId?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<SchedulerCronView>>(paths.schedulerCrons + qs(p)),
  createCron: (b: {
    project: string; name: string; expr: string; prompt: string;
    agent?: string; model?: string; effort?: string; enabled?: boolean;
  }) => j<SchedulerCronView>(paths.schedulerCrons, { method: "POST", ...body(b) }),
  patchCron: (id: string, b: Record<string, unknown>) =>
    j<SchedulerCronView>(paths.schedulerCron(id), { method: "PATCH", ...body(b) }),
  deleteCron: (id: string) => j<void>(paths.schedulerCron(id), { method: "DELETE" }),
  // 409 membawa kalimatnya sendiri ("scheduler sedang dijeda…") di `ApiError.detail`.
  runCronNow: (id: string) =>
    j<SchedulerCronRunView>(paths.schedulerCronRunNow(id), { method: "POST", ...body({}) }),
  listCronRuns: (id: string, p: { page?: number; limit?: number } = {}) =>
    j<Paginated<SchedulerCronRunView>>(paths.schedulerCronRuns(id) + qs(p)),
```

- [ ] **Step 4: Tulis `src/src/screens/SchedulerCrons.tsx`**

```tsx
/* SchedulerCrons — panel cronjob per project (SPEC-646 · ADR-0112). Dipasang di SchedulerScreen,
   TANPA entri HN_NAV baru: setiap key nav wajib punya cabang `section === …` di App.tsx, dan
   menambahkannya di sini tak memberi apa pun (SPEC-519).

   Preview "jalan berikutnya" di FORM dihitung lokal lewat `nextRunFor` karena ia menggambarkan
   expr yang belum tersimpan; `nextRunAt` di DAFTAR datang dari server (instan otoritatif) dan
   dirender di zona lokal browser. Keduanya memakai modul murni yang sama, jadi tak bisa berselisih. */
import React from "react";
import { Card, Button, Badge, Select, Input, Switch, Modal, Field, HnTextarea, Pager, serverPage, Icon } from "../ds";
import { api } from "../api/client";
import {
  describeCron, nextRunFor, exprToPreset, presetToExpr, parseCron, WEEKDAY_LABELS,
  type CronPreset, type SchedulerCronView, type SchedulerCronRunView, type Agent,
} from "@hanoman/shared";
import { runtimeModels, runtimeEfforts } from "./session-runtime";
import type { ProjectVM } from "./types";

const PAGE = 10;

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtLocal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

type PresetKind = CronPreset["kind"] | "lanjutan";

// Bentuk form: preset + komponennya, atau expr mentah. `exprToPreset` yang memutuskan mana yang
// dipakai saat sebuah cron dibuka untuk diubah — preset tak pernah disimpan, selalu diturunkan.
type Draft = {
  name: string; prompt: string; enabled: boolean;
  kind: PresetKind; time: string; weekday: number; everyHours: number; expr: string;
  agent: "" | Agent; model: string; effort: string;
};

const draftFrom = (c?: SchedulerCronView): Draft => {
  const p = c ? exprToPreset(c.expr) : { kind: "harian" as const, hour: 7, minute: 0 };
  const base: Draft = {
    name: c?.name ?? "", prompt: c?.prompt ?? "", enabled: c?.enabled ?? false,
    kind: "lanjutan", time: "07:00", weekday: 1, everyHours: 6, expr: c?.expr ?? "0 7 * * *",
    agent: (c?.agent as Agent | null) ?? "", model: c?.model ?? "", effort: c?.effort ?? "",
  };
  if (!p) return base;
  if (p.kind === "tiap-n-jam") return { ...base, kind: p.kind, everyHours: p.everyHours, time: `00:${pad2(p.minute)}` };
  const time = `${pad2(p.hour)}:${pad2(p.minute)}`;
  return p.kind === "mingguan"
    ? { ...base, kind: p.kind, time, weekday: p.weekday }
    : { ...base, kind: p.kind, time };
};

const exprOf = (d: Draft): string => {
  if (d.kind === "lanjutan") return d.expr.trim();
  const [h, m] = d.time.split(":").map(Number) as [number, number];
  switch (d.kind) {
    case "harian": return presetToExpr({ kind: "harian", hour: h, minute: m });
    case "hari-kerja": return presetToExpr({ kind: "hari-kerja", hour: h, minute: m });
    case "mingguan": return presetToExpr({ kind: "mingguan", hour: h, minute: m, weekday: d.weekday });
    case "tiap-n-jam": return presetToExpr({ kind: "tiap-n-jam", everyHours: d.everyHours, minute: m });
  }
};

const STATUS_TONE: Record<string, string> = {
  launched: "ok", queued: "neutral", skipped: "warn", failed: "err",
};
const STATUS_LABEL: Record<string, string> = {
  launched: "berjalan", queued: "menunggu", skipped: "dilewati", failed: "gagal",
};

function RunHistory({ cronId }: { cronId: string }) {
  const [items, setItems] = React.useState<SchedulerCronRunView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    let alive = true;
    api.listCronRuns(cronId, { page, limit: PAGE })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); } })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } });
    return () => { alive = false; };
  }, [cronId, page]);
  const sp = serverPage(total, page, PAGE);
  if (total === 0) return <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada eksekusi.</div>;
  return (
    <>
      {items.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", marginBottom: 6 }}>
          <Badge tone={(STATUS_TONE[r.status] ?? "neutral") as never} size="sm">{STATUS_LABEL[r.status] ?? r.status}</Badge>
          <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            jatuh tempo {fmtLocal(r.dueAt)}
            {r.startedAt ? ` · mulai ${fmtLocal(r.startedAt)}` : ""}
            {r.sessionId ? ` · sesi ${r.sessionId}` : ""}
            {r.manual ? " · uji coba" : ""}
            {r.note ? ` · ${r.note}` : ""}
          </span>
        </div>
      ))}
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={setPage} unit="run" />
    </>
  );
}

export type SchedulerCronsProps = {
  projects: ProjectVM[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
};

export function SchedulerCrons({ projects, onProjectChanged, onToast }: SchedulerCronsProps) {
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");
  const [items, setItems] = React.useState<SchedulerCronView[]>([]);
  const [editing, setEditing] = React.useState<SchedulerCronView | null | undefined>(undefined);
  const [draft, setDraft] = React.useState<Draft>(draftFrom());
  const [openRuns, setOpenRuns] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const project = projects.find((p) => p.id === projectId);

  const load = React.useCallback(() => {
    if (!projectId) { setItems([]); return; }
    api.listCrons({ projectId, page: 1, limit: 100 })
      .then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [projectId]);
  React.useEffect(() => { load(); }, [load]);

  const openForm = (c?: SchedulerCronView) => { setEditing(c ?? null); setDraft(draftFrom(c)); };

  const expr = exprOf(draft);
  const preview = parseCron(expr) ? nextRunFor(expr, new Date()) : null;

  const save = async () => {
    if (!parseCron(expr)) { onToast("Cron expression tak sah", "err", "x-circle"); return; }
    setBusy(true);
    try {
      const knobs = {
        agent: draft.agent || undefined, model: draft.model || undefined, effort: draft.effort || undefined,
      };
      if (editing) {
        await api.patchCron(editing.id, {
          name: draft.name, expr, prompt: draft.prompt, enabled: draft.enabled,
          agent: draft.agent || null, model: draft.model || null, effort: draft.effort || null,
        });
      } else {
        await api.createCron({ project: projectId, name: draft.name, expr, prompt: draft.prompt, enabled: draft.enabled, ...knobs });
      }
      onToast("Cron tersimpan", "ok", "save");
      setEditing(undefined); load();
    } catch (e) {
      onToast((e as { detail?: { error?: string } }).detail?.error ?? "Gagal menyimpan cron", "err", "x-circle");
    } finally { setBusy(false); }
  };

  const runNow = async (id: string) => {
    setBusy(true);
    try { await api.runCronNow(id); onToast("Uji coba diantrekan — sesi terbuka di tick berikutnya", "ok", "play"); }
    catch (e) { onToast((e as { detail?: { error?: string } }).detail?.error ?? "Gagal menjalankan cron", "err", "x-circle"); }
    finally { setBusy(false); load(); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { await api.deleteCron(id); onToast("Cron dihapus", "ok", "trash"); }
    catch { onToast("Gagal menghapus cron", "err", "x-circle"); }
    finally { setBusy(false); load(); }
  };

  const toggleOptIn = async () => {
    if (!projectId) return;
    await api.updateProject(projectId, { schedulerOptIn: true });
    await onProjectChanged(projectId);
    onToast("Project di-opt-in", "ok");
  };

  const agentForCatalog: Agent = draft.agent || "claude";

  return (
    <Card eyebrow="scheduler · cronjob" title="Pengecekan rutin per project"
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Select value={projectId} aria-label="Project" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProjectId(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          <Button size="sm" leftIcon="plus" disabled={!projectId} onClick={() => openForm()}>Cron baru</Button>
        </div>
      }>
      {/* Gerbang yang tak terlihat terbaca sebagai "cron rusak"; ia dinyatakan di sini DAN dicatat
          sebagai alasan di riwayat run (SPEC-479 memakai jalan yang sama untuk lencana "antre"). */}
      {project && !project.schedulerOptIn && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 12px",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)" }}>
          <Icon name="alert-triangle" size={16} color="var(--clay-500)" />
          <span style={{ flex: 1, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            Project ini belum di-opt-in scheduler — cron-nya tak akan pernah dijalankan.
          </span>
          <Button size="sm" leftIcon="check" onClick={() => void toggleOptIn()}>Opt-in</Button>
        </div>
      )}

      {items.length === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada cron di project ini.</div>
        : items.map((c) => (
          <div key={c.id} style={{ padding: "10px 12px", marginBottom: 6,
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{c.name}</span>
              <Badge tone={c.enabled ? "ok" : "neutral"} size="sm">{c.enabled ? "aktif" : "nonaktif"}</Badge>
              <span style={{ flex: 1 }} />
              <Button size="sm" variant="ghost" leftIcon="play" disabled={busy} onClick={() => void runNow(c.id)}>Jalankan sekarang</Button>
              <Button size="sm" variant="ghost" leftIcon="list" onClick={() => setOpenRuns(openRuns === c.id ? null : c.id)}>Riwayat</Button>
              <Button size="sm" variant="ghost" leftIcon="pencil" onClick={() => openForm(c)}>Ubah</Button>
              <Button size="sm" variant="ghost" leftIcon="trash" disabled={busy} onClick={() => void remove(c.id)}>Hapus</Button>
            </div>
            <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
              {describeCron(c.expr)} · terakhir {fmtLocal(c.lastRunAt)} · berikutnya {fmtLocal(c.nextRunAt)}
            </div>
            {openRuns === c.id && <div style={{ marginTop: 10 }}><RunHistory cronId={c.id} /></div>}
          </div>
        ))}

      <Modal open={editing !== undefined} title={editing ? "Ubah cron" : "Cron baru"} eyebrow="scheduler"
        onClose={() => setEditing(undefined)} width={620}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button size="sm" variant="ghost" onClick={() => setEditing(undefined)}>Batal</Button>
            <Button size="sm" leftIcon="save" disabled={busy} onClick={() => void save()}>Simpan</Button>
          </div>
        }>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Nama cron">
            <Input aria-label="Nama cron" placeholder="Cek error produksi pagi" value={draft.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
            <Field label="Preset jadwal">
              <Select aria-label="Preset jadwal" value={draft.kind}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, kind: e.target.value as PresetKind }))}
                options={[
                  { value: "harian", label: "Setiap hari" },
                  { value: "hari-kerja", label: "Hari kerja" },
                  { value: "mingguan", label: "Mingguan" },
                  { value: "tiap-n-jam", label: "Tiap N jam" },
                  { value: "lanjutan", label: "Lanjutan (cron expression)" },
                ]} />
            </Field>
            {draft.kind !== "lanjutan" && (
              <Field label={draft.kind === "tiap-n-jam" ? "Menit (dari jam)" : "Jam"}>
                <Input type="time" aria-label="Jam" value={draft.time}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, time: e.target.value }))} />
              </Field>
            )}
            {draft.kind === "mingguan" && (
              <Field label="Hari">
                <Select aria-label="Hari" value={String(draft.weekday)}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}
                  options={WEEKDAY_LABELS.map((l, i) => ({ value: String(i), label: l }))} />
              </Field>
            )}
            {draft.kind === "tiap-n-jam" && (
              <Field label="Tiap berapa jam">
                <Input type="number" min={1} max={23} aria-label="Tiap berapa jam" value={String(draft.everyHours)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, everyHours: Math.min(23, Math.max(1, Number(e.target.value) || 1)) }))} />
              </Field>
            )}
          </div>

          {draft.kind === "lanjutan" && (
            <Field label="Cron expression" hint="Lima field: menit jam tanggal bulan hari-pekan — zona waktu server.">
              <Input aria-label="Cron expression" placeholder="0 7 * * 1-5" value={draft.expr}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, expr: e.target.value }))} />
            </Field>
          )}

          <div data-testid="cron-next-preview" style={{ fontSize: "var(--text-xs)", color: preview ? "var(--text-muted)" : "var(--clay-500)" }}>
            {preview ? `Jalan berikutnya: ${fmtLocal(preview.toISOString())} (waktu lokal)` : "Jadwal tak sah — tak ada jalan berikutnya"}
          </div>

          <Field label="Prompt" hint="Instruksi bebas untuk agen. Temuan sebaiknya difilekan sebagai backlog lewat POST /api/specs.">
            <HnTextarea aria-label="Prompt" rows={6} value={draft.prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft((d) => ({ ...d, prompt: e.target.value }))} />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
            <Field label="Runtime">
              <Select aria-label="Runtime" value={draft.agent}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, agent: e.target.value as "" | Agent, model: "", effort: "" }))}
                options={[{ value: "", label: "Warisi default sesi" }, { value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex CLI" }]} />
            </Field>
            <Field label="Model">
              <Select aria-label="Model" value={draft.model} disabled={!draft.agent}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, model: e.target.value, effort: "" }))}
                options={[{ value: "", label: "Warisi" }, ...runtimeModels(agentForCatalog).map((m) => ({ value: m.id, label: m.label }))]} />
            </Field>
            <Field label="Effort">
              <Select aria-label="Effort" value={draft.effort} disabled={!draft.agent}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, effort: e.target.value }))}
                options={[{ value: "", label: "Warisi" }, ...runtimeEfforts(agentForCatalog, draft.model || runtimeModels(agentForCatalog)[0]!.id).map((x) => ({ value: x, label: x }))]} />
            </Field>
          </div>

          <Switch label="Aktif" checked={draft.enabled} onChange={(next: boolean) => setDraft((d) => ({ ...d, enabled: next }))} />
        </div>
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 5: Pasang di `SchedulerScreen.tsx`**

Tambahkan import:

```tsx
import { SchedulerCrons } from "./SchedulerCrons";
```

lalu sisipkan tepat sesudah `<Card eyebrow="scheduler · observabilitas" …>…</Card>` di dalam JSX
`SchedulerScreen`:

```tsx
      <SchedulerCrons projects={projects} onProjectChanged={onProjectChanged} onToast={onToast} />
```

- [ ] **Step 6: Jalankan test sampai hijau**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/src/screens/SchedulerCrons.test.tsx
```

Expected: PASS, 7 test.

Catatan yang sudah diverifikasi sebelum plan ini ditulis: `Field` menerima `label`+`hint`,
`HnTextarea` meneruskan `aria-label` lewat `...rest` (SPEC-407), dan `Icon` menerjemahkan nama
kebab-case ke komponen lucide (`alert-triangle` → `AlertTriangle`) dengan fallback bila tak ada.

- [ ] **Step 7: Typecheck web**

```bash
pnpm --filter ./src typecheck
```

Expected: keluar 0. (Bila nama paket web bukan `./src`, jalankan `pnpm -F "$(node -p "require('./src/package.json').name")" typecheck`.)

- [ ] **Step 8: Commit**

```bash
git add src/src/api/client.ts src/src/screens/SchedulerCrons.tsx src/src/screens/SchedulerCrons.test.tsx src/src/screens/SchedulerScreen.tsx
git commit -m "feat(spec-646): panel cronjob per project di scheduler"
```

---

### Task 9: Docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0112-cronjob-per-project-scheduler.md`
- Modify: `internal/docs/README.md` (daftar ADR)
- Modify: `internal/docs/adr/README.md` (narasi ADR)
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/skills/hanoman/SKILL.md` (butir arsitektur scheduler)

**Interfaces:**
- Consumes: seluruh keputusan Task 1–8.
- Produces: dokumentasi SoT.

- [ ] **Step 1: Verifikasi nomor ADR masih bebas**

```bash
ls internal/docs/adr | sort | tail -3
git branch -a --format='%(refname:short)'
git worktree list
grep -rn "ADR-0112" internal/docs || echo "0112 bebas"
```

Expected: `0111` adalah yang tertinggi dan `0112 bebas`. Bila tidak, pakai nomor bebas berikutnya
dan ganti seluruh rujukan `0112` di kode & docs.

- [ ] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0112-cronjob-per-project-scheduler.md` dengan struktur yang sama seperti
ADR tetangganya (Status · Tanggal · SPEC · Terkait · Konteks · Keputusan bernomor · Konsekuensi).
Isi wajib, satu keputusan per butir:

1. Unit peluncuran = sesi project-level ber-id **deterministik** `cron-<cronId>` di worktree
   isolasi, **tanpa `flow`**. Id deterministik ITU mekanisme "satu sesi per cron" (ADR-0015).
2. `SchedulerCron` + `SchedulerCronRun`, **LOCAL-ONLY**, `@@unique([cronId, dueAt])` sebagai kunci
   idempotensi. Satu tabel merangkap antrean & riwayat (pola `WebhookDelivery`, ADR-0100).
3. `expr` satu-satunya kebenaran jadwal; preset **diturunkan** bolak-balik oleh fungsi murni.
   Parser ditulis sendiri di `@hanoman/shared` supaya preview browser & jadwal server memakai kode
   yang sama.
4. Materialisasi jatuh tempo di tick yang sudah ada, **sebelum** gerbang Pause; jatuh tempo
   tertunggak → **satu** baris `skipped`, bukan burst.
5. `GRACE_MS` menjawab dua pertanyaan dengan satu angka: keterlambatan karena server mati dan
   karena cap penuh sama-sama membuat jadwal jam tertentu kehilangan maknanya.
6. Cron memakai **anggaran slot yang sama** dan didahulukan; gerbangnya membaca ulang dari DB tepat
   sebelum peluncuran.
7. Cron tetap tunduk `Project.schedulerOptIn`; kesenyapannya ditutup dua arah (alasan di riwayat +
   lencana & tombol opt-in di panel).
8. `/scheduler/crons*` **COOKIE_ONLY** — cron adalah `POST /terminal/sessions` yang ditunda.
9. "Jalankan sekarang" = baris run manual, bukan spawn langsung.

Bagian **Konsekuensi** wajib menyebut batas yang dipilih sadar: baris run berhenti di `launched`
(nasib sesi terbaca di Terminal, ADR-0079); tanpa retry; tanpa zona waktu per cron; ADR-0072
"HH:MM ditunda" **kini terjawab**.

Bagian **Gotcha** wajib memuat: (1) `PG_ORDER` harus memuat kedua model, satu-satunya gerbangnya
`cli/test/migrate-pg.test.ts`; (2) `GovernorDeps.drainCrons` WAJIB (bukan opsional) — tipe wajib
adalah jaminan kompilasi bahwa jalurnya tak pernah lupa dipasang, alasan yang sama dengan
`blockers` SPEC-447; (3) `nextRunAt` **bukan** kunci idempotensi — barisnya yang kunci, karena
`nextRunAt` bisa gagal ditulis sementara run-nya sudah lahir; (4) `ensureCodexTrust` diturunkan
dari agen **hasil** `terminalAgentDefaults`, bukan `Setting.agent` (SPEC-377/383);
(5) `sweepCronDue` jalan sebelum gerbang `paused` — memindahkannya ke bawah membuat Pause
menghapus jatuh tempo alih-alih menahannya.

- [ ] **Step 3: Tautkan ADR di kedua index**

Di `internal/docs/README.md`, tambahkan sebagai baris PERTAMA daftar `## adr`:

```markdown
- [0112 — Cronjob per project di scheduler: sesi ber-id deterministik, satu jatuh tempo satu baris, anggaran slot bersama](adr/0112-cronjob-per-project-scheduler.md)
```

Di `internal/docs/adr/README.md`, tambahkan narasinya mengikuti format entri tetangganya
(apa yang diperluas/ditegakkan + gotcha-nya).

- [ ] **Step 4: Perbarui api-contract & data-model**

`internal/docs/architecture/api-contract.md` — tambahkan blok:

```markdown
### Scheduler — cronjob per project (SPEC-646 · ADR-0112)

Semua **COOKIE_ONLY**: sebuah cron adalah `POST /terminal/sessions` yang ditunda, jadi
`settings:write` tak pernah cukup untuknya.

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/scheduler/crons?projectId=&page=&limit=` | `Paginated<SchedulerCronView>` |
| POST | `/api/scheduler/crons` | `{project,name,expr,prompt,agent?,model?,effort?,enabled?}` → 201; 400 expr tak sah, 404 project |
| PATCH | `/api/scheduler/crons/:id` | partial; `expr` berubah → `nextRunAt` dihitung ulang |
| DELETE | `/api/scheduler/crons/:id` | 204; riwayat run ikut terhapus |
| POST | `/api/scheduler/crons/:id/run` | uji coba → baris run `manual`; 409 saat scheduler mati/dijeda atau sudah ada run menunggu |
| GET | `/api/scheduler/crons/:id/runs?page=&limit=` | `Paginated<SchedulerCronRunView>` |
```

`internal/docs/architecture/data-model.md` — tambahkan `SchedulerCron` & `SchedulerCronRun` ke
daftar model LOCAL-ONLY beserta kolom dan alasan `@@unique([cronId, dueAt])`.

- [ ] **Step 5: Perbarui SKILL project**

Di `internal/skills/hanoman/SKILL.md` baris 87 (butir "Tidak ada message queue…"), sesudah
"engine scheduler (ADR-0072)" tambahkan "— yang sejak **SPEC-646/ADR-0112** juga memiliki
**cronjob per project** (jadwal HH:MM yang ditunda ADR-0072): jatuh tempo dimaterialisasi jadi baris
`SchedulerCronRun` di tick yang SAMA, tanpa timer kedua".

- [ ] **Step 6: Verifikasi integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || ./node_modules/.bin/tsx cli/src/index.ts docs index --check
```

Expected: index utuh (atau perintahnya tak tersedia di worktree ini — cukup pastikan tautan ADR
benar-benar ada di kedua README lewat `grep -n "0112" internal/docs/README.md internal/docs/adr/README.md`).

- [ ] **Step 7: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(spec-646): ADR-0112 cronjob per project + perbarui SoT tersentuh"
```

---

### Task 10: Verifikasi ber-skop + smoke endpoint nyata

**Files:** tak ada perubahan kode kecuali perbaikan yang ditemukan.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-646
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism --changed "$HANOMAN_BASE_SHA"
```

Expected: PASS. **Jangan menerima "no test files" sebagai bukti** — `--changed` menyalakan
`passWithNoTests`. Pastikan berkas berikut benar-benar terhitung di ringkasan:
`shared/src/cron-expr.test.ts`, `shared/src/cron-dto.test.ts`, `runner/test/cron-prompt.test.ts`,
`server/test/scheduler-cron-sweep.test.ts`, `server/test/scheduler-cron-drain.test.ts`,
`server/test/scheduler-cron.route.test.ts`, `server/test/scheduler-governor.test.ts`,
`server/test/scheduler-engine.test.ts`, `cli/test/migrate-pg.test.ts`,
`src/src/screens/SchedulerCrons.test.tsx`.

Bila test web ikut dan gagal massal, ulangi dengan `env -u NODE_ENV` di depan perintahnya.

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck
```

Expected: keluar 0 untuk ketiganya. (Jangan `pnpm -r typecheck`.)

- [ ] **Step 3: Smoke endpoint nyata (task ini menyentuh endpoint)**

Pakai DB khusus supaya run tetangga tak menghapusnya di tengah smoke:

```bash
export HANOMAN_HOME="$(mktemp -d)"
./node_modules/.bin/prisma migrate deploy --schema server/prisma/schema.prisma
PORT=8799 pnpm --filter ./server dev &
sleep 6
BASE=http://127.0.0.1:8799/api
curl -s -X POST $BASE/projects -H 'content-type: application/json' \
  -d '{"name":"Smoke","kind":"existing","desc":""}' | head -c 300; echo
curl -s -X PUT $BASE/scheduler/config -H 'content-type: application/json' \
  -d '{"enabled":true,"paused":false,"maxConcurrent":2,"autonomy":"butuh-keputusan","sources":{"backlog":{"enabled":false,"everyMin":15},"triase":{"enabled":false,"everyMin":30}}}' | head -c 200; echo
curl -s -X POST $BASE/scheduler/crons -H 'content-type: application/json' \
  -d '{"project":"smoke","name":"Cek pagi","expr":"0 7 * * *","prompt":"Periksa error."}' | tee /tmp/cron.json; echo
CRON=$(node -p "require('/tmp/cron.json').id")
curl -s "$BASE/scheduler/crons?projectId=smoke&page=1&limit=10"; echo
curl -s -X POST $BASE/scheduler/crons/$CRON/run; echo
curl -s -X POST $BASE/scheduler/crons/$CRON/run -o /dev/null -w '%{http_code}\n'   # harus 409
curl -s "$BASE/scheduler/crons/$CRON/runs?page=1&limit=10"; echo
curl -s -X POST $BASE/scheduler/crons -H 'content-type: application/json' \
  -d '{"project":"smoke","name":"x","expr":"0 99 * * *","prompt":"y"}' -o /dev/null -w '%{http_code}\n'  # harus 400
curl -s -X DELETE $BASE/scheduler/crons/$CRON -o /dev/null -w '%{http_code}\n'     # harus 204
```

Expected: 201 untuk create, daftar berisi satu cron ber-`nextRunAt` non-null, 201 lalu **409**
untuk run-now beruntun, **400** untuk expr tak sah, **204** untuk delete.

Matikan server per-PID (JANGAN `pkill -f`):

```bash
lsof -ti:8799 | xargs -r kill
```

Bila `project` id yang lahir bukan `smoke`, ambil dari respons `POST /projects`.

- [ ] **Step 4: Centang seluruh kotak plan ini**

Buka `docs/superpowers/plans/2026-08-11-scheduler-cron-per-project.md` dan pastikan **tak ada lagi
`- [ ]`** yang tersisa. hanoman menahan backlog di `executing` selama masih ada kotak kosong.

```bash
grep -c "^- \[ \]" docs/superpowers/plans/2026-08-11-scheduler-cron-per-project.md
```

Expected: `0`.

- [ ] **Step 5: Commit & push**

```bash
git add -A
git commit -m "chore(spec-646): centang plan + catat bukti verifikasi"
git push origin HEAD:refs/heads/hanoman/spec-646
```
