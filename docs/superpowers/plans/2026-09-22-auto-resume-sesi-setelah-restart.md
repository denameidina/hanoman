# Auto-resume sesi setelah restart/reboot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Begitu hanoman boot lagi (restart proses atau reboot device), backlog yang tadinya
punya sesi aktif otomatis dilanjutkan lewat jalur `resume` yang sudah ada (ADR-0084) — tanpa
operator klik apa pun.

**Architecture:** `reconcileHistory()` (sudah ada) menutup baris `SessionHistory` yang tmux-nya
sudah lenyap dengan `endedReason: "reconciled"`. Fungsi baru `reconciledSpecIdsSince(cutoff)`
membaca specId dari baris yang baru saja ditutup begitu — itulah kandidat resume. Fungsi baru
`resumeReconciledSessions()` menyaring kandidat yang belum `done`, lalu memanggil
`startSpecSession()` (ADR-0084) satu per satu; kegagalan per item dicatat sebagai `Notification`
dan tidak menghentikan kandidat lain. `startSpecSession()` mendapat opsi baru `bypassCapacity`
supaya auto-resume bisa melewati gerbang kapasitas ADR-0161 **tanpa** ikut melewati gerbang
dependency ADR-0093 (yang selama ini terikat jadi satu lewat `force`).

**Tech Stack:** TypeScript, Fastify, Prisma 6 (SQLite), Vitest.

## Global Constraints

- Bahasa komentar & commit message: Indonesia, mengikuti konvensi repo ini.
- `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism` untuk test yang
  tersentuh; jangan suite penuh. `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` bila ada sesi
  lain jalan di mesin ini.
- Jangan sentuh gerbang dependency ADR-0093 (`blockersForSpec`, `if (!opts.force)` di
  `session-launch.ts`) — auto-resume TETAP tunduk padanya. Hanya kapasitas (ADR-0161) yang boleh
  dilewati, lewat opsi baru `bypassCapacity`, terpisah dari `force`.
- Tidak ada perubahan skema Prisma, tidak ada migration baru — seluruh data yang dibutuhkan
  (`SessionHistory.endedReason`/`reconciledAt`/`specId`, `Spec.stage`) sudah ada.
- Tidak ada endpoint HTTP baru — fitur ini murni logika boot, jadi tidak ada langkah "curl
  endpoint" di Definition of Done AGENTS.md.

---

### Task 1: `startSpecSession()` — opsi `bypassCapacity`, terpisah dari `force`

**Files:**
- Modify: `server/src/services/session-launch.ts:93-100` (blok opsi `force`/`confirmRemote`, dan
  pemanggilan `withSessionAdmission`)
- Test: `server/test/session-launch-admission.test.ts`

**Interfaces:**
- Consumes: `withSessionAdmission` (`server/src/services/session-launch-gate.ts`, sudah ada,
  signature `(opts: {id?, force?, exempt?}, start, reuse) => Promise<T>`).
- Produces: `startSpecSession(spec, opts)` menerima opsi baru `opts.bypassCapacity?: boolean`.
  Task 3 memakainya lewat `startSpecSession(spec, { flow, bypassCapacity: true })`.

- [ ] **Step 1: Baca opts type saat ini untuk memastikan titik sisip yang benar**

Buka `server/src/services/session-launch.ts`, cari blok ini (sekitar baris 90-97):

```ts
    // SPEC-1216 · ADR-0165 §6 · lewati gerbang presence satu-sesi. HANYA jalur manusia yang
    // memasoknya (POST /terminal/sessions), cermin `force`. Governor & denyut lead tak pernah.
    confirmRemote?: boolean;
  },
): Promise<StartSpecResult> {
  const id = sessionIdForSpec(spec.id);
  return withSessionAdmission({ id, force: opts.force }, async () => {
```

- [ ] **Step 2: Tambah opsi `bypassCapacity` dan gunakan di pemanggilan gate**

Ganti blok di atas persis dengan:

```ts
    // SPEC-1216 · ADR-0165 §6 · lewati gerbang presence satu-sesi. HANYA jalur manusia yang
    // memasoknya (POST /terminal/sessions), cermin `force`. Governor & denyut lead tak pernah.
    confirmRemote?: boolean;
    // ADR-0169 · lewati HANYA gerbang kapasitas/beban host (ADR-0161) — bukan gerbang dependency
    // ADR-0093, yang tetap terikat murni ke `force`. Dipakai satu-satunya oleh auto-resume boot
    // (session-boot-resume.ts): item yang dependency-nya belum ter-merge harus TETAP diblokir
    // walau kapasitas dilewati.
    bypassCapacity?: boolean;
  },
): Promise<StartSpecResult> {
  const id = sessionIdForSpec(spec.id);
  return withSessionAdmission({ id, force: opts.force || opts.bypassCapacity }, async () => {
```

- [ ] **Step 3: Tulis test yang gagal dulu**

Di `server/test/session-launch-admission.test.ts`, tambahkan `it` baru di dalam
`describe("SPEC-1108 · gerbang bersama peluncuran backlog", ...)`, sesudah test
`"re-attach pane hidup tetap boleh saat cap penuh"`:

```ts
  it("opts.bypassCapacity melewati cap TANPA memerlukan force (ADR-0169)", async () => {
    await expect(startSpecSession(spec, { flow: "qa", bypassCapacity: true }))
      .resolves.toMatchObject({ id: "spec-1108" });
    expect(state.effects).toContain("spawn");
  });
```

- [ ] **Step 4: Jalankan test, pastikan GAGAL dulu (opsi belum ada efeknya)**

Run: `pnpm --filter ./server vitest run session-launch-admission.test.ts`
Expected sebelum Step 2 diterapkan: FAIL — `state.effects` tidak memuat `"spawn"` (request
ditolak `LaunchAdmissionError` kind `"capacity"` karena cap 1 sudah terisi pane lain).

> Catatan urutan: Step 2 (implementasi) di atas ditulis SEBELUM Step 3/4 di dokumen ini supaya
> pembaca melihat kode akhir lebih dulu, tapi saat eksekusi TETAP tulis test (Step 3), jalankan
> dan pastikan gagal, BARU terapkan Step 2, sesuai TDD.

- [ ] **Step 5: Jalankan test lagi, pastikan LULUS**

Run: `pnpm --filter ./server vitest run session-launch-admission.test.ts`
Expected: PASS, seluruh `describe("SPEC-1108 …")` hijau (3 test).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/session-launch.ts server/test/session-launch-admission.test.ts
git commit -m "$(cat <<'EOF'
feat(session-launch): opsi bypassCapacity terpisah dari force (ADR-0169)

startSpecSession() bisa melewati gerbang kapasitas ADR-0161 tanpa ikut
melewati gerbang dependency ADR-0093 — dua concern yang sebelumnya
terikat jadi satu lewat `force`. Disiapkan untuk auto-resume boot.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `reconciledSpecIdsSince()` di `session-history.ts`

**Files:**
- Modify: `server/src/services/session-history.ts` (tambah fungsi baru sesudah `reconcileHistory`,
  sebelum `installSessionHistory`, sekitar baris 231)
- Test: `server/test/session-history.service.test.ts`

**Interfaces:**
- Consumes: `prisma.sessionHistory` (Prisma Client), konstanta lokal `RECONCILED` (sudah ada di
  file ini, baris 29).
- Produces: `reconciledSpecIdsSince(cutoff: Date): Promise<string[]>` — dipakai Task 3.

- [ ] **Step 1: Tulis test yang gagal dulu**

Di `server/test/session-history.service.test.ts`, ubah baris import (baris 6-9) agar ikut
mengimpor fungsi baru:

```ts
import {
  beginSession, finishSession, listHistory, getHistory, transcriptOf, purgeHistory, reconcileHistory,
  reconcileTranscripts, reconciledSpecIdsSince,
} from "../src/services/session-history";
```

Tambahkan dua `it` baru di dalam `describe("session-history service (SPEC-362)", ...)`, sesudah
test `"satu sapuan boot memberi SATU stempel reconciledAt untuk semua barisnya"` (baris ~149):

```ts
  it("reconciledSpecIdsSince mengembalikan specId UNIK dari sapuan boot ini, tanpa yang null (ADR-0169)", async () => {
    await beginSession(birth({ sessionId: "a", specId: "SPEC-1" }));
    await beginSession(birth({ sessionId: "b", specId: "SPEC-1" })); // reopen — dua baris, satu specId
    await beginSession(birth({ sessionId: "c", specId: "SPEC-2" }));
    await beginSession(birth({ sessionId: "d", specId: undefined, kind: "shell" }));
    const cutoff = new Date();
    expect(await reconcileHistory([])).toBe(4);
    expect((await reconciledSpecIdsSince(cutoff)).sort()).toEqual(["SPEC-1", "SPEC-2"]);
  });

  it("reconciledSpecIdsSince mengabaikan reconcile SEBELUM cutoff (ADR-0169)", async () => {
    await beginSession(birth({ sessionId: "lama", specId: "SPEC-OLD" }));
    expect(await reconcileHistory([])).toBe(1);
    const cutoff = new Date();
    expect(await reconciledSpecIdsSince(cutoff)).toEqual([]);
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server vitest run session-history.service.test.ts --no-file-parallelism`
Expected: FAIL — `reconciledSpecIdsSince is not a function` (belum diekspor).

- [ ] **Step 3: Implementasi**

Di `server/src/services/session-history.ts`, sisipkan fungsi baru tepat SESUDAH penutup
`reconcileHistory` (baris 231, `}`) dan SEBELUM komentar `// Dipanggil server.ts sebelum request
pertama.` (baris 233):

```ts

// ADR-0169 · specId dari baris yang baru saja direkonsiliasi PADA SAPUAN BOOT INI — himpunan
// kandidat auto-resume. `cutoff` = waktu tepat SEBELUM reconcileHistory() dipanggil;
// reconcileHistory menstempel SATU `reconciledAt` untuk seluruh sapuannya (lihat komentar di
// atas), jadi `reconciledAt >= cutoff` mengambil persis sapuan itu, bukan reconcile lama.
export async function reconciledSpecIdsSince(cutoff: Date): Promise<string[]> {
  const rows = await prisma.sessionHistory.findMany({
    where: { endedReason: RECONCILED, reconciledAt: { gte: cutoff }, specId: { not: null } },
    select: { specId: true },
    distinct: ["specId"],
  });
  return rows.map((r) => r.specId!);
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server vitest run session-history.service.test.ts --no-file-parallelism`
Expected: PASS, seluruh file hijau.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/session-history.ts server/test/session-history.service.test.ts
git commit -m "$(cat <<'EOF'
feat(session-history): reconciledSpecIdsSince untuk kandidat auto-resume

Menurunkan specId dari baris yang baru direkonsiliasi pada satu sapuan
boot — sinyal yang sudah ada (reconcileHistory), tanpa mekanisme
deteksi baru. Dipakai session-boot-resume.ts (ADR-0169).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `resumeReconciledSessions()` — service baru

**Files:**
- Create: `server/src/services/session-boot-resume.ts`
- Test: `server/test/session-boot-resume.test.ts`

**Interfaces:**
- Consumes: `reconciledSpecIdsSince` (Task 2), `startSpecSession`+`StartSpecResult` (existing,
  `session-launch.ts`, dengan opsi `bypassCapacity` dari Task 1), `recordFailure` (existing,
  `notifications.ts`, signature
  `(specId: string, title: string, projectId: string | null, reason: string) => Promise<void>`),
  `flowForSource` (existing, `@hanoman/shared`), `prisma.spec.findMany` (existing).
- Produces: `resumeReconciledSessions(cutoff: Date, deps?: ResumeDeps): Promise<ResumeReport>`
  dengan `ResumeReport = { resumed: string[]; failed: string[] }` dan
  `ResumeDeps = { startSpec: (spec: Spec) => Promise<StartSpecResult>; recordFail: (specId: string, title: string, projectId: string | null, reason: string) => Promise<void> }`.
  Dipakai Task 4 (`server.ts`) tanpa argumen `deps` (memakai default produksi).

- [ ] **Step 1: Tulis test yang gagal dulu**

Buat `server/test/session-boot-resume.test.ts`:

```ts
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { beginSession, reconcileHistory } from "../src/services/session-history";
import { resumeReconciledSessions, type ResumeDeps } from "../src/services/session-boot-resume";

const PROJECT_ID = "boot-resume-proj";

const seedSpec = (over: Partial<Parameters<typeof prisma.spec.create>[0]["data"]> = {}) =>
  prisma.spec.create({
    data: {
      id: "SPEC-9101", projectId: PROJECT_ID, title: "Judul", source: "brief",
      stage: "executing", priority: "sedang", author: "t", objective: "o", ...over,
    },
  });

const clean = async () => {
  await prisma.notification.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.sessionHistory.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.spec.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
};

beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: PROJECT_ID, name: "Boot resume", desc: "", kind: "existing" } });
});
afterAll(clean);

const reconciledFor = async (specId: string) => {
  await beginSession({
    sessionId: specId.toLowerCase(), projectId: PROJECT_ID, specId, flow: "feature",
    kind: "spec", agent: "claude", cwd: `/repo/.worktrees/${specId.toLowerCase()}`,
  });
};

describe("resumeReconciledSessions (ADR-0169)", () => {
  it("melanjutkan kandidat yang stage-nya belum done, melewati yang sudah done", async () => {
    await seedSpec({ id: "SPEC-9101", stage: "executing" });
    await seedSpec({ id: "SPEC-9102", stage: "done" });
    await reconciledFor("SPEC-9101");
    await reconciledFor("SPEC-9102");
    const cutoff = new Date();
    expect(await reconcileHistory([])).toBe(2);

    const started: string[] = [];
    const deps: ResumeDeps = {
      startSpec: async (spec) => { started.push(spec.id); return { id: spec.id }; },
      recordFail: async () => { throw new Error("tak boleh dipanggil"); },
    };
    const report = await resumeReconciledSessions(cutoff, deps);
    expect(report).toEqual({ resumed: ["SPEC-9101"], failed: [] });
    expect(started).toEqual(["SPEC-9101"]);
  });

  it("kegagalan satu kandidat tak menghentikan yang lain, tercatat sebagai gagal", async () => {
    await seedSpec({ id: "SPEC-9101", stage: "executing" });
    await seedSpec({ id: "SPEC-9103", stage: "spec-ready" });
    await reconciledFor("SPEC-9101");
    await reconciledFor("SPEC-9103");
    const cutoff = new Date();
    await reconcileHistory([]);

    const failedReasons: string[] = [];
    const deps: ResumeDeps = {
      startSpec: async (spec) => {
        if (spec.id === "SPEC-9101") throw new Error("worktree rusak");
        return { id: spec.id };
      },
      recordFail: async (specId, _title, _projectId, reason) => { failedReasons.push(`${specId}:${reason}`); },
    };
    const report = await resumeReconciledSessions(cutoff, deps);
    expect(report.resumed).toEqual(["SPEC-9103"]);
    expect(report.failed).toEqual(["SPEC-9101"]);
    expect(failedReasons).toHaveLength(1);
    expect(failedReasons[0]).toContain("worktree rusak");
  });

  it("tak ada kandidat → deps sama sekali tak dipanggil", async () => {
    const cutoff = new Date();
    const startSpec = vi.fn();
    const recordFail = vi.fn();
    const report = await resumeReconciledSessions(cutoff, { startSpec, recordFail });
    expect(report).toEqual({ resumed: [], failed: [] });
    expect(startSpec).not.toHaveBeenCalled();
    expect(recordFail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server vitest run session-boot-resume.test.ts --no-file-parallelism`
Expected: FAIL — modul `../src/services/session-boot-resume` belum ada.

- [ ] **Step 3: Implementasi**

Buat `server/src/services/session-boot-resume.ts`:

```ts
// ADR-0169 · auto-resume sesi backlog yang tadinya berjalan lalu terputus paksa (reboot OS,
// tmux/proses crash, tmux dibunuh manual). Dipanggil SEKALI saat boot, sesudah reconcileHistory()
// menutup baris yang panenya lenyap. Jalur peluncurannya PERSIS startSpecSession (ADR-0084,
// keadaan `resume`) — tak ada mekanisme baru, hanya pemicunya yang jadi otomatis.
import type { Spec } from "@prisma/client";
import { flowForSource } from "@hanoman/shared";
import { prisma } from "../db";
import { reconciledSpecIdsSince } from "./session-history";
import { startSpecSession, type StartSpecResult } from "./session-launch";
import { recordFailure } from "./notifications";

export type ResumeDeps = {
  startSpec: (spec: Spec) => Promise<StartSpecResult>;
  recordFail: (specId: string, title: string, projectId: string | null, reason: string) => Promise<void>;
};

const prodDeps: ResumeDeps = {
  // ADR-0169 · `bypassCapacity: true` — SATU-SATUNYA jalur yang melewati cap ADR-0161; gerbang
  // dependency ADR-0093 TETAP berlaku (tak diberi `force`). Keputusan sadar risiko: mesin 8 GB
  // operator sudah pernah kernel panic akibat sesi paralel berlebih (memori
  // mac-mini-8gb-panic-agen-paralel) — operator memilih "semua kembali" di atas throttle.
  startSpec: (spec) => startSpecSession(spec, { flow: flowForSource(spec.source), bypassCapacity: true }),
  recordFail: recordFailure,
};

export type ResumeReport = { resumed: string[]; failed: string[] };

export async function resumeReconciledSessions(cutoff: Date, deps: ResumeDeps = prodDeps): Promise<ResumeReport> {
  const report: ResumeReport = { resumed: [], failed: [] };
  const specIds = await reconciledSpecIdsSince(cutoff);
  if (!specIds.length) return report;
  // stage "done" · item sudah selesai sebelum reboot, tak perlu dilanjutkan meski baris
  // riwayatnya kena reconcile (mis. sesi ditutup tepat saat mesin mati).
  const specs = await prisma.spec.findMany({ where: { id: { in: specIds }, stage: { not: "done" } } });
  // Berurutan — bukan Promise.all: operasi worktree/git antar item tak boleh saling tabrak
  // (rebuild worktree dari headSha, dsb). Murni menghindari race, BUKAN throttle kapasitas —
  // kapasitas sudah sengaja dilewati lewat bypassCapacity di atas.
  for (const spec of specs) {
    try {
      await deps.startSpec(spec);
      report.resumed.push(spec.id);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await deps.recordFail(spec.id, spec.title, spec.projectId, `gagal dilanjutkan otomatis — ${reason}`);
      report.failed.push(spec.id);
    }
  }
  return report;
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server vitest run session-boot-resume.test.ts --no-file-parallelism`
Expected: PASS, 3 test hijau.

- [ ] **Step 5: Typecheck paket server**

Run: `pnpm --filter ./server typecheck`
Expected: nol error.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/session-boot-resume.ts server/test/session-boot-resume.test.ts
git commit -m "$(cat <<'EOF'
feat(session-boot-resume): auto-resume sesi yang direkonsiliasi saat boot

resumeReconciledSessions() memanggil jalur resume startSpecSession
(ADR-0084) untuk tiap backlog yang tadinya berjalan lalu terputus
paksa, dengan bypassCapacity (ADR-0169). Kegagalan per item dicatat
notifikasi tanpa menghentikan kandidat lain.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wiring ke boot sequence `server.ts`

**Files:**
- Modify: `server/src/server.ts:10` (import) dan `:128-143` (blok reconcile boot)

**Interfaces:**
- Consumes: `resumeReconciledSessions` (Task 3), `reconcileHistory` (existing, tak berubah).
- Produces: tidak ada — titik integrasi akhir, hanya dipanggil dari boot sequence proses.

- [ ] **Step 1: Tambah import**

Di `server/src/server.ts`, sesudah baris 10 (`import { installSessionHistory, reconcileHistory }
from "./services/session-history";`), tambahkan:

```ts
import { resumeReconciledSessions } from "./services/session-boot-resume";
```

- [ ] **Step 2: Ganti blok reconcile boot**

Cari blok ini (sekitar baris 128-137):

```ts
  try {
    const liveIds = listSessions().map((s) => s.id);
    void reconcileHistory(liveIds)
      .then(async (n) => {
        if (n) console.log(`riwayat sesi: ${n} baris berjalan direkonsiliasi`);
        for (const row of await detectOrphanWorktrees()) {
          console.log(`worktree yatim: ${row.projectId} — ${row.count} menunggu konfirmasi di tab Worktrees`);
        }
      })
      .catch((e) => console.error("rekonsiliasi riwayat sesi:", e));
```

Ganti persis dengan:

```ts
  try {
    const liveIds = listSessions().map((s) => s.id);
    // ADR-0169 · cutoff diambil SEBELUM reconcileHistory() menulis — reconcileHistory menstempel
    // SATU `reconciledAt` untuk seluruh sapuannya, jadi reconciledSpecIdsSince(cutoff) di dalam
    // resumeReconciledSessions() menangkap TEPAT sapuan boot ini, bukan reconcile lama.
    const reconcileCutoff = new Date();
    void reconcileHistory(liveIds)
      .then(async (n) => {
        if (n) console.log(`riwayat sesi: ${n} baris berjalan direkonsiliasi`);
        for (const row of await detectOrphanWorktrees()) {
          console.log(`worktree yatim: ${row.projectId} — ${row.count} menunggu konfirmasi di tab Worktrees`);
        }
        // ADR-0169 · begitu baris ditutup, backlog yang tadinya berjalan langsung dicoba
        // dilanjutkan otomatis — TANPA menunggu klik "Lanjutkan" manusia.
        if (n) {
          const { resumed, failed } = await resumeReconciledSessions(reconcileCutoff);
          if (resumed.length)
            console.log(`auto-resume: ${resumed.length} sesi dilanjutkan otomatis (${resumed.join(", ")})`);
          if (failed.length)
            console.log(`auto-resume: ${failed.length} sesi gagal dilanjutkan otomatis, lihat notifikasi (${failed.join(", ")})`);
        }
      })
      .catch((e) => console.error("rekonsiliasi riwayat sesi:", e));
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter ./server typecheck`
Expected: nol error.

- [ ] **Step 4: Commit**

```bash
git add server/src/server.ts
git commit -m "$(cat <<'EOF'
feat(server): panggil auto-resume sesi sesudah reconcile boot (ADR-0169)

Sesi yang tadinya berjalan lalu ditemukan lenyap saat boot (reboot OS,
crash, tmux dibunuh manual) kini otomatis dilanjutkan lewat jalur
resume yang sudah ada — bukan hanya ditutup baris riwayatnya.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ADR-0169 + tautan index docs

**Files:**
- Create: `internal/docs/adr/0169-auto-resume-sesi-setelah-boot.md`
- Modify: `internal/docs/README.md:114` (sisipkan bullet ADR baru di puncak `## adr`)

**Interfaces:**
- Consumes: tidak ada (dokumentasi murni).
- Produces: tidak ada.

- [ ] **Step 1: Tulis ADR-0169**

Buat `internal/docs/adr/0169-auto-resume-sesi-setelah-boot.md`:

```markdown
# ADR-0169 — Sesi backlog yang direkonsiliasi saat boot dilanjutkan otomatis

- Status: Accepted
- Tanggal: 2026-09-22
- SPEC: — (brainstorm langsung di sesi Claude Code, bukan lewat backlog hanoman)
- Terkait: melengkapi [0084](0084-melanjutkan-sesi-backlog.md) (jalur `resume` dipakai apa
  adanya, tak ada mekanisme peluncuran baru),
  [0079](0079-history-sesi-terminal-store-lokal-plus-transkrip.md) &
  [0125](0125-akhir-sesi-riwayat-tercatat.md) (`reconcileHistory`,
  `endedReason: "reconciled"`). **Mengamandemen**
  [0161](0161-gerbang-peluncuran-sesi-cap-dan-sumber-daya.md): gerbang kapasitas DILEWATI
  khusus jalur ini, lewat opsi baru `bypassCapacity` — **bukan** `force`. Menegakkan
  [0093](0093-dependency-antar-backlog.md): gerbang dependency TETAP berlaku di jalur ini,
  sengaja tak ikut dilewati.

## Konteks

Sesi agen hidup di daemon tmux terpisah dari proses Node (ADR-0016). Restart proses hanoman
saja (update, crash Node) sudah aman — tmux tak ikut mati. Yang belum aman: reboot OS penuh
mematikan tmux daemon itu sendiri. Saat hanoman boot lagi, `reconcileHistory()`
(`session-history.ts:208`) sudah membedakan dengan tepat sesi yang **dihentikan manusia**
(menutup baris riwayatnya sendiri sebelum shutdown) dari sesi yang **terputus paksa** (baris
masih `endedAt: null` saat boot berikutnya, ditutup `endedReason: "reconciled"`) — tapi ia
hanya menutup baris, tak menyalakan apa pun kembali. Operator harus sadar dan klik "Lanjutkan"
manual per backlog lewat jalur `resume` (ADR-0084).

Riset menemukan mesin operator (Mac mini M2, 8 GB) sudah dua kali kernel panic tepat akibat
beban sesi paralel berlebih — bukti forensiknya berupa baris `SessionHistory`
`endedReason: 'reconciled'` massal tepat setelah reboot (lihat memori project
`mac-mini-8gb-panic-agen-paralel`), pola yang identik dengan skenario yang ADR ini tangani
pemulihannya. Operator diberi tahu risiko ini secara eksplisit dan tetap memilih auto-resume
tanpa batas kapasitas.

Ditemukan juga bahwa gerbang kapasitas (ADR-0161) dan gerbang dependency antar-backlog
(ADR-0093) sama-sama dikontrol satu flag `opts.force` di `startSpecSession()` — tak ada cara
melewati salah satu tanpa yang lain lewat API yang ada sebelum ADR ini.

## Keputusan

1. **Sinyal deteksi tanpa mekanisme baru.** `reconciledSpecIdsSince(cutoff)`
   (`session-history.ts`) membaca specId dari baris yang baru ditutup `reconciled` PADA SAPUAN
   BOOT INI (`reconciledAt >= cutoff`, `cutoff` diambil tepat sebelum `reconcileHistory()`
   dipanggil). Itulah himpunan kandidat resume — persis "sesi yang tadinya hidup lalu terputus
   paksa", apa pun sebabnya (reboot, crash, tmux dibunuh manual).
2. **Filter stage.** Hanya kandidat yang `Spec.stage !== "done"` yang dicoba — item yang sudah
   selesai sebelum reboot tak perlu dilanjutkan meski baris riwayatnya kena reconcile.
3. **Eksekusi lewat jalur yang sama persis dengan "Lanjutkan" manusia.**
   `resumeReconciledSessions()` (`session-boot-resume.ts`) memanggil `startSpecSession()`
   (ADR-0084) berurutan (bukan paralel — murni menghindari operasi git/worktree saling
   tabrak, bukan throttle kapasitas) untuk tiap kandidat.
4. **Kapasitas dilewati, dependency TIDAK.** `startSpecSession()` mendapat opsi baru
   `opts.bypassCapacity`, diteruskan ke `withSessionAdmission({ force: opts.force ||
   opts.bypassCapacity })` — melewati HANYA gerbang kapasitas/beban host ADR-0161.
   `if (!opts.force)` di sekitar `blockersForSpec()` (gerbang dependency ADR-0093) TIDAK
   disentuh: auto-resume hanya mengirim `bypassCapacity: true`, tidak pernah `force: true`.
   Item yang dependency-nya belum ter-merge tetap diblokir seperti biasa.
5. **Kegagalan per item tidak menghentikan yang lain.** Ditangkap, dicatat via
   `recordFailure()` (notifikasi yang sudah ada, `"Gagal: <title> — <reason>"`), lanjut ke
   kandidat berikutnya. Tanpa retry otomatis — fallback-nya tombol "Lanjutkan" manual yang
   sudah ada.
6. **Full otomatis, tanpa konfirmasi.** Tak ada toggle setting, tak ada banner "Lanjutkan
   semua?" — begitu server boot dan menemukan kandidat, langsung dicoba.
7. **Di luar scope.** Memastikan proses hanoman sendiri auto-start saat OS boot
   (launchd/systemd) — dianggap sudah/akan diatur manual per mesin, bukan bagian ADR ini.

## Konsekuensi

**Positif:** reboot atau crash tak lagi berarti operator harus mengingat dan mengklik ulang
tiap backlog yang sedang jalan — jalur yang sudah teruji (ADR-0084) kini dipicu otomatis alih-alih
menunggu manusia.

**Risiko diterima secara sadar:** pada mesin 8 GB yang sudah pernah kernel panic akibat sesi
paralel berlebih, auto-resume yang melewati cap `maxConcurrent` bisa memicu kondisi yang sama
lagi bila banyak sesi hidup bersamaan saat reboot terjadi — operator memilih ini secara eksplisit
di atas alternatif "taati cap, sisanya notifikasi manual" saat brainstorming (lihat
[spec](../../docs/superpowers/specs/2026-09-22-auto-resume-sesi-setelah-restart-design.md)).
Mitigasinya bukan kode — bila pola ini terbukti memicu panic lagi, keputusan #4 di atas
diamandemen ADR baru, bukan diam-diam diubah di kode.

**Yang TIDAK berubah:** `force: true` (jalur manusia, `POST /terminal/sessions`) tetap melewati
keduanya (kapasitas + dependency) seperti sebelum ADR ini — `bypassCapacity` adalah opsi
tambahan, bukan pengganti.
```

- [ ] **Step 2: Tautkan di index docs**

Di `internal/docs/README.md`, sisipkan baris baru TEPAT SESUDAH baris `## adr` (baris 114) dan
SEBELUM baris `- [0168 — …]` (baris 115) — jadi ADR-0169 muncul paling atas (terbaru):

```markdown
- [0169 — Sesi backlog yang direkonsiliasi saat boot dilanjutkan otomatis](adr/0169-auto-resume-sesi-setelah-boot.md) — **mengamandemen 0161** (kapasitas dilewati lewat opsi baru `bypassCapacity`, TERPISAH dari `force` — gerbang dependency 0093 tetap berlaku), melengkapi 0084 (jalur `resume` dipakai apa adanya). `reconciledSpecIdsSince()` menurunkan kandidat dari sapuan `reconcileHistory()` yang sudah ada, `resumeReconciledSessions()` memanggil `startSpecSession()` berurutan per kandidat, kegagalan per item dicatat notifikasi tanpa menghentikan yang lain. Design: [rancangan auto-resume sesi](../../docs/superpowers/specs/2026-09-22-auto-resume-sesi-setelah-restart-design.md)
```

- [ ] **Step 3: Commit**

```bash
git add internal/docs/adr/0169-auto-resume-sesi-setelah-boot.md internal/docs/README.md
git commit -m "$(cat <<'EOF'
docs(adr): ADR-0169 auto-resume sesi setelah boot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verifikasi manual boot end-to-end

**Files:** tidak ada file diubah — langkah verifikasi manual sesuai Definition of Done AGENTS.md
(fitur ini tak menambah endpoint HTTP, jadi verifikasinya lewat log boot, bukan curl).

**Interfaces:**
- Consumes: seluruh hasil Task 1-4 terpasang di working tree.
- Produces: bukti tertulis (log) bahwa boot sungguhan memicu auto-resume, dilampirkan di ringkasan
  penyelesaian task ini (bukan file baru).

- [ ] **Step 1: Siapkan DB test terisolasi**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/hanoman-verify.db"
export HANOMAN_HOME="$(mktemp -d)"
```

- [ ] **Step 2: Migrate DB verifikasi**

Run: `pnpm --filter ./server exec prisma migrate deploy --schema server/prisma/schema.prisma`
Expected: migration sukses, nol error.

- [ ] **Step 3: Suntik satu baris `SessionHistory` "berjalan" + `Spec` yang belum `done`**

Buat skrip sekali-pakai `/tmp/seed-boot-verify.mjs` (di luar repo, scratch):

```js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
await prisma.project.create({ data: { id: "verify-boot", name: "Verify", desc: "", kind: "existing" } });
await prisma.spec.create({ data: {
  id: "SPEC-VERIFY-1", projectId: "verify-boot", title: "Verifikasi boot",
  source: "brief", stage: "executing", priority: "sedang", author: "t", objective: "o",
} });
await prisma.sessionHistory.create({ data: {
  id: "verify-row-1", sessionId: "spec-verify-1", projectId: "verify-boot", specId: "SPEC-VERIFY-1",
  kind: "spec", agent: "claude", flow: "feature", cwd: "/tmp/tidak-relevan",
} }); // endedAt: null → "berjalan", tmux-nya sengaja TIDAK ada → boot akan menemukannya lenyap
console.log("seeded");
await prisma.$disconnect();
```

Run: `node /tmp/seed-boot-verify.mjs`
Expected: cetak `seeded`.

- [ ] **Step 4: Boot server, amati log**

Run: `pnpm --filter ./server dev` (atau `node server/dist/server.js` bila sudah dibuild), biarkan
±10 detik, lalu hentikan (Ctrl-C).
Expected di log:
- `riwayat sesi: 1 baris berjalan direkonsiliasi`
- **salah satu** dari:
  - `auto-resume: 1 sesi dilanjutkan otomatis (SPEC-VERIFY-1)` — bila worktree berhasil dibangun
    (bergantung `HANOMAN_HOME`/git tersedia di lingkungan verifikasi), **atau**
  - `auto-resume: 1 sesi gagal dilanjutkan otomatis, lihat notifikasi (SPEC-VERIFY-1)` — bila
    gagal karena `project "verify-boot" belum di-bind ke checkout lokal` (project verifikasi ini
    memang tak punya checkout nyata). Keduanya sah sebagai bukti jalur TERPANGGIL; yang penting
    baris log auto-resume muncul sama sekali, bukan hasilnya sukses/gagal.

Kalau TIDAK ADA baris `auto-resume:` sama sekali → bug di wiring Task 4, perbaiki sebelum lanjut.

- [ ] **Step 5: Bersihkan**

```bash
rm -f /tmp/seed-boot-verify.mjs
unset TEST_DATABASE_URL HANOMAN_HOME
```

- [ ] **Step 6: Laporkan hasil**

Tulis satu paragraf di ringkasan penyelesaian task ini: log baris mana yang benar-benar muncul,
dan konfirmasi bahwa itu membuktikan wiring boot → auto-resume berjalan pada instance sungguhan.
Tidak ada commit di task ini (tak ada file diubah).

---

## Self-review checklist (sudah dijalankan penulis plan)

- **Cakupan spec:** keenam "Keputusan yang dikunci saat brainstorming" di spec (scope restart+reboot →
  Task 4; full otomatis tanpa konfirmasi → Task 3/4; auto-start proses di luar scope → tak ada task;
  kapasitas diabaikan sadar risiko → Task 1/3/ADR §Konsekuensi; kegagalan lewati+notifikasi → Task 3)
  semuanya punya task. Auto-start proses OS (di luar scope) sengaja TIDAK punya task.
- **Placeholder:** nol `TBD`/`TODO`; tiap step code lengkap, bisa disalin langsung.
- **Konsistensi tipe:** `ResumeDeps`/`ResumeReport` didefinisikan sekali (Task 3 Step 3) dan dipakai
  identik di test (Task 3 Step 1) dan di ADR (§Keputusan poin 3). `bypassCapacity` nama yang sama di
  Task 1 (definisi), Task 3 (pemakaian di `prodDeps`), dan ADR.
