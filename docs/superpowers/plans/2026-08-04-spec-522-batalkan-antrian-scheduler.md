# SPEC-522 — Batalkan antrian di scheduler · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator bisa membatalkan item antrean scheduler dari panel; item yang dibatalkan berhenti dijadwalkan, statusnya terlihat jelas, dan bisa dikembalikan ke antrean.

**Architecture:** `SchedulerQueueItem.status` mendapat nilai kelima `canceled` (kolom `String` → **tanpa migration**). Barisnya jadi **tombstone**: `enqueue()` memakai `upsert` ber-`update:{}` sehingga checker `backlog` tak bisa menghidupkannya lagi. Dua endpoint POST di bawah prefix `/scheduler` (capability turunan peta yang sudah ada), keduanya **CAS** (`updateMany` ber-`where` status) sehingga janji "item bersesi aktif tak dibatalkan" tak bisa dilanggar balapan. Governor mendapat dua gerbang supaya pembatalan tak kalah balapan dengan drain.

**Tech Stack:** Node + TypeScript (Fastify), Prisma 6 + SQLite, React + TypeScript (Vite), Vitest, zod.

## Global Constraints

- **Tanpa migration.** `status` sudah `String`; hanya komentarnya yang diperbarui. Jangan menambah kolom.
- **Tanpa perubahan `agent-capabilities.ts`.** Kedua endpoint hidup di bawah `/api/scheduler/...`; `top === "scheduler"` → `rw("settings")` sudah memetakan POST ke `settings:write`.
- **Sesi hidup tak pernah dibunuh.** Tak ada `killSession` di mana pun dalam perubahan ini.
- **Bahasa pesan & komentar: Indonesia** (mengikuti berkas yang disentuh). Kode & nama simbol tetap Inggris.
- Nilai status baru dieja persis **`canceled`** (satu `l`), di server, shared, dan UI.
- Note pembatalan dieja persis **`dibatalkan operator`** (tanpa reason) atau **`dibatalkan operator: <reason>`**.
- Test server WAJIB dijalankan dengan `--no-file-parallelism` **dan** `TEST_DATABASE_URL` sendiri:
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (SPEC-479 — sesi tetangga menghapus DB bersama di tengah run).
- Test web WAJIB `env -u NODE_ENV` (shell sesi ini menunjuk production → RTL `act` gagal massal).

---

### Task 1: Layer antrean — CAS batal/antre-ulang + `markLaunched` jadi CAS

**Files:**
- Modify: `server/src/services/scheduler/queue.ts`
- Modify: `server/prisma/schema.prisma:402` (komentar kosakata `status`)
- Test: `server/test/scheduler-queue.service.test.ts`

**Interfaces:**
- Consumes: `prisma` dari `../../db`; `enqueue`, `queued`, `listQueue`, `queueItemForSpec` yang sudah ada.
- Produces:
  - `markCanceled(id: string, note: string): Promise<boolean>` — `true` bila baris `queued` berubah jadi `canceled`.
  - `markRequeued(id: string): Promise<boolean>` — `true` bila baris `canceled` berubah jadi `queued` (`note` dikosongkan).
  - `isQueued(id: string): Promise<boolean>`
  - `markLaunched(id: string, sessionId: string): Promise<boolean>` — **berubah tanda tangan** dari `Promise<void>`.
  - `noteRow(id: string, note: string): Promise<void>` — **rename** dari `noteQueued` (perilaku sama: tulis `note` tanpa menyentuh `status`, hanya bila berubah).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `describe("scheduler queue", …)` pada `server/test/scheduler-queue.service.test.ts`, dan perbarui baris import di atas berkas menjadi:

```ts
import { enqueue, listQueue, queued, markLaunched, markFailed, queueItemForSpec,
  markCanceled, markRequeued, isQueued } from "../src/services/scheduler/queue";
```

```ts
  // SPEC-522 · pembatalan adalah CAS, bukan baca-lalu-tulis: antara membaca baris dan menulisnya
  // governor bisa meluncurkannya, dan janji "item bersesi aktif tak dibatalkan" akan jadi sekadar
  // niat baik. Buktinya = penolakan atas baris non-`queued`, bukan bentuk baris hasil.
  it("markCanceled hanya menerima baris queued", async () => {
    await enqueue({ specId: "SPEC-c1", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-c1"))!;
    expect(await markCanceled(row.id, "dibatalkan operator")).toBe(true);
    expect((await queueItemForSpec("SPEC-c1"))!.status).toBe("canceled");
    expect((await queueItemForSpec("SPEC-c1"))!.note).toBe("dibatalkan operator");
    // dua kali → CAS kedua gagal (idempotensi terbaca, bukan diam-diam menulis ulang)
    expect(await markCanceled(row.id, "lagi")).toBe(false);
    expect((await queueItemForSpec("SPEC-c1"))!.note).toBe("dibatalkan operator");
  });

  it("markCanceled MENOLAK baris launched — sesi hidup tak pernah tersentuh pembatalan", async () => {
    await enqueue({ specId: "SPEC-c2", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-c2"))!;
    await markLaunched(row.id, "spec_c2");
    expect(await markCanceled(row.id, "dibatalkan operator")).toBe(false);
    expect((await queueItemForSpec("SPEC-c2"))!.status).toBe("launched");
    expect((await queueItemForSpec("SPEC-c2"))!.sessionId).toBe("spec_c2");
  });

  it("markLaunched adalah CAS: baris yang dibatalkan tak bisa ditimpa jadi launched", async () => {
    await enqueue({ specId: "SPEC-c3", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-c3"))!;
    expect(await markCanceled(row.id, "dibatalkan operator")).toBe(true);
    expect(await markLaunched(row.id, "spec_c3")).toBe(false);
    expect((await queueItemForSpec("SPEC-c3"))!.status).toBe("canceled");
    expect((await queueItemForSpec("SPEC-c3"))!.sessionId).toBeNull();
  });

  it("baris canceled keluar dari queued() dan isQueued()", async () => {
    await enqueue({ specId: "SPEC-c4", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-c4"))!;
    expect(await isQueued(row.id)).toBe(true);
    await markCanceled(row.id, "dibatalkan operator");
    expect(await isQueued(row.id)).toBe(false);
    expect((await queued()).length).toBe(0);
    expect(await isQueued("tak-ada")).toBe(false);
  });

  // Inti janji "berhenti dijadwalkan": checker `backlog` memanggil `enqueue` lagi pada cadence
  // berikutnya untuk spec yang sama (ia masih cocok UNSTARTED_SPEC_WHERE). `upsert` ber-`update:{}`
  // yang membuat tombstone-nya menang — kalau baris ini dihapus alih-alih ditandai, pembatalan
  // akan membatalkan dirinya sendiri dalam ≤1 cadence.
  it("enqueue TIDAK menghidupkan kembali baris yang dibatalkan", async () => {
    await enqueue({ specId: "SPEC-c5", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-c5"))!;
    await markCanceled(row.id, "dibatalkan operator");
    await enqueue({ specId: "SPEC-c5", projectId: "p1", source: "backlog", priority: "tinggi" });
    expect((await queueItemForSpec("SPEC-c5"))!.status).toBe("canceled");
    expect((await listQueue()).length).toBe(1);
    expect((await queued()).length).toBe(0);
  });

  it("markRequeued mengembalikan baris canceled ke antrean dan mengosongkan note", async () => {
    await enqueue({ specId: "SPEC-c6", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-c6"))!;
    await markCanceled(row.id, "dibatalkan operator: salah project");
    expect(await markRequeued(row.id)).toBe(true);
    const back = (await queueItemForSpec("SPEC-c6"))!;
    expect(back.status).toBe("queued");
    expect(back.note).toBeNull();
    expect((await queued()).map((q) => q.specId)).toEqual(["SPEC-c6"]);
    // baris yang sudah queued tak bisa di-requeue lagi
    expect(await markRequeued(row.id)).toBe(false);
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/scheduler-queue.service.test.ts
```

Expected: FAIL — `markCanceled is not a function` / `markRequeued is not a function` / `isQueued is not a function` (kegagalan import saat modul dimuat).

- [ ] **Step 3: Implementasi minimal di `server/src/services/scheduler/queue.ts`**

Ganti `markLaunched` yang ada (baris 48–50) dengan versi CAS:

```ts
// SPEC-522 · CAS, bukan `update` polos: operator bisa membatalkan baris ini SELAGI `launch()`
// men-spawn worktree + sesi tmux (hitungan detik). `update` polos akan menimpa `canceled` jadi
// `launched` secara senyap — operator menekan Batalkan, UI membenarkannya, lalu keadaan berbalik
// sendiri. `false` = pembatalan menang; pemanggil yang memutuskan apa yang dicatat tentang sesi
// yang telanjur lahir.
export async function markLaunched(id: string, sessionId: string): Promise<boolean> {
  const { count } = await prisma.schedulerQueueItem.updateMany({
    where: { id, status: "queued" },
    data: { status: "launched", sessionId, launchedAt: new Date() },
  });
  return count > 0;
}
```

Ganti nama `noteQueued` (baris 71–75) jadi `noteRow` beserta komentarnya:

```ts
// SPEC-447 · ADR-0093 · alasan sebuah baris DIAM di antrean, tanpa mengubah statusnya — dan sejak
// SPEC-522 juga catatan sesi yatim pada baris `canceled`, jadi namanya bukan lagi `noteQueued`.
// Ditulis HANYA saat berubah: governor berdenyut tiap 10 detik, dan menulis note identik tiap tick
// berarti ~8.640 write/hari untuk informasi yang sama.
export async function noteRow(id: string, note: string): Promise<void> {
  const row = await prisma.schedulerQueueItem.findUnique({ where: { id }, select: { note: true } });
  if (row?.note === note) return;
  await prisma.schedulerQueueItem.update({ where: { id }, data: { note } });
}
```

Tambahkan di akhir berkas:

```ts
// SPEC-522 · pembatalan & pengembalian sebuah baris antrean. Keduanya **CAS** (`updateMany`
// ber-`where` status = satu pernyataan SQL bersyarat), bukan baca-lalu-`if`-lalu-tulis: di antara
// dua pernyataan itu governor bisa meluncurkan barisnya, dan kendala "item yang sudah punya sesi
// aktif tak boleh dibunuh diam-diam" akan jadi sekadar niat baik. `false` = transisinya ditolak;
// pemanggil membaca ulang statusnya untuk menyusun alasan.
//
// `canceled` adalah TOMBSTONE, bukan penghapusan: `enqueue()` memakai `upsert` ber-`update:{}`,
// jadi checker `backlog` yang menjumpai spec yang sama pada cadence berikutnya tak bisa
// menghidupkannya. Menghapus barisnya justru akan membuat pembatalan membatalkan dirinya sendiri
// (spec-nya masih cocok `UNSTARTED_SPEC_WHERE`). Pola yang sama dipakai SPEC-431 (`markDone` +
// `ALREADY_DONE_NOTE`) untuk menutup baris basi.
export async function markCanceled(id: string, note: string): Promise<boolean> {
  const { count } = await prisma.schedulerQueueItem.updateMany({
    where: { id, status: "queued" }, data: { status: "canceled", note },
  });
  return count > 0;
}
export async function markRequeued(id: string): Promise<boolean> {
  const { count } = await prisma.schedulerQueueItem.updateMany({
    where: { id, status: "canceled" }, data: { status: "queued", note: null },
  });
  return count > 0;
}

// SPEC-522 · gerbang pra-proses governor: `drain()` mengambil snapshot `queued()` SEKALI lalu
// memproses itemnya berurutan, dan tiap peluncuran men-spawn worktree + sesi tmux (hitungan
// detik) — item di posisi ke-N bisa duduk puluhan detik di dalam loop sesudah snapshotnya diambil.
export async function isQueued(id: string): Promise<boolean> {
  const row = await prisma.schedulerQueueItem.findUnique({ where: { id }, select: { status: true } });
  return row?.status === "queued";
}
```

Perbarui komentar kosakata di `server/prisma/schema.prisma` baris 402:

```prisma
  status     String    @default("queued") // queued | launched | done | failed | canceled (SPEC-522 · tombstone operator)
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/scheduler-queue.service.test.ts
```

Expected: PASS, dan jumlah test bertambah 6 (11 total). **Jangan** terima "no test files" sebagai bukti.

Berkas ini belum bisa di-typecheck sendirian: `governor.ts` masih mengimpor `noteQueued`. Itu diperbaiki di Task 2.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler/queue.ts server/prisma/schema.prisma server/test/scheduler-queue.service.test.ts
git commit -m "feat(spec-522): status canceled + CAS batal/antre-ulang di antrean scheduler"
```

---

### Task 2: Governor — dua gerbang supaya pembatalan tak kalah balapan

**Files:**
- Modify: `server/src/services/scheduler/governor.ts`
- Test: `server/test/scheduler-governor.test.ts`

**Interfaces:**
- Consumes: `markCanceled`, `isQueued`, `noteRow`, `markLaunched` (kini `Promise<boolean>`) dari Task 1.
- Produces: `canceledRaceNote(sessionId: string): string` diekspor dari `governor.ts` (dipakai test; UI hanya merender `note` apa adanya).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `describe("governor.drain", …)` pada `server/test/scheduler-governor.test.ts`, dan perbarui dua baris import di atas berkas menjadi:

```ts
import { enqueue, queueItemForSpec, listQueue, markCanceled } from "../src/services/scheduler/queue";
import { drain, canceledRaceNote, type GovernorDeps } from "../src/services/scheduler/governor";
```

```ts
  // SPEC-522 · gerbang PERTAMA. `queued()` sudah menyaring `canceled`, tapi itu snapshot: drain
  // memproses item berurutan dan tiap spawn hitungan detik, jadi baris di ekor daftar bisa
  // dibatalkan SESUDAH snapshotnya diambil. Dibatalkan dari dalam `launch` item pertama =
  // simulasi tepat dari operator yang menekan Batalkan selagi drain bekerja.
  it("tak meluncurkan baris yang dibatalkan sesudah snapshot antrean diambil", async () => {
    await enqueue({ specId: "SPEC-first", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-late", projectId: "p1", source: "backlog", priority: "sedang" });
    const late = (await queueItemForSpec("SPEC-late"))!;
    const launched: string[] = [];
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null, isDone: async () => false, blockers: async () => [],
      launch: async (item) => {
        launched.push(item.specId);
        if (item.specId === "SPEC-first") await markCanceled(late.id, "dibatalkan operator");
        return `s_${item.specId}`;
      },
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect(launched).toEqual(["SPEC-first"]);                  // SPEC-late tak pernah di-spawn
    const row = (await queueItemForSpec("SPEC-late"))!;
    expect(row.status).toBe("canceled");                       // statusnya bertahan
    expect(row.sessionId).toBeNull();
  });

  // SPEC-522 · gerbang PERTAMA melindungi SEMUA mutasi di badan loop, bukan hanya `launch`:
  // tanpa itu gerbang "spec sudah selesai" (SPEC-431) menimpa baris canceled jadi `done`.
  it("gerbang spec-sudah-selesai tak menimpa baris yang dibatalkan", async () => {
    await enqueue({ specId: "SPEC-cd", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-cd"))!;
    await markCanceled(row.id, "dibatalkan operator");
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null, isDone: async () => true, blockers: async () => [],
      launch: async () => "s",
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect((await queueItemForSpec("SPEC-cd"))!.status).toBe("canceled");
    expect((await queueItemForSpec("SPEC-cd"))!.note).toBe("dibatalkan operator");
  });

  // SPEC-522 · gerbang KEDUA: sisa jendelanya adalah durasi satu spawn. CAS `markLaunched` yang
  // gagal TIDAK ditelan — sesinya nyata, jadi ia tetap memakan slot dan operator diberi id-nya.
  // Sesi TIDAK dibunuh (kendala: sesi hidup tak pernah dimatikan diam-diam).
  it("pembatalan selama launch menang; sesi yang telanjur lahir dicatat, bukan dibunuh", async () => {
    await enqueue({ specId: "SPEC-race", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-next", projectId: "p1", source: "backlog", priority: "rendah" });
    const race = (await queueItemForSpec("SPEC-race"))!;
    const launched: string[] = [];
    const deps: GovernorDeps = {
      liveCount: () => 0, isLive: () => null, isDone: async () => false, blockers: async () => [],
      launch: async (item) => {
        // dibatalkan DI TENGAH spawn: barisnya masih `queued` saat gerbang pertama lewat
        if (item.specId === "SPEC-race") await markCanceled(race.id, "dibatalkan operator");
        launched.push(item.specId);
        return `s_${item.specId}`;
      },
    };
    await drain(cfg({ maxConcurrent: 1 }), deps);              // satu slot: dipakai sesi SPEC-race
    expect(launched).toEqual(["SPEC-race"]);
    const row = (await queueItemForSpec("SPEC-race"))!;
    expect(row.status).toBe("canceled");                       // TIDAK berbalik jadi launched
    expect(row.sessionId).toBeNull();
    expect(row.note).toBe(canceledRaceNote("s_SPEC-race"));    // operator tahu ada sesi yatim
    expect((await queueItemForSpec("SPEC-next"))!.status).toBe("queued");  // slotnya memang terpakai
    expect((await listQueue("launched")).length).toBe(0);
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/scheduler-governor.test.ts
```

Expected: FAIL — `canceledRaceNote is not exported` (kegagalan import saat modul dimuat).

- [ ] **Step 3: Implementasi di `server/src/services/scheduler/governor.ts`**

Ganti baris import (baris 3):

```ts
import { queued, markLaunched, markFailed, markDone, noteRow, isQueued } from "./queue";
```

Tambahkan konstanta di bawah `ALREADY_DONE_NOTE` (baris 20):

```ts
// SPEC-522 · baris dibatalkan tepat saat sesinya sudah terlanjur lahir (jendela = durasi satu
// spawn). Sesinya TIDAK dibunuh — kendala spec ini berlaku untuk sesi hidup mana pun, dan
// membunuh sesi dari dalam governor menambah permukaan yang tak dibutuhkan. Yang diberikan ke
// operator adalah id-nya, supaya ia bisa menutupnya sendiri dari Terminal.
export const canceledRaceNote = (sessionId: string) =>
  `dibatalkan saat sesi ${sessionId} sudah terlanjur lahir — sesi dibiarkan hidup, tutup dari Terminal bila tak diperlukan`;
```

Di dalam `drain`, tepat sesudah `if (slots <= 0) break;` (baris 32), sisipkan gerbang pertama:

```ts
      // SPEC-522 · gerbang PERTAMA. `queued()` sudah menyaring `canceled`, tapi daftar itu
      // SNAPSHOT: drain memproses itemnya berurutan dan tiap `launch` men-spawn worktree + sesi
      // tmux (hitungan detik), jadi item di ekor daftar bisa duduk puluhan detik di sini sesudah
      // snapshotnya diambil. Dibaca ulang dari DB — pola `isDone` (SPEC-431) & `blockers`
      // (SPEC-447). Ditaruh PALING ATAS, bukan tepat sebelum `launch`, supaya ia melindungi semua
      // mutasi di badan loop: baris `canceled` tak boleh ditimpa jadi `done` oleh gerbang SPEC-431
      // maupun jadi `launched` oleh cabang idempoten `isLive` di bawah. Slot tak terpakai.
      if (!(await isQueued(item.id))) continue;
```

Ganti pemanggilan `noteQueued` (baris 45) jadi `noteRow`:

```ts
      if (blocked.length) { await noteRow(item.id, blockedNote(blocked)); continue; }
```

Ganti blok `try` peluncuran (baris 50–53) jadi:

```ts
      try {
        const sessionId = await deps.launch(item, cfg.autonomy);
        // SPEC-522 · gerbang KEDUA. Sisa jendelanya adalah durasi satu spawn; CAS gagal =
        // operator membatalkan selagi sesinya lahir, dan status `canceled` DIPERTAHANKAN alih-alih
        // ditimpa senyap. Sesinya nyata, jadi `slots--` tetap berlaku — cap concurrency tak boleh
        // dilanggar hanya karena barisnya dibatalkan.
        if (!(await markLaunched(item.id, sessionId))) await noteRow(item.id, canceledRaceNote(sessionId));
        slots--;
      } catch (e) {
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/scheduler-governor.test.ts server/test/scheduler-queue.service.test.ts server/test/scheduler-engine.test.ts server/test/scheduler-reconcile.test.ts
```

Expected: PASS semua (governor 11 test, queue 11 test, engine & reconcile tak berubah).

- [ ] **Step 5: Typecheck server**

```bash
pnpm --filter ./server typecheck
```

Expected: keluar tanpa error. (Ini yang menangkap sisa pemanggil `noteQueued`/`markLaunched` bila ada.)

- [ ] **Step 6: Commit**

```bash
git add server/src/services/scheduler/governor.ts server/test/scheduler-governor.test.ts
git commit -m "feat(spec-522): dua gerbang governor agar pembatalan tak kalah balapan dengan drain"
```

---

### Task 3: Endpoint `cancel` & `requeue`

**Files:**
- Modify: `server/src/routes/scheduler.ts`
- Modify: `shared/src/api.ts:128` (sesudah `schedulerState`)
- Test: `server/test/scheduler.route.test.ts`

**Interfaces:**
- Consumes: `markCanceled`, `markRequeued` dari Task 1.
- Produces:
  - `POST /api/scheduler/queue/:id/cancel` body `{ reason?: string }` → 200 `SchedulerQueueItem` · 400 · 404 · 409 `{ error, status }`
  - `POST /api/scheduler/queue/:id/requeue` (tanpa body) → 200 · 404 · 409
  - `paths.schedulerQueueCancel(id: string): string` · `paths.schedulerQueueRequeue(id: string): string`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `describe("scheduler routes", …)` pada `server/test/scheduler.route.test.ts`, dan perbarui baris import di atas berkas menjadi:

```ts
import { enqueue, queueItemForSpec, markLaunched } from "../src/services/scheduler/queue";
```

```ts
  // SPEC-522 · endpoint pembatalan. Ia satu-satunya jalan keluar dari antrean yang tak menyentuh
  // rem global (Pause/Stop menghentikan SELURUH antrean demi satu baris).
  it("POST /queue/:id/cancel menutup baris queued dan mencatat alasannya", async () => {
    await enqueue({ specId: "SPEC-r1", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-r1"))!;
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel` });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("canceled");
    expect(r.json().note).toBe("dibatalkan operator");
    // dan ia hilang dari antrean yang dibaca panel
    const s = await app.inject({ method: "GET", url: "/api/scheduler/state" });
    expect(s.json().queue.filter((q: any) => q.status === "queued").length).toBe(0);
    expect(s.json().queue.filter((q: any) => q.status === "canceled").length).toBe(1);
  });

  it("POST /queue/:id/cancel menyertakan reason ke dalam note", async () => {
    await enqueue({ specId: "SPEC-r2", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-r2"))!;
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel`,
      payload: { reason: "salah project" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().note).toBe("dibatalkan operator: salah project");
  });

  // Kendala spec: item yang sudah punya sesi aktif tak boleh dibunuh diam-diam. Penolakannya
  // harus MENJELASKAN — "409" telanjang tak bisa ditindaklanjuti operator.
  it("POST /queue/:id/cancel menolak baris launched dengan 409 + status saat ini", async () => {
    await enqueue({ specId: "SPEC-r3", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-r3"))!;
    await markLaunched(row.id, "spec_r3");
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel` });
    expect(r.statusCode).toBe(409);
    expect(r.json().status).toBe("launched");
    expect(r.json().error).toMatch(/Terminal/);
    expect((await queueItemForSpec("SPEC-r3"))!.status).toBe("launched");
  });

  it("POST /queue/:id/cancel atas id tak dikenal → 404", async () => {
    const r = await app.inject({ method: "POST", url: "/api/scheduler/queue/tak-ada/cancel" });
    expect(r.statusCode).toBe(404);
  });

  it("POST /queue/:id/requeue mengembalikan baris canceled ke antrean", async () => {
    await enqueue({ specId: "SPEC-r4", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-r4"))!;
    await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel` });
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/requeue` });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("queued");
    expect(r.json().note).toBeNull();
    // requeue kedua ditolak — barisnya sudah di antrean
    const again = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/requeue` });
    expect(again.statusCode).toBe(409);
    expect(again.json().status).toBe("queued");
  });

  it("POST /queue/:id/cancel menolak reason kelewat panjang", async () => {
    await enqueue({ specId: "SPEC-r5", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-r5"))!;
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel`,
      payload: { reason: "x".repeat(201) } });
    expect(r.statusCode).toBe(400);
    expect((await queueItemForSpec("SPEC-r5"))!.status).toBe("queued");
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/scheduler.route.test.ts
```

Expected: FAIL — enam test baru menerima **404** dari Fastify (route belum terdaftar).

- [ ] **Step 3: Implementasi route**

Ganti seluruh isi `server/src/routes/scheduler.ts` dengan:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { zScheduler } from "@hanoman/shared";
import { prisma } from "../db";
import { getScheduler, setScheduler } from "../services/scheduler/config";
import { listQueue, markCanceled, markRequeued } from "../services/scheduler/queue";
import { getLastRun } from "../services/scheduler/registry";
import { listSessions } from "../services/pty";

// SPEC-294 · ADR-0072 · config (knob) + state (antrean/sesi/cadence) scheduler. Di belakang gate cookie.
// SPEC-522 · + pembatalan satu baris antrean. Sengaja di bawah prefix `/scheduler` supaya
// capability-nya turunan peta yang sudah ada (`agent-capabilities.ts`: `scheduler` → `settings`
// MENURUT METHOD) — tak ada baris peta baru, dan tak ada pengulangan kelas bug SPEC-405.
const CANCEL_NOTE = "dibatalkan operator";
const zCancelBody = z.object({ reason: z.string().trim().max(200).optional() });

// Alasan penolakan disusun SESUDAH CAS gagal, bukan sebelum ia dicoba: memeriksa status lebih dulu
// lalu menulis adalah persis balapan yang dihindari CAS-nya.
async function refuse(reply: FastifyReply, id: string, verb: string) {
  const row = await prisma.schedulerQueueItem.findUnique({ where: { id }, select: { status: true } });
  if (!row) return reply.code(404).send({ error: "item antrean tak ada" });
  const why = row.status === "launched"
    ? "sesinya sudah berjalan — tutup dari Terminal bila memang tak diperlukan"
    : `statusnya sudah ${row.status}`;
  return reply.code(409).send({ error: `tak bisa ${verb}: ${why}`, status: row.status });
}

export default async function (app: FastifyInstance) {
  app.get("/scheduler/config", async () => getScheduler());

  app.put("/scheduler/config", async (req, reply) => {
    const parsed = zScheduler.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return setScheduler(parsed.data);   // ganti blok penuh (pola PUT /settings). Pause = { paused:true }.
  });

  // SPEC-522 · membatalkan SATU baris. Sebelum ini jalan keluar dari antrean cuma dua, keduanya
  // kasar: menunggu item meluncur (worktree + branch + `Spec.baseSha`/`startedAt` ditulis permanen,
  // ADR-0090) lalu menutup sesinya, atau rem global Pause/Stop yang menghentikan SELURUH antrean.
  app.post("/scheduler/queue/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zCancelBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const note = parsed.data.reason ? `${CANCEL_NOTE}: ${parsed.data.reason}` : CANCEL_NOTE;
    if (!(await markCanceled(id, note))) return refuse(reply, id, "membatalkan");
    return prisma.schedulerQueueItem.findUnique({ where: { id } });
  });

  // SPEC-522 · jalan pulang. Tanpa ini pembatalan permanen: barisnya tombstone, dan `enqueue`
  // (`upsert` ber-`update:{}`) sengaja tak bisa menghidupkannya lagi.
  app.post("/scheduler/queue/:id/requeue", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await markRequeued(id))) return refuse(reply, id, "mengembalikan ke antrean");
    return prisma.schedulerQueueItem.findUnique({ where: { id } });
  });

  app.get("/scheduler/state", async () => {
    const cfg = await getScheduler();
    const live = listSessions().filter((s) => !s.exited);
    const queue = await listQueue();
    // Akses kunci source tetap (backlog/triase) langsung — bukan index dinamis — agar
    // tetap tertype di bawah noUncheckedIndexedAccess. minCount hanya milik errors.
    const srcView = (id: string, sc: { enabled: boolean; everyMin: number }, minCount?: number) => {
      const last = getLastRun(id);
      return {
        id, enabled: sc.enabled, everyMin: sc.everyMin, minCount,
        lastRunAt: last ? new Date(last).toISOString() : null,
        nextRunAt: last ? new Date(last + sc.everyMin * 60_000).toISOString() : null,
      };
    };
    const sources = [
      srcView("backlog", cfg.sources.backlog),
      srcView("triase", cfg.sources.triase),
    ];
    // Sesi scheduler = sesi live yang punya item antrean 'launched' (marker asal-scheduler).
    const launchedSpecs = new Set(queue.filter((q) => q.status === "launched").map((q) => q.specId));
    const sessions = live.filter((s) => s.specId && launchedSpecs.has(s.specId));
    return { config: cfg, cap: cfg.maxConcurrent, liveCount: live.length, sources, queue, sessions };
  });
}
```

Tambahkan di `shared/src/api.ts` tepat sesudah baris `schedulerState:` (baris 128):

```ts
  // SPEC-522 · batalkan / antre lagi SATU baris antrean. Di bawah prefix `scheduler` supaya
  // capability-nya turunan peta yang sudah ada (settings, MENURUT METHOD) — tanpa baris peta baru.
  schedulerQueueCancel: (id: string) => `${API}/scheduler/queue/${encodeURIComponent(id)}/cancel`,
  schedulerQueueRequeue: (id: string) => `${API}/scheduler/queue/${encodeURIComponent(id)}/requeue`,
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/scheduler.route.test.ts
```

Expected: PASS 10 test (4 lama + 6 baru).

- [ ] **Step 5: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```

Expected: keduanya keluar tanpa error.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/scheduler.ts shared/src/api.ts server/test/scheduler.route.test.ts
git commit -m "feat(spec-522): endpoint cancel & requeue baris antrean scheduler"
```

---

### Task 4: Panel scheduler — tombol Batalkan & seksi Dibatalkan

**Files:**
- Modify: `src/src/api/client.ts:418-421`
- Modify: `src/src/screens/SchedulerScreen.tsx`
- Test: `src/test/scheduler-screen.test.tsx`

**Interfaces:**
- Consumes: `paths.schedulerQueueCancel` / `paths.schedulerQueueRequeue` (Task 3).
- Produces:
  - `api.cancelSchedulerQueueItem(id: string, reason?: string): Promise<SchedulerQueueItemView>`
  - `api.requeueSchedulerQueueItem(id: string): Promise<SchedulerQueueItemView>`

- [ ] **Step 1: Tulis test yang gagal**

Pada `src/test/scheduler-screen.test.tsx`, ganti blok `vi.hoisted` + `vi.mock` di atas berkas dengan:

```tsx
const { getSchedulerState, putSchedulerConfig, updateProject,
  cancelSchedulerQueueItem, requeueSchedulerQueueItem } = vi.hoisted(() => ({
  getSchedulerState: vi.fn(),
  putSchedulerConfig: vi.fn(),
  updateProject: vi.fn(),
  cancelSchedulerQueueItem: vi.fn(),
  requeueSchedulerQueueItem: vi.fn(),
}));
vi.mock("../src/api/client", () => ({
  api: { getSchedulerState, putSchedulerConfig, updateProject, cancelSchedulerQueueItem, requeueSchedulerQueueItem },
  ApiError: class extends Error {},
}));
```

Lalu tambahkan `describe` baru di akhir berkas:

```tsx
describe("SchedulerScreen pembatalan antrean (SPEC-522)", () => {
  const canceledRow = {
    id: "q5", specId: "SPEC-5", projectId: "a", source: "backlog", priority: "sedang",
    status: "canceled", sessionId: null, note: "dibatalkan operator: salah project",
    enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: null,
  };

  it("tombol Batalkan pada baris antrean memanggil cancelSchedulerQueueItem", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    cancelSchedulerQueueItem.mockResolvedValue({ ...STATE.queue[0], status: "canceled" });
    renderScreen();
    const btn = await screen.findByRole("button", { name: /batalkan/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(cancelSchedulerQueueItem).toHaveBeenCalledWith("q1"));
  });

  it("seksi Dibatalkan merender alasannya dan tombol Antre lagi mengembalikannya", async () => {
    getSchedulerState.mockResolvedValue({ ...STATE, queue: [...STATE.queue, canceledRow] });
    requeueSchedulerQueueItem.mockResolvedValue({ ...canceledRow, status: "queued", note: null });
    renderScreen();
    expect(await screen.findByText("Dibatalkan · 1")).toBeInTheDocument();
    expect(screen.getByText(/dibatalkan operator: salah project/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /antre lagi/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(requeueSchedulerQueueItem).toHaveBeenCalledWith("q5"));
  });

  // Kendala spec: item bersesi aktif tak dibunuh. Penolakan 409 membawa satu-satunya kalimat yang
  // berguna ("sesinya sudah berjalan — tutup dari Terminal"); menampilkan "gagal" saja
  // menyembunyikannya dan operator tak tahu harus ke mana.
  it("penolakan 409 menampilkan pesan server apa adanya", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    cancelSchedulerQueueItem.mockRejectedValue(Object.assign(new Error("409"), {
      detail: { error: "tak bisa membatalkan: sesinya sudah berjalan — tutup dari Terminal bila memang tak diperlukan", status: "launched" },
    }));
    const onToast = vi.fn();
    renderScreen({ onToast });
    const btn = await screen.findByRole("button", { name: /batalkan/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("sesinya sudah berjalan"), "err", "x-circle"));
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/scheduler-screen.test.tsx
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name /batalkan/i`.

- [ ] **Step 3a: Tambahkan dua metode di `src/src/api/client.ts`**

Tepat sesudah baris `getSchedulerState: …` (baris 421):

```ts
  // SPEC-522 · batalkan / antre lagi satu baris antrean. 409 membawa `{ error, status }` di
  // `ApiError.detail` — pemanggil menampilkannya apa adanya (kalimatnya yang memberi tahu operator
  // bahwa sesinya sudah berjalan dan harus ditutup dari Terminal).
  cancelSchedulerQueueItem: (id: string, reason?: string) =>
    j<SchedulerQueueItemView>(paths.schedulerQueueCancel(id), { method: "POST", ...body(reason ? { reason } : {}) }),
  requeueSchedulerQueueItem: (id: string) =>
    j<SchedulerQueueItemView>(paths.schedulerQueueRequeue(id), { method: "POST", ...body({}) }),
```

Dan tambahkan `type SchedulerQueueItemView` ke daftar import `@hanoman/shared` di baris 1 (tepat sesudah `type SchedulerStateView`).

- [ ] **Step 3b: Ubah `src/src/screens/SchedulerScreen.tsx`**

Ganti `QueueRow` (baris 75–85) dengan versi ber-tombol:

```tsx
function QueueRow({ q, backlog, onCancel, busy }:
  { q: SchedulerQueueItemView; backlog: Spec[]; onCancel: (id: string) => void; busy: boolean }) {
  return (
    <RowShell>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {q.projectId} · {q.source}{q.note ? ` · ${q.note}` : ""}
        </span>
      </span>
      <Badge tone={(PRIO_TONE[q.priority] ?? "neutral") as never} size="sm">{q.priority}</Badge>
      {/* SPEC-522 · tanpa dialog konfirmasi: tindakannya reversibel lewat "Antre lagi", dan
          konfirmasi untuk tindakan reversibel adalah gesekan tanpa hasil. */}
      <Button size="sm" variant="ghost" leftIcon="ban" disabled={busy} onClick={() => onCancel(q.id)}>Batalkan</Button>
    </RowShell>
  );
}

// SPEC-522 · baris tombstone: ia sengaja TIDAK dihapus — `enqueue` (`upsert` ber-`update:{}`)
// karena itu tak bisa menghidupkannya lagi saat checker `backlog` menjumpai spec yang sama.
function CanceledRow({ q, backlog, onRequeue, busy }:
  { q: SchedulerQueueItemView; backlog: Spec[]; onRequeue: (id: string) => void; busy: boolean }) {
  return (
    <RowShell>
      <Icon name="ban" size={16} color="var(--text-subtle)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {q.projectId} · {q.source} · {q.note ?? "dibatalkan"}
        </span>
      </span>
      <Button size="sm" variant="ghost" leftIcon="rotate-ccw" disabled={busy} onClick={() => onRequeue(q.id)}>Antre lagi</Button>
    </RowShell>
  );
}
```

Di dalam `SchedulerScreen`, tepat sesudah `toggleOptIn` (baris 263), tambahkan handler baris:

```tsx
  // SPEC-522 · satu handler untuk kedua arah. `load(true)` dijalankan pada sukses MAUPUN gagal:
  // penolakan 409 berarti keadaan sebenarnya berbeda dari yang dilihat operator, jadi memuat ulang
  // adalah bagian dari jawabannya.
  const rowAction = React.useCallback(async (id: string, kind: "cancel" | "requeue") => {
    setBusyId(id);
    try {
      if (kind === "cancel") { await api.cancelSchedulerQueueItem(id); onToast("Item antrean dibatalkan", "ok", "ban"); }
      else { await api.requeueSchedulerQueueItem(id); onToast("Item dikembalikan ke antrean", "ok", "rotate-ccw"); }
    } catch (e) {
      // 409 membawa kalimatnya sendiri ("sesinya sudah berjalan — tutup dari Terminal"); toast
      // "gagal" saja menyembunyikan satu-satunya keterangan yang bisa ditindaklanjuti.
      const detail = (e as { detail?: { error?: string } }).detail;
      onToast(detail?.error ?? "Gagal mengubah item antrean", "err", "x-circle");
    } finally { setBusyId(null); load(true); }
  }, [load, onToast]);
```

Tambahkan daftar `canceled` di samping `queued`/`done`/`failed` (baris 268–271):

```tsx
  const canceled = state.queue.filter((q) => q.status === "canceled");
```

Ganti pemanggilan seksi Antrean (baris 283–285) dan sisipkan seksi Dibatalkan tepat sesudahnya:

```tsx
      <Section title="Antrean" count={queued.length} empty="Antrean kosong.">
        {queued.map((q) => <QueueRow key={q.id} q={q} backlog={backlog}
          onCancel={(id) => void rowAction(id, "cancel")} busy={busyId === q.id} />)}
      </Section>

      <Section title="Dibatalkan" count={canceled.length} empty="Tak ada item yang dibatalkan.">
        {canceled.map((q) => <CanceledRow key={q.id} q={q} backlog={backlog}
          onRequeue={(id) => void rowAction(id, "requeue")} busy={busyId === q.id} />)}
      </Section>
```

- [ ] **Step 4: Jalankan test web, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/scheduler-screen.test.tsx src/test/scheduler-nav.test.tsx
```

Expected: PASS 10 test (7 lama + 3 baru) di `scheduler-screen`, `scheduler-nav` tak berubah.

- [ ] **Step 5: Typecheck web + shared**

```bash
pnpm --filter ./src typecheck
```

Expected: keluar tanpa error. (Bila nama paket web bukan `./src`, pakai nama dari `pnpm-workspace.yaml`.)

- [ ] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/SchedulerScreen.tsx src/test/scheduler-screen.test.tsx
git commit -m "feat(spec-522): tombol Batalkan & seksi Dibatalkan di panel scheduler"
```

---

### Task 5: Docs Source of Truth (ADR-0106 + kontrak + data model)

**Files:**
- Create: `internal/docs/adr/0106-batalkan-antrean-scheduler.md`
- Modify: `internal/docs/README.md` (daftar ADR, baris pertama sesudah judul `## adr`)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/docs/architecture/api-contract.md` (blok Scheduler, baris 835–842)
- Modify: `internal/docs/architecture/data-model.md` (`## SchedulerQueueItem`, baris 359–399)

**Interfaces:**
- Consumes: keputusan & kosakata dari Task 1–4 (nama status `canceled`, dua endpoint, dua gerbang).
- Produces: nomor ADR **0106** terpakai; keduanya tertaut (SPEC-386 menuntut tautan di `README.md` **dan** `adr/README.md`).

- [ ] **Step 1: Pastikan nomor 0106 masih bebas**

```bash
ls internal/docs/adr/ | tail -4
for w in /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/*/internal/docs/adr; do ls "$w" 2>/dev/null | grep -c '^0106' | tr '\n' ' '; echo "$w"; done
```

Expected: `0105-changelog-per-project.md` yang terakhir, dan `0` untuk setiap worktree. Bila ada yang `1`, pakai nomor bebas berikutnya dan sesuaikan seluruh rujukan di task ini.

- [ ] **Step 2: Tulis `internal/docs/adr/0106-batalkan-antrean-scheduler.md`**

```markdown
# ADR-0106 — Pembatalan antrean scheduler: status `canceled` sebagai tombstone, dua endpoint CAS

- Status: Accepted
- Tanggal: 2026-08-04
- SPEC: SPEC-522 (brief, prioritas tinggi)
- Terkait: **mengamandemen keputusan #2 [0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md)**
  (yang menuliskan kosakata status antrean hanya `queued|launched|done|failed`), memperluas pola
  tombstone SPEC-431 (`markDone` + `ALREADY_DONE_NOTE`), sejajar gerbang pra-launch
  [0093](0093-dependency-antar-backlog.md); [0015](0015-one-session-per-backlog.md),
  [0016](0016-sesi-terminal-hidup-di-tmux.md), [0065](0065-ai-agent-capability-agent-token.md) utuh.

## Konteks

Panel scheduler (SPEC-299) menampilkan antrean tapi **murni read-only** — tak satu pun tombol
menyentuh sebuah baris. Operator yang melihat item salah mengantre hanya punya dua jalan, keduanya
kasar: **menunggu** sampai governor meluncurkannya lalu menutup sesinya, atau menarik **rem global**
(Pause/Stop) yang menghentikan seluruh antrean demi satu baris.

Menunggu bukan sekadar tak nyaman. Peluncuran membuat git worktree, branch `hanoman/<sessionId>`,
menulis `Spec.baseSha` dan `Spec.startedAt` — stempel *mulai pertama* yang menurut ADR-0090 sengaja
tak pernah ditulis ulang — dan membakar kuota langganan agen. Membiarkan item meluncur hanya supaya
bisa dimatikan adalah kerusakan yang tak perlu.

## Keputusan

1. **`canceled` = nilai kelima `SchedulerQueueItem.status`.** ADR-0072 #2 menyebut kosakatanya
   secara eksplisit; ADR ini mengamandemen kalimat itu. Kolomnya `String` → **tanpa migration**.
   Tabelnya LOCAL-ONLY (tak di `FIELDS` sync), jadi nilai baru ini tak menyeberang antar-instance —
   dan itu benar: antrean adalah state operasional mesin ini.

2. **Tombstone, bukan penghapusan.** Barisnya tetap ada, dan itulah mekanismenya: `enqueue()`
   memakai `upsert` ber-`update:{}`, jadi checker `backlog` yang menjumpai spec yang sama pada
   cadence berikutnya **tak bisa menghidupkannya**. Alternatif `DELETE` ditolak: spec-nya masih
   cocok `UNSTARTED_SPEC_WHERE` (`baseSha=null` ∧ `stage≠done`), jadi ia akan di-enqueue ulang
   dalam ≤1 cadence — pembatalan yang membatalkan dirinya sendiri.

3. **Dua endpoint, keduanya CAS, keduanya di bawah `/scheduler`.**
   `POST /api/scheduler/queue/:id/cancel { reason? }` dan `…/requeue`. Prefix-nya dipilih supaya
   capability-nya turunan peta yang sudah ada (`scheduler` → `settings`, **menurut method**) —
   **tanpa baris peta baru**, dan tanpa pengulangan kelas bug SPEC-405 (prefix status dipetakan ke
   izin baca tanpa melihat method). Transisi ditulis `updateMany({ where: { id, status: <asal> } })`
   dan dinilai dari `count`, **bukan** `findUnique` → `if` → `update`: di antara dua pernyataan itu
   governor bisa meluncurkan barisnya, dan kendala "item yang sudah punya sesi aktif tak boleh
   dibunuh diam-diam" akan jadi sekadar niat baik. Alasan penolakan disusun **sesudah** CAS gagal
   (404 bila barisnya hilang, 409 + `status` saat ini bila transisinya haram).

4. **Reversibel.** `requeue` (`canceled → queued`, `note` dikosongkan) ada karena tombstone-nya
   permanen secara mekanis: tanpa jalan pulang, "Batalkan" diam-diam berarti "jangan pernah
   dijadwalkan lagi, selamanya". Konsekuensinya UI tak perlu dialog konfirmasi.

5. **Dua gerbang di governor.** `queued()` memang sudah menyaring `canceled`, tapi daftar itu
   **snapshot**: `drain()` memprosesnya berurutan dan tiap `launch` men-spawn worktree + sesi tmux
   (hitungan detik), jadi item di ekor daftar bisa duduk puluhan detik di dalam loop sesudah
   snapshotnya diambil. **Gerbang A** = `isQueued(item.id)` dibaca ulang dari DB di **puncak badan
   loop** (pola `isDone` SPEC-431 & `blockers` SPEC-447) — ditaruh paling atas, bukan tepat sebelum
   `launch`, supaya ia melindungi semua mutasi di badan loop: baris `canceled` tak boleh ditimpa
   jadi `done` oleh gerbang SPEC-431 maupun jadi `launched` oleh cabang idempoten `isLive`.
   **Gerbang B** = `markLaunched` jadi CAS; sisa jendelanya adalah durasi satu spawn, dan CAS yang
   gagal mempertahankan `canceled` alih-alih menimpanya senyap.

6. **Sesi yang telanjur lahir TIDAK dibunuh.** Saat gerbang B menyala, sesinya sudah nyata.
   Governor menulis `note` yang menyebut id sesinya (operator bisa menutupnya dari Terminal) dan
   **tetap** `slots--` — cap concurrency tak boleh dilanggar hanya karena barisnya dibatalkan.
   Membunuh sesi dari dalam governor ditolak: kendala spec berlaku untuk sesi hidup mana pun, dan
   itu menambah permukaan yang tak dibutuhkan fitur ini.

## Konsekuensi

- **Positif:** satu baris bisa dicabut tanpa menyentuh rem global; nol migration, nol tabel, nol
  baris peta capability; `reconcile()` tak tersentuh (ia hanya memindai `launched`, jadi tak ada
  `Notification fail` palsu untuk item yang sengaja dibatalkan); jaminan "sesi aktif tak dibunuh"
  ditegakkan **struktur** (CAS), bukan niat.
- **Negatif / batas:** pembatalan tak berlaku surut — item yang sudah `launched` harus ditutup dari
  Terminal, dan panel mengatakannya dengan kalimat, bukan dengan tombol. Tak ada pembatalan massal
  (Pause/Stop sudah menjadi rem global). Sesi yatim akibat gerbang B tak muncul di daftar "sesi
  scheduler" (`state.sessions` diturunkan dari baris `launched`) — ia terbaca sebagai sesi biasa di
  Terminal, dengan `note` di baris `canceled` sebagai penunjuknya.
- **Reversibilitas:** murni aditif. Mencabutnya = menghapus dua route + dua tombol; baris
  `canceled` yang telanjur ada akan diam selamanya (tak pernah di-drain, tak pernah di-reconcile),
  yang persis perilaku yang diinginkan.
```

- [ ] **Step 3: Tautkan ADR di kedua index**

Di `internal/docs/README.md`, tepat sebelum baris `- [0105 — Changelog per project…`:

```markdown
- [0106 — Pembatalan antrean scheduler: status `canceled` sebagai tombstone, dua endpoint CAS](adr/0106-batalkan-antrean-scheduler.md)
```

Di `internal/docs/adr/README.md`, sisipkan entri narasi berikut **tepat sebelum** baris yang dimulai
`- [0105 — Changelog per project…` (daftarnya menurun; entri terbaru di atas):

```markdown
- [0106 — Pembatalan antrean scheduler: status `canceled` sebagai tombstone, dua endpoint CAS](0106-batalkan-antrean-scheduler.md) — **mengamandemen keputusan #2 dari 0072**, **menegakkan 0015/0016/0065**, memperluas pola tombstone SPEC-431 (SPEC-522): panel scheduler menampilkan antrean tapi tak punya satu pun tombol yang menyentuh sebuah baris, jadi jalan keluar dari antrean cuma dua dan keduanya kasar — **menunggu** item meluncur lalu menutup sesinya, atau menarik **rem global** Pause/Stop yang menghentikan seluruh antrean demi satu baris. Menunggu bukan sekadar tak nyaman: peluncuran membuat worktree + branch `hanoman/<sessionId>` dan menulis `Spec.baseSha`/`startedAt` — stempel *mulai pertama* yang menurut 0090 sengaja **tak pernah** ditulis ulang — lalu membakar kuota agen; membiarkan item meluncur hanya supaya bisa dimatikan adalah kerusakan yang tak perlu. **(1) `canceled` sebagai nilai kelima `status`.** 0072 #2 mengeja kosakatanya (`queued|launched|done|failed`), jadi menambahnya adalah amandemen — bukan sekadar detail implementasi. Kolomnya `String` → **tanpa migration**; tabelnya LOCAL-ONLY sehingga nilai baru ini tak menyeberang antar-instance, dan itu benar (antrean = state operasional mesin ini). **(2) Tombstone, bukan `DELETE`.** Barisnya sengaja ditinggalkan: `enqueue()` memakai `upsert` ber-`update:{}`, jadi checker `backlog` yang menjumpai spec yang sama pada cadence berikutnya tak bisa menghidupkannya. Menghapusnya justru membuat pembatalan **membatalkan dirinya sendiri** dalam ≤1 cadence, karena spec-nya masih cocok `UNSTARTED_SPEC_WHERE` — mekanisme yang sama sudah dipakai SPEC-431 (`markDone` + `ALREADY_DONE_NOTE`). **(3) CAS, bukan baca-lalu-tulis.** Kedua transisi ditulis `updateMany({ where: { id, status: <asal> } })` dan dinilai dari `count`; di antara `findUnique` dan `update` governor bisa meluncurkan barisnya, sehingga kendala "item yang sudah punya sesi aktif tak boleh dibunuh diam-diam" hanya bisa ditegakkan **struktur**, bukan niat. Alasan penolakan disusun **sesudah** CAS gagal (404 bila barisnya hilang, 409 + `status` saat ini bila transisinya haram) — memeriksa lebih dulu adalah persis balapan yang dihindari. **(4) Reversibel.** `requeue` ada karena tombstone-nya permanen secara mekanis: tanpa jalan pulang, "Batalkan" diam-diam berarti "jangan pernah dijadwalkan lagi"; konsekuensinya UI tak perlu dialog konfirmasi. **(5) Dua gerbang governor.** `queued()` memang menyaring `canceled`, tapi daftar itu **snapshot** — `drain()` memprosesnya berurutan dan tiap `launch` men-spawn worktree + sesi tmux (hitungan detik), jadi item di ekor daftar bisa duduk puluhan detik di dalam loop. Gerbang A (`isQueued`, dibaca ulang dari DB, pola `isDone` SPEC-431 & `blockers` SPEC-447) ditaruh di **puncak badan loop** — bukan tepat sebelum `launch` — supaya ia melindungi semua mutasi di sana: baris `canceled` tak boleh ditimpa jadi `done` oleh gerbang SPEC-431 maupun jadi `launched` oleh cabang idempoten `isLive`. Gerbang B = `markLaunched` jadi CAS, menutup sisa jendela seluas satu spawn. **(6) Sesi yang telanjur lahir tak dibunuh.** Saat gerbang B menyala sesinya sudah nyata: governor mencatat id-nya di `note` (operator menutupnya dari Terminal) dan **tetap** `slots--`, karena cap concurrency tak boleh dilanggar hanya karena barisnya dibatalkan. `reconcile()` tak tersentuh — ia hanya memindai `launched`, jadi tak ada `Notification fail` palsu untuk item yang sengaja dibatalkan
```

- [ ] **Step 4: Perbarui `internal/docs/architecture/api-contract.md`**

Di blok kode Scheduler (baris 836–842), tambahkan dua baris tepat sesudah `GET /api/scheduler/state`:

```
POST /api/scheduler/queue/:id/cancel  { reason? } -> SchedulerQueueItem   # SPEC-522 · queued→canceled (CAS). 404 baris tak ada;
#                                     409 { error, status } bila statusnya bukan `queued` (launched → "tutup dari Terminal"); 400 reason >200 char.
POST /api/scheduler/queue/:id/requeue            -> SchedulerQueueItem   # canceled→queued, note dikosongkan. 404 / 409 { error, status }.
```

Dan tambahkan paragraf `>` baru di akhir bagian Scheduler (sesudah paragraf Panel Scheduler SPEC-299):

```markdown
>
> **Pembatalan antrean (SPEC-522 · ADR-0106):** `status` mendapat nilai kelima **`canceled`** (kolom
> `String` → **tanpa migration**), dan barisnya adalah **tombstone**: `enqueue()` memakai `upsert`
> ber-`update:{}`, jadi checker `backlog` tak bisa menghidupkannya lagi — menghapus barisnya justru
> akan membuat pembatalan membatalkan dirinya sendiri dalam ≤1 cadence (spec-nya masih cocok
> `UNSTARTED_SPEC_WHERE`). Kedua transisi **CAS** (`updateMany` ber-`where` status), bukan
> baca-lalu-tulis: di antara dua pernyataan itu governor bisa meluncurkan barisnya, dan kendala
> "item bersesi aktif tak dibunuh diam-diam" akan jadi sekadar niat baik. Capability **turunan peta
> yang sudah ada** (`scheduler` → `settings` menurut method) — tak ada baris peta baru. Governor
> mendapat **dua gerbang**: `isQueued` dibaca ulang dari DB di puncak badan loop `drain` (snapshot
> `queued()` bisa berumur puluhan detik karena tiap spawn hitungan detik; ditaruh paling atas supaya
> gerbang SPEC-431 & cabang `isLive` tak menimpa baris `canceled`) dan `markLaunched` yang jadi CAS
> (sisa jendela = durasi satu spawn). Sesi yang telanjur lahir **tidak dibunuh** — id-nya dicatat di
> `note` dan slot tetap terpakai. UI: tombol **Batalkan** per baris antrean (tanpa konfirmasi —
> reversibel) + seksi **Dibatalkan** ber-tombol **Antre lagi**.
```

- [ ] **Step 5: Perbarui `internal/docs/architecture/data-model.md`**

Pada bagian `## SchedulerQueueItem`, ubah butir `status` (baris 368) menjadi:

```markdown
  `status` (`queued|launched|done|failed|canceled`, default `queued`), `sessionId?` (id sesi tmux saat diluncurkan),
```

dan tambahkan satu butir baru di akhir bagian itu (sesudah butir Rekonsiliasi akhir sesi):

```markdown
- **Pembatalan operator (SPEC-522 · [ADR-0106](../adr/0106-batalkan-antrean-scheduler.md)):** `canceled`
  adalah **tombstone**, bukan penghapusan — `enqueue()` memakai `upsert` ber-`update:{}`, jadi checker
  `backlog` yang menjumpai spec yang sama pada cadence berikutnya **tak bisa menghidupkannya**; menghapus
  barisnya justru membuat pembatalan membatalkan dirinya sendiri dalam ≤1 cadence (spec-nya masih cocok
  `UNSTARTED_SPEC_WHERE`). Mekanisme yang sama dipakai SPEC-431 (`markDone` + `ALREADY_DONE_NOTE`).
  Transisinya `queued → canceled` (`POST /api/scheduler/queue/:id/cancel`, `note` = `dibatalkan operator`
  ± `: <reason>`) dan `canceled → queued` (`…/requeue`, `note` dikosongkan), keduanya **CAS**
  (`updateMany` ber-`where` status) — itulah yang membuat "item yang sudah punya sesi aktif tak boleh
  dibunuh diam-diam" tak bisa dilanggar balapan. Governor punya **dua gerbang** sepasang: `isQueued`
  di puncak badan loop `drain` (snapshot `queued()` bisa berumur puluhan detik) dan `markLaunched`
  yang jadi **CAS** (sisa jendela = durasi satu spawn); sesi yang telanjur lahir **tidak dibunuh** —
  id-nya dicatat di `note` dan slotnya tetap terpakai. `reconcile()` tak tersentuh: ia hanya memindai
  `launched`, jadi tak ada `Notification fail` palsu untuk item yang sengaja dibatalkan.
```

- [ ] **Step 6: Verifikasi integritas index docs**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli exec tsx src/index.ts docs index --check
```

Expected: laporan tanpa entri hilang. Bila CLI belum ter-build, cukup pastikan secara manual bahwa
`0106-batalkan-antrean-scheduler.md` tertaut di `internal/docs/README.md` **dan** `internal/docs/adr/README.md`.

- [ ] **Step 7: Commit**

```bash
git add internal/docs/
git commit -m "docs(spec-522): ADR-0106 pembatalan antrean scheduler + api-contract & data-model"
```

---

### Task 6: Verifikasi akhir — test yang tersentuh + smoke endpoint nyata

**Files:** tak ada perubahan kode; hanya verifikasi.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/scheduler-queue.service.test.ts server/test/scheduler-governor.test.ts \
  server/test/scheduler.route.test.ts server/test/scheduler-engine.test.ts \
  server/test/scheduler-reconcile.test.ts server/test/scheduler-source-backlog.test.ts \
  server/test/scheduler-source-triase.test.ts server/test/agent-capabilities.test.ts
```

Expected: seluruh berkas PASS. Bila `agent-capabilities.test.ts` tak ada, hapus dari daftar.
**Jangan** terima "no test files" sebagai bukti — jumlah test harus terlihat.

```bash
env -u NODE_ENV pnpm vitest --run src/test/scheduler-screen.test.tsx src/test/scheduler-nav.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Typecheck ketiga paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: ketiganya keluar tanpa error.

- [ ] **Step 3: Smoke endpoint nyata (task ini menyentuh endpoint — wajib, sekali di akhir)**

DB **khusus smoke** (jangan pernah pakai DB test bersama — run tetangga menghapusnya di tengah
jalan) dan **port non-default** supaya tak bertabrakan dengan instance dev yang mungkin hidup.

```bash
export SMOKE_DIR=$(mktemp -d)
export DATABASE_URL="file:$SMOKE_DIR/hanoman.db"
export SMOKE_PORT=8799
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server build
DATABASE_URL="$DATABASE_URL" PORT=$SMOKE_PORT HOST=127.0.0.1 node server/dist/server.js > "$SMOKE_DIR/server.log" 2>&1 &
until curl -sf "localhost:$SMOKE_PORT/api/health" > /dev/null; do sleep 1; done; echo "server siap"
```

Buat user pertama (`POST /api/auth/setup` ada di daftar `PUBLIC`) dan simpan cookie sesinya:

```bash
curl -s -c "$SMOKE_DIR/cookies" -X POST "localhost:$SMOKE_PORT/api/auth/setup" \
  -H 'content-type: application/json' -d '{"email":"smoke@example.com","password":"smoke-pass-522"}'
```

Buat satu baris antrean langsung lewat Prisma pada DB yang sama, lalu cetak id-nya:

```bash
export QID=$(DATABASE_URL="$DATABASE_URL" node -e '
const { PrismaClient } = require("./server/node_modules/@prisma/client");
const p = new PrismaClient();
p.schedulerQueueItem.create({ data: { specId: "SPEC-SMOKE", projectId: "p-smoke", source: "backlog", priority: "tinggi" } })
  .then((r) => { process.stdout.write(r.id); return p.$disconnect(); });
')
echo "QID=$QID"
```

Uji keempat jalur:

```bash
C="-s -b $SMOKE_DIR/cookies -H content-type:application/json"
curl $C -X POST "localhost:$SMOKE_PORT/api/scheduler/queue/$QID/cancel" -d '{"reason":"smoke"}'
# Expected: {…,"status":"canceled","note":"dibatalkan operator: smoke",…}
curl $C -o /dev/null -w '%{http_code}\n' -X POST "localhost:$SMOKE_PORT/api/scheduler/queue/$QID/cancel"
# Expected: 409
curl $C -X POST "localhost:$SMOKE_PORT/api/scheduler/queue/$QID/requeue"
# Expected: {…,"status":"queued","note":null,…}
curl $C -o /dev/null -w '%{http_code}\n' -X POST "localhost:$SMOKE_PORT/api/scheduler/queue/tak-ada/cancel"
# Expected: 404
curl $C "localhost:$SMOKE_PORT/api/scheduler/state" | head -c 400
# Expected: queue memuat baris SPEC-SMOKE ber-status "queued"
```

Matikan server **per-PID**, dan **jangan** `pkill -f node` (SPEC-402: pola itu mencocoki agen sesi
tetangga di mesin ini dan `pkill` mengecualikan leluhurnya sendiri, jadi yang mati selalu sesi orang
lain):

```bash
kill $(lsof -ti:$SMOKE_PORT)
rm -rf "$SMOKE_DIR"
```

- [ ] **Step 4: Diff bersih & commit sisa (bila ada)**

```bash
git status --porcelain
git diff --stat "$HANOMAN_BASE_SHA"...HEAD
```

Expected: working tree bersih; diff memuat 8 berkas kode + 4 berkas docs + 1 spec + 1 plan.
