# SPEC-799 — Sync tombstone: penghapusan menyeberang antar-instance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Penghapusan sebuah record menyeberang dua arah antara hub dan client sebagai keadaan pertama-kelas, dan record yang sudah dihapus tak pernah bisa dibangkitkan ulang oleh jalur mana pun.

**Architecture:** Hard-delete tetap hard-delete (cascade Prisma yang ada tetap bekerja, nol query baca yang berubah). Keadaan "dihapus" hidup di tabel baru `SyncTombstone`, peristiwanya mengalir lewat kolom baru `SyncLog.op = "delete"`. Kuncinya: **tombstone adalah versi record itu sendiri, berkeadaan dihapus** — dengan menjadikannya sumber `existing.version` saat barisnya tak ada, penolakan kebangkitan jatuh dari aturan optimistic-concurrency yang SUDAH ada di `applyPush`, tanpa kosakata baru.

**Tech Stack:** Node + TypeScript (Fastify), Prisma 6 + SQLite, vitest, React + TS (Vite) untuk dashboard.

**Spec:** `docs/superpowers/specs/2026-08-15-spec-799-sync-tombstone-design.md`

## Global Constraints

- **Jalankan test server SELALU** dengan `--no-file-parallelism`, `TEST_DATABASE_URL` tersendiri, **dan `env -u HANOMAN_CONTROL_ORIGINS`**:
  ```bash
  env -u HANOMAN_CONTROL_ORIGINS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
    ./node_modules/.bin/vitest --run --no-file-parallelism <path>
  ```
  Tanpa `TEST_DATABASE_URL`, sesi tetangga di mesin ini menghapus DB test di tengah run (404/P2022 ramai).
  Tanpa `env -u HANOMAN_CONTROL_ORIGINS`, **setiap test yang memakai `buildApp().inject()` gagal palsu 404**:
  env sesi mewarisi variabel itu dari instance hanoman yang melahirkannya, `loadIngressPolicy()` karena itu
  menyetel `enforce: true` (SPEC-761/ADR-0117), dan hook `onRequest` pertama (`app.ts:89`) menolak host
  `localhost:80` bawaan `inject` dengan `404 {"error":"not found"}` — routenya terdaftar, requestnya yang
  ditolak. Terukur di **main worktree HEAD bersih**: `projects.route` 18/22 merah + `sync.route` 10/10 merah
  + `sync-hub-origin-writes` 6/7 merah → **39/39 hijau** hanya dengan `env -u`, nol baris kode berubah.
- **Jalankan vitest dari root worktree** (`./node_modules/.bin/vitest`). Menjalankannya dari subdirektori membuat `--changed` melihat berkas yang salah.
- Test web butuh `env -u NODE_ENV` (env sesi ini menunjuk production).
- **Jangan** `pnpm test`, `vitest run` polos, `pnpm -r typecheck`, atau build penuh. Typecheck hanya paket tersentuh: `pnpm --filter ./server typecheck`.
- Bahasa komentar & pesan commit: **Indonesia**, mengikuti idiom berkas sekitarnya. Jangan menulis komentar yang mengulang apa yang sudah dinyatakan kode.
- **Kompatibilitas versi campur adalah kendala mengikat**, bukan nice-to-have: `validateIncomingRecord` (`server/src/services/sync-client.ts:18`) melempar untuk bentuk tak dikenal, dan lemparan itu menyalakan `feedHole` yang **menahan kursor** client lama selamanya. Karena itu: **`op` hidup di TOP-LEVEL record, tak pernah di dalam `data`**, dan baris feed `op:"delete"` **tetap membawa `data` = snapshot terakhir yang sah**.
- Nilai literal yang dipakai apa adanya di seluruh plan: entitas tersync = `["project","spec","vps","sessionResult","ticket","ticketAttachment","customAgent","githubIssue"]`; nilai `op` = `"upsert" | "delete"`; nomor ADR baru = **0119**.

---

## File Structure

**Dibuat:**
- `server/prisma/migrations/20260815120000_sync_tombstone/migration.sql` — migration additive
- `server/src/services/tombstone.ts` — satu-satunya pemilik tabel `SyncTombstone` (nol dependency selain `db`)
- `server/src/services/sync-delete.ts` — `deleteSynced()` (satu panggilan: hapus + tombstone + terbitkan) & `listPendingDeletes()`
- `server/test/tombstone.service.test.ts`, `sync-tombstone.service.test.ts`, `sync-tombstone.client.test.ts`, `sync-tombstone.compat.test.ts`, `sync-parents-dmmf.test.ts`, `sync-delete.routes.test.ts`, `sync-pending.route.test.ts`
- `src/src/test/sync-pending-badge.test.tsx`
- `internal/docs/adr/0119-tombstone-sync-penghapusan-menyeberang.md`

**Diubah:**
- `server/prisma/schema.prisma` — model `SyncTombstone`, kolom `SyncLog.op`
- `server/src/services/sync.ts` — `PARENTS`, `deleteRow`, `publishDelete`, `consumeTombstoneOnRecreate`, `applyPush` sadar-tombstone, `pull`/`AcceptedHook` membawa `op`, `backfillFeed` mencakup tombstone
- `server/src/services/sync-notify.ts` — `notifyDeleted()` + konsumsi tombstone di `notifySynced()`
- `server/src/services/sync-client.ts` — `op` di wire, `applyRemote` sadar-op & sadar-tombstone, push delete, `SyncStats` += `deleted`/`dropped`
- `server/src/services/notifications.ts` — `recordSyncDelete()`
- `server/src/routes/sync.ts` — `op` di `zPush`, `GET /sync/pending`
- `server/src/routes/{projects,specs,vps,tickets,custom-agents,session-results}.ts` — enam DELETE
- `server/src/app.ts:134` — `/api/sync/pending` masuk pengecualian bypass cookie-gate
- `cli/src/commands/migrate-pg.ts` — `SyncTombstone` masuk `PG_ORDER`
- `shared/src/api.ts` — path `syncPending`
- `src/src/api/client.ts`, `src/src/screens/SyncButton.tsx` — lencana "N hapus menunggu" + hitungan toast
- `internal/docs/README.md`, `internal/docs/adr/README.md`, `internal/docs/adr/0068-*.md`, `internal/docs/adr/0082-*.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`, `internal/skills/hanoman/SKILL.md`

---

## Task 1: Skema + modul tombstone

**Files:**
- Modify: `server/prisma/schema.prisma` (setelah model `SyncConflict`, ~baris 432; dan model `SyncLog` ~baris 376)
- Create: `server/prisma/migrations/20260815120000_sync_tombstone/migration.sql`
- Create: `server/src/services/tombstone.ts`
- Modify: `cli/src/commands/migrate-pg.ts:26`
- Test: `server/test/tombstone.service.test.ts`

**Interfaces:**
- Consumes: `prisma` dari `server/src/db`
- Produces:
  - `type Tombstone = { entity: string; recordId: string; version: number; data: Record<string, unknown>; deletedAt: Date; deviceId: string | null }`
  - `findTombstone(entity: string, recordId: string): Promise<Tombstone | null>`
  - `writeTombstone(entity: string, recordId: string, version: number, data: Record<string, unknown>, deviceId?: string): Promise<Tombstone>`
  - `clearTombstone(entity: string, recordId: string): Promise<void>`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/tombstone.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { findTombstone, writeTombstone, clearTombstone } from "../src/services/tombstone";

const clean = async () => { await prisma.syncTombstone.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("tombstone store (SPEC-799 · ADR-0119)", () => {
  it("tulis lalu baca kembali", async () => {
    await writeTombstone("project", "p1", 3, { name: "p1" }, "dev-1");
    const t = await findTombstone("project", "p1");
    expect(t).toMatchObject({ entity: "project", recordId: "p1", version: 3 });
    expect(t?.data).toMatchObject({ name: "p1" });
  });

  it("id yang belum pernah dihapus → null", async () => {
    expect(await findTombstone("project", "belum-ada")).toBeNull();
  });

  it("idempoten & MONOTON: tulis ulang di version lebih rendah tak menurunkan", async () => {
    await writeTombstone("project", "p1", 5, { name: "baru" });
    await writeTombstone("project", "p1", 2, { name: "lama" });
    const t = await findTombstone("project", "p1");
    expect(t?.version).toBe(5);
    expect(t?.data).toMatchObject({ name: "baru" });
    expect(await prisma.syncTombstone.count()).toBe(1);
  });

  it("version lebih tinggi menimpa", async () => {
    await writeTombstone("project", "p1", 2, { name: "lama" });
    await writeTombstone("project", "p1", 7, { name: "baru" });
    expect((await findTombstone("project", "p1"))?.version).toBe(7);
  });

  it("clear menghapus; clear atas yang tak ada tak melempar", async () => {
    await writeTombstone("project", "p1", 1, {});
    await clearTombstone("project", "p1");
    expect(await findTombstone("project", "p1")).toBeNull();
    await expect(clearTombstone("project", "tak-ada")).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/tombstone.service.test.ts
```
Expected: FAIL — `Cannot find module '../src/services/tombstone'`.

- [x] **Step 3: Tambah model & kolom di `server/prisma/schema.prisma`**

Sisipkan **sesudah** model `SyncConflict` (blok yang berakhir di ~baris 432):

```prisma
// SPEC-799 · ADR-0119 · LOCAL-ONLY sebagai tabel, tapi maknanya menyeberang: keadaan "record ini
// dihapus" yang bertahan restart dan menahan setiap upaya membangkitkannya kembali. Hard-delete
// dipertahankan (bukan soft-delete `deletedAt` per entitas) supaya cascade tingkat-DB tetap bekerja
// dan tak satu pun query baca yang sudah ada harus berubah — penyaring yang terlewat di bentuk itu
// gagal SENYAP dengan gejala persis bug yang sedang diperbaiki.
//
// `data` = snapshot field tersync tepat sebelum baris dihapus. Ia BUKAN kenyamanan: tanpa snapshot,
// push delete ke hub versi LAMA (yang membuang `op` sebagai field tak dikenal) berbentuk create
// tanpa kolom required → P2011 → 500 di setiap siklus push.
model SyncTombstone {
  id        String   @id @default(cuid())
  entity    String
  recordId  String
  version   Int      // versi record SESUDAH dihapus (= versi terakhirnya + 1)
  data      Json
  deletedAt DateTime @default(now())
  deviceId  String?

  @@unique([entity, recordId])
}
```

Di model `SyncLog`, tambahkan kolom **sesudah** `data Json`:

```prisma
  // SPEC-799 · ADR-0119 · jenis peristiwa. `@default("upsert")` membuat seluruh baris feed lama
  // terbaca benar tanpa backfill. Kolom TOP-LEVEL, bukan penanda di dalam `data`: `validateSyncData`
  // menegakkan allowlist atas `data`, jadi penanda di sana membuat client versi lama MELEMPAR →
  // `feedHole` menyala → kursornya tertahan selamanya.
  op        String   @default("upsert")
```

- [x] **Step 4: Tulis migration**

Buat `server/prisma/migrations/20260815120000_sync_tombstone/migration.sql`:

```sql
-- SPEC-799 · ADR-0119 · tombstone sync: penghapusan sebagai keadaan pertama-kelas.
CREATE TABLE "SyncTombstone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT
);
CREATE UNIQUE INDEX "SyncTombstone_entity_recordId_key" ON "SyncTombstone"("entity", "recordId");

-- Additive & default aman: seluruh baris feed lama terbaca sebagai "upsert".
ALTER TABLE "SyncLog" ADD COLUMN "op" TEXT NOT NULL DEFAULT 'upsert';
```

Catatan: `DEFAULT CURRENT_TIMESTAMP` di sini sah karena berada di dalam `CREATE TABLE`. SQLite melarangnya hanya pada `ALTER TABLE … ADD COLUMN` (jebakan SPEC-408).

- [x] **Step 5: Tambahkan `SyncTombstone` ke `PG_ORDER`**

Di `cli/src/commands/migrate-pg.ts:26`, ganti baris:

```ts
  "SyncLog", "LocalBinding", "SyncOutbox", "SyncState", "SyncConflict",
```

menjadi:

```ts
  // SPEC-799 · ADR-0119 · SyncTombstone LOCAL-only, tanpa FK; letaknya bersama tabel sync lain.
  "SyncLog", "LocalBinding", "SyncOutbox", "SyncState", "SyncConflict", "SyncTombstone",
```

`cli/test/migrate-pg.test.ts` menuntut daftar ini sama persis dengan DMMF — model baru yang tak didaftarkan membuat test itu merah, dan itulah satu-satunya gerbangnya.

- [x] **Step 6: Tulis `server/src/services/tombstone.ts`**

```ts
import { prisma } from "../db";

// SPEC-799 · ADR-0119 · satu-satunya pemilik tabel SyncTombstone. Nol dependency selain `db` supaya
// sync.ts (hub) dan sync-client.ts (client) sama-sama bisa memakainya tanpa siklus impor.
//
// Ide intinya: tombstone BUKAN mekanisme kedua di samping version-stamp — ia versi record itu
// sendiri, berkeadaan "dihapus". Karena itu ia selalu membawa `version`, dan `writeTombstone`
// monoton: keadaan yang lebih tua tak boleh menimpa yang lebih baru walau tiba belakangan.
export type Tombstone = {
  entity: string; recordId: string; version: number;
  data: Record<string, unknown>; deletedAt: Date; deviceId: string | null;
};

const view = (r: {
  entity: string; recordId: string; version: number; data: unknown; deletedAt: Date; deviceId: string | null;
}): Tombstone => ({
  entity: r.entity, recordId: r.recordId, version: r.version,
  data: (r.data ?? {}) as Record<string, unknown>, deletedAt: r.deletedAt, deviceId: r.deviceId,
});

export async function findTombstone(entity: string, recordId: string): Promise<Tombstone | null> {
  const row = await prisma.syncTombstone.findUnique({ where: { entity_recordId: { entity, recordId } } });
  return row ? view(row) : null;
}

export async function writeTombstone(
  entity: string, recordId: string, version: number,
  data: Record<string, unknown>, deviceId?: string,
): Promise<Tombstone> {
  const prev = await findTombstone(entity, recordId);
  if (prev && prev.version >= version) return prev;
  const row = await prisma.syncTombstone.upsert({
    where: { entity_recordId: { entity, recordId } },
    create: { entity, recordId, version, data: data as object, deviceId: deviceId ?? null },
    update: { version, data: data as object, deviceId: deviceId ?? null, deletedAt: new Date() },
  });
  return view(row);
}

// Dipakai saat sebuah id yang bertombstone sengaja dibuat ulang (id customAgent/githubIssue
// deterministik, id project dipilih manusia — pemakaian ulang id adalah keadaan nyata).
export async function clearTombstone(entity: string, recordId: string): Promise<void> {
  await prisma.syncTombstone.deleteMany({ where: { entity, recordId } });
}
```

- [x] **Step 7: Terapkan migration & generate client**

```bash
cd server && npx prisma generate && cd ..
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/tombstone.service.test.ts
```
Expected: PASS 5/5. (`server/test/global-setup.ts` menjalankan migrasi ke DB test secara otomatis.)

- [x] **Step 8: Jalankan test kontrak PG_ORDER + typecheck**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism cli/test/migrate-pg.test.ts
pnpm --filter ./server typecheck
```
Expected: PASS, typecheck bersih.

- [x] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260815120000_sync_tombstone \
        server/src/services/tombstone.ts server/test/tombstone.service.test.ts cli/src/commands/migrate-pg.ts
git commit -m "feat(spec-799): tabel SyncTombstone + kolom SyncLog.op

Tombstone = versi record itu sendiri, berkeadaan dihapus. Hard-delete
dipertahankan: cascade tingkat-DB tetap bekerja dan nol query baca berubah.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Sisi hub — feed membawa `op`, `applyPush` menolak kebangkitan

**Files:**
- Modify: `server/src/services/sync.ts`
- Test: `server/test/sync-tombstone.service.test.ts`

**Interfaces:**
- Consumes: `findTombstone`/`writeTombstone`/`clearTombstone` dari Task 1
- Produces:
  - `type SyncOp = "upsert" | "delete"`
  - `PulledRecord = { entity: string; recordId: string; version: number; op: SyncOp; data: unknown }`
  - `PushResult = { ok: true; version: number } | { ok: false; conflict: true; deleted?: boolean; deletedVersion?: number; server: Snapshot | null }`
  - `applyPush(entity, id, baseVersion, data, deviceId?, op?: SyncOp): Promise<PushResult>`
  - `publishDelete(entity: Entity, id: string): Promise<void>`
  - `deleteRow(entity: Entity, id: string): Promise<void>`
  - `consumeTombstoneOnRecreate(entity: Entity, id: string): Promise<boolean>`
  - `PARENTS: Partial<Record<Entity, { field: string; entity: Entity }[]>>`
  - `AcceptedHook` row bertambah `op: SyncOp`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/sync-tombstone.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  applyPush, pull, snapshot, publishDelete, backfillFeed, deleteRow,
  consumeTombstoneOnRecreate, setAcceptedHook,
} from "../src/services/sync";
import { findTombstone, writeTombstone } from "../src/services/tombstone";

const clean = async () => {
  await prisma.syncTombstone.deleteMany(); await prisma.syncLog.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(async () => { setAcceptedHook(undefined); await clean(); });

const project = () => prisma.project.create({
  data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: "/local/only" },
});
const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang",
  author: "a@b.co", objective: "o", ...over,
});

describe("hub: tombstone di change-feed (SPEC-799 · ADR-0119)", () => {
  it("push op=delete menghapus baris, menulis tombstone, meng-append feed op=delete", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    const r = await applyPush("spec", "SPEC-1", 1, {}, "dev-1", "delete");

    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await findTombstone("spec", "SPEC-1")).toMatchObject({ version: 2 });

    const feed = (await pull("0")).records;
    const last = feed[feed.length - 1]!;
    expect(last).toMatchObject({ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete" });
  });

  it("baris feed op=delete membawa snapshot TERAKHIR — kontrak kompat client lama", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData({ title: "judul terakhir" }));
    await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");
    const last = (await pull("0")).records.at(-1)!;
    expect(last.data).toMatchObject({ title: "judul terakhir", projectId: "p1" });
  });

  it("delete menang TANPA SYARAT: baseVersion basi tetap diterima", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    await applyPush("spec", "SPEC-1", 1, specData({ stage: "executing" }));
    const r = await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete"); // basi (server di 2)
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });

  it("delete atas id yang tak pernah ada = ok, tombstone tetap lahir", async () => {
    const r = await applyPush("spec", "SPEC-HANTU", 0, {}, undefined, "delete");
    expect(r).toMatchObject({ ok: true, version: 1 });
    expect(await findTombstone("spec", "SPEC-HANTU")).not.toBeNull();
  });

  it("delete berulang IDEMPOTEN: nol baris feed kedua, version tak naik", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");
    const before = await prisma.syncLog.count();
    const r = await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(await prisma.syncLog.count()).toBe(before);
  });

  it("upsert atas id bertombstone DITOLAK sebagai conflict ber-deleted", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");
    const r = await applyPush("spec", "SPEC-1", 1, specData({ title: "BANGKIT" }));
    expect(r).toMatchObject({ ok: false, conflict: true, deleted: true, deletedVersion: 2, server: null });
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });

  it("insert id-absen yang bertombstone tak lagi otomatis diterima (jalur 2 brief)", async () => {
    await project();
    await writeTombstone("spec", "SPEC-9", 4, {});
    const r = await applyPush("spec", "SPEC-9", 0, specData());
    expect(r).toMatchObject({ ok: false, conflict: true, deleted: true });
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-9" } })).toBeNull();
  });

  it("push ber-baseVersion = versi tombstone DITERIMA (pembuatan ulang yang sah)", async () => {
    await project();
    await writeTombstone("spec", "SPEC-9", 4, {});
    const r = await applyPush("spec", "SPEC-9", 4, specData({ title: "lahir lagi" }));
    expect(r).toMatchObject({ ok: true, version: 5 });
    expect(await findTombstone("spec", "SPEC-9")).toBeNull();
    expect((await snapshot("spec", "SPEC-9"))?.data).toMatchObject({ title: "lahir lagi" });
  });

  it("publishDelete memicu siar ber-op delete", async () => {
    const seen: { op?: string; recordId: string }[] = [];
    setAcceptedHook((row) => { seen.push(row as never); });
    await project();
    await prisma.spec.create({ data: { id: "SPEC-2", version: 1, ...specData() } });
    const snap = (await snapshot("spec", "SPEC-2"))!;
    await deleteRow("spec", "SPEC-2");
    await writeTombstone("spec", "SPEC-2", snap.version + 1, snap.data);
    await publishDelete("spec", "SPEC-2");
    expect(seen.at(-1)).toMatchObject({ recordId: "SPEC-2", op: "delete" });
    setAcceptedHook(undefined);
  });

  it("backfillFeed mempublish tombstone yang belum punya baris feed", async () => {
    await writeTombstone("project", "p-lama", 3, { name: "p-lama" });
    const n = await backfillFeed();
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await pull("0")).records).toContainEqual(
      expect.objectContaining({ entity: "project", recordId: "p-lama", op: "delete", version: 3 }),
    );
    const again = await backfillFeed();
    expect(again).toBe(0); // idempoten
  });

  it("consumeTombstoneOnRecreate mengangkat version baris baru ke versi tombstone", async () => {
    await project();
    await writeTombstone("spec", "SPEC-5", 6, {});
    await prisma.spec.create({ data: { id: "SPEC-5", ...specData() } }); // lahir di version 0
    expect(await consumeTombstoneOnRecreate("spec", "SPEC-5")).toBe(true);
    expect(await findTombstone("spec", "SPEC-5")).toBeNull();
    expect((await snapshot("spec", "SPEC-5"))?.version).toBe(6);
  });

  // Kendala eksplisit brief: rename BUKAN hapus — keduanya tak boleh saling menelan.
  it("rename project tidak melahirkan tombstone bagi id lama", async () => {
    await project();
    await applyPush("project", "p2", 0, { name: "p1", desc: "d", kind: "existing", renamedFrom: "p1" });
    expect(await findTombstone("project", "p1")).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "p2" } })).not.toBeNull();
  });

  it("rename ke id yang BERTOMBSTONE ditolak, bukan diam-diam membangkitkannya", async () => {
    await project();
    await writeTombstone("project", "p2", 3, {});
    const r = await applyPush("project", "p2", 0, { name: "p1", desc: "d", kind: "existing", renamedFrom: "p1" });
    expect(r).toMatchObject({ ok: false, conflict: true, deleted: true });
    expect(await prisma.project.findUnique({ where: { id: "p2" } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "p1" } })).not.toBeNull(); // tak ikut hilang
  });

  it("consumeTombstoneOnRecreate no-op bila barisnya memang tak ada", async () => {
    await writeTombstone("spec", "SPEC-6", 2, {});
    expect(await consumeTombstoneOnRecreate("spec", "SPEC-6")).toBe(false);
    expect(await findTombstone("spec", "SPEC-6")).not.toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/sync-tombstone.service.test.ts
```
Expected: FAIL — `publishDelete`/`deleteRow`/`consumeTombstoneOnRecreate` belum diekspor.

- [x] **Step 3: `sync.ts` — impor, tipe delegate, `PARENTS`**

Di atas berkas, tambahkan impor:

```ts
import { findTombstone, writeTombstone, clearTombstone } from "./tombstone";
```

Pada `type Delegate` (~baris 19), tambahkan satu method:

```ts
  delete: (args: { where: { id: string } }) => Promise<unknown>;
```

Sesudah `DATE_FIELDS` (~baris 82), tambahkan peta relasi:

```ts
// SPEC-799 · ADR-0119 · relasi FK antar entitas SYNCED. Dipakai penerima untuk MEMBUANG record anak
// yang datang bagi induk yang sudah bertombstone — dulu jatuh ke `console.warn("induk absen?")`,
// yaitu tebakan, bukan keputusan. Peta ini KONTRAK yang disalin dari skema dan karena itu basi
// diam-diam begitu FK baru lahir; `sync-parents-dmmf.test.ts` menegakkannya (preseden PG_ORDER).
//
// `sessionResult` sengaja ABSEN: `projectId`-nya kolom polos TANPA @relation, jadi menghapus project
// memang tak merambat ke sana. `ticketAttachment.projectId` juga bukan FK (denormal untuk query murah)
// — yang FK hanyalah `ticketId`.
export const PARENTS: Partial<Record<Entity, { field: string; entity: Entity }[]>> = {
  spec: [{ field: "projectId", entity: "project" }],
  ticket: [{ field: "projectId", entity: "project" }],
  ticketAttachment: [{ field: "ticketId", entity: "ticket" }],
  customAgent: [{ field: "projectId", entity: "project" }],
  githubIssue: [{ field: "projectId", entity: "project" }],
};
```

- [x] **Step 4: `sync.ts` — `op` di wire, `deleteRow`, `publishDelete`, `consumeTombstoneOnRecreate`**

Ganti deklarasi `PulledRecord` (~baris 222) dan `pull` (~baris 224-236):

```ts
export type SyncOp = "upsert" | "delete";
export type PulledRecord = { entity: string; recordId: string; version: number; op: SyncOp; data: unknown };

export async function pull(sinceCursor: string, limit = 500): Promise<{ cursor: string; records: PulledRecord[] }> {
  // SPEC-398 · ADR-0086 · `SyncLog.seq` kini `Int` (SQLite hanya meng-auto-isi alias rowid ber-tipe
  // deklarasi tepat `INTEGER`). Kursor tetap STRING di wire — jangan ubah bentuk itu.
  const since = Number(sinceCursor || "0");
  const rows = await prisma.syncLog.findMany({
    where: { seq: { gt: since } }, orderBy: { seq: "asc" }, take: limit,
  });
  const cursor = rows.length ? String(rows[rows.length - 1]!.seq) : sinceCursor || "0";
  return {
    cursor,
    records: rows.map((r) => ({
      entity: r.entity, recordId: r.recordId, version: r.version,
      op: r.op === "delete" ? "delete" : "upsert", data: r.data,
    })),
  };
}
```

Ganti `AcceptedHook` (~baris 304):

```ts
export type AcceptedHook = (row: {
  entity: string; recordId: string; version: number; op: SyncOp; data: unknown; seq: string;
}) => void;
```

Lalu setiap pemanggilan `onAccepted?.({...})` yang sudah ada (tiga: cabang rename, cabang upsert `applyPush`, dan `publishLocal`) ditambahi `op: "upsert"`, dan `prisma.syncLog.create` masing-masing ditambahi `op: "upsert"`. Contoh untuk `publishLocal`:

```ts
  const log = await prisma.syncLog.create({
    data: { entity, recordId: id, version: newVersion, op: "upsert", data: (snap.data ?? {}) as object, deviceId: null },
  });
  onAccepted?.({ entity, recordId: id, version: newVersion, op: "upsert", data: snap.data ?? {}, seq: String(log.seq) });
```

Sesudah `publishLocal`, tambahkan tiga fungsi:

```ts
// SPEC-799 · ADR-0119 · penghapusan baris tersync lewat satu pintu, supaya `deleteSynced` (dan hanya
// ia) tak perlu tahu delegate Prisma mana yang dipakai entitas mana.
export async function deleteRow(entity: Entity, id: string): Promise<void> {
  await DELEGATE[entity].delete({ where: { id } });
}

// SPEC-799 · ADR-0119 · publish TOMBSTONE ke change-feed + siar (peran hub). Cermin publishLocal,
// bedanya barisnya sudah tak ada — snapshot terakhirnya datang dari tombstone.
//
// `data` sengaja tetap snapshot yang SAH, bukan objek kosong atau berpenanda: client versi lama
// memvalidasinya lalu menerapkannya sebagai upsert biasa, jadi delete "hanya" tak menyeberang ke
// sana. Bentuk apa pun yang gagal `validateSyncData` di sana justru menyalakan `feedHole` dan
// menahan kursornya SELAMANYA — mandek total, bukan sekadar melewatkan tombstone.
export async function publishDelete(entity: Entity, id: string): Promise<void> {
  const tomb = await findTombstone(entity, id);
  if (!tomb) return;
  const log = await prisma.syncLog.create({
    data: { entity, recordId: id, version: tomb.version, op: "delete", data: tomb.data as object, deviceId: tomb.deviceId ?? null },
  });
  onAccepted?.({ entity, recordId: id, version: tomb.version, op: "delete", data: tomb.data, seq: String(log.seq) });
}

// SPEC-799 · ADR-0119 · id bertombstone yang barisnya ada lagi = seseorang membuatnya ulang. Id
// `customAgent` ("<scope>:<name>") dan `githubIssue` ("<projectId>:<slug>#<n>") DETERMINISTIK, jadi
// pemakaian ulang id yang sama persis adalah keadaan nyata, bukan hipotesis.
//
// Versi baris diangkat ke versi tombstone karena baris baru lahir di `version = 0`: tanpa itu push
// berikutnya membawa `baseVersion = 0` melawan tombstone hub di versi jauh lebih tinggi, dan
// pembuatan ulang yang sah ditolak SELAMANYA tanpa satu pun jalan keluar dari UI.
export async function consumeTombstoneOnRecreate(entity: Entity, id: string): Promise<boolean> {
  const tomb = await findTombstone(entity, id);
  if (!tomb) return false;
  const row = await DELEGATE[entity].findUnique({ where: { id }, select: { version: true } });
  if (!row) return false;
  await clearTombstone(entity, id);
  if (Number(row.version) < tomb.version) {
    await DELEGATE[entity].update({ where: { id }, data: { version: tomb.version } });
  }
  return true;
}
```

- [x] **Step 5: `sync.ts` — `applyPush` sadar tombstone**

Ganti tanda tangan `applyPush` dan `PushResult` (~baris 167-175):

```ts
export type PushResult =
  | { ok: true; version: number }
  // SPEC-799 · `deleted` menerangkan MENGAPA ia konflik: id-nya sudah bertombstone di hub, dan
  // `server` karena itu null. Kedua field aditif — client versi lama mengabaikannya dan sekadar
  // mengulang push tanpa efek (tak ada yang rusak, tak ada yang mandek).
  | { ok: false; conflict: true; deleted?: boolean; deletedVersion?: number; server: Snapshot | null };

// Terapkan satu push ber-optimistic-concurrency. Insert (id absen TANPA tombstone) diterima → version 1.
// Update diterima hanya bila baseVersion === version server; else konflik (server tak ditimpa).
// SPEC-799 · ADR-0119 · `op:"delete"` = TOMBSTONE, dan ia menang TANPA SYARAT (tak melihat
// baseVersion sama sekali) — itulah yang membuat hasil hapus-vs-edit independen urutan tiba.
export async function applyPush(
  entity: Entity, id: string, baseVersion: number, data: Record<string, unknown>,
  deviceId?: string, op: SyncOp = "upsert",
): Promise<PushResult> {
  validateSyncData(entity, data, { allowProjectRename: true });

  if (op === "delete") {
    // Idempoten: tombstone yang sudah ada BUKAN error dan BUKAN baris feed kedua. Tanpa gerbang ini
    // push berulang menaikkan version tanpa ujung dan setiap client berputar menariknya.
    const already = await findTombstone(entity, id);
    if (already) return { ok: true, version: already.version };
    const snap = await snapshot(entity, id);
    const version = (snap?.version ?? baseVersion) + 1;
    if (snap) await DELEGATE[entity].delete({ where: { id } }); // cascade DB merambat ke anak
    await writeTombstone(entity, id, version, snap?.data ?? data, deviceId);
    await publishDelete(entity, id);
    return { ok: true, version };
  }
  ...
```

Blok rename (`if (entity === "project" && ... renamedFrom ...)`) berada **di bawah** blok delete dan isinya tetap seperti sekarang, kecuali satu gerbang baru sebagai baris pertamanya:

```ts
    const oldId = data.renamedFrom;
    // SPEC-799 · ADR-0119 · rename BUKAN hapus, dan keduanya tak boleh saling menelan: id tujuan
    // yang sudah bertombstone tak boleh dihidupkan lewat pintu rename yang memang MELEWATI
    // optimistic-concurrency biasa. Ditolak dengan alasan yang sama seperti upsert, dan project
    // asalnya sengaja dibiarkan utuh — rename yang gagal tak boleh menghilangkan apa pun.
    const destTomb = await findTombstone("project", id);
    if (destTomb) {
      return { ok: false, conflict: true, deleted: true, deletedVersion: destTomb.version, server: null };
    }
    const already = await DELEGATE.project.findUnique({ where: { id }, select: { version: true } });
```

Sesudahnya, ganti tiga baris pengecekan versi (~baris 201-205):

```ts
  // SPEC-799 · ADR-0119 · "versi record saat ini" kini datang dari BARIS ATAU TOMBSTONE — keduanya
  // saling eksklusif. Dengan begitu penolakan kebangkitan jatuh dari aturan optimistic-concurrency
  // yang sudah ada, tanpa cabang khusus: id yang mati di version 6 hanya bisa dihidupkan oleh
  // tulisan yang TAHU tentang version 6.
  const tomb = await findTombstone(entity, id);
  const existing = await DELEGATE[entity].findUnique({ where: { id }, select: { version: true } });
  const currentVersion = existing ? Number(existing.version) : tomb ? tomb.version : null;
  if (currentVersion !== null && currentVersion !== baseVersion) {
    return {
      ok: false, conflict: true, server: await snapshot(entity, id),
      ...(tomb && !existing ? { deleted: true, deletedVersion: tomb.version } : {}),
    };
  }
  const newVersion = (currentVersion ?? 0) + 1;
```

Sesudah `upsert` berhasil (sebelum `const snap = await snapshot(...)` yang menutup fungsi), tambahkan:

```ts
  if (tomb) await clearTombstone(entity, id); // pembuatan ulang yang sah menang atas tombstone
```

dan tambahkan `op: "upsert"` pada `syncLog.create` + `onAccepted` di jalur ini.

- [x] **Step 6: `sync.ts` — `backfillFeed` mencakup tombstone**

Sesudah loop entitas yang sudah ada di `backfillFeed`, sebelum `return published`:

```ts
  // SPEC-799 · ADR-0119 · tombstone juga bagian keadaan. Instance yang dulu berperan CLIENT punya
  // tombstone TANPA baris feed (peran client mengantre outbox, tak pernah menulis SyncLog); tanpa
  // sapuan ini, promosi jadi hub membuat penghapusan itu tak pernah menyeberang ke siapa pun.
  for (const t of await prisma.syncTombstone.findMany({ select: { entity: true, recordId: true, version: true } })) {
    if (!isEntity(t.entity)) continue;
    const has = await prisma.syncLog.findFirst({
      where: { entity: t.entity, recordId: t.recordId, version: t.version, op: "delete" }, select: { seq: true },
    });
    if (has) continue;
    await publishDelete(t.entity, t.recordId);
    published++;
  }
```

- [x] **Step 7: Jalankan test — pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/sync-tombstone.service.test.ts
```
Expected: PASS 12/12.

- [x] **Step 8: Jalankan test sync yang SUDAH ada — pastikan tak ada regresi**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/sync.service.test.ts server/test/sync.route.test.ts server/test/sync-ws.test.ts \
  server/test/sync-exclusions.test.ts server/test/sync-hub-origin-writes.test.ts
pnpm --filter ./server typecheck
```
Expected: semuanya PASS. Bila `sync-ws.test.ts` gagal soal bentuk frame, sebabnya field `op` baru di siar — perbarui ekspektasinya, itu memang kontrak yang berubah.

- [x] **Step 9: Commit**

```bash
git add server/src/services/sync.ts server/src/services/tombstone.ts server/test/sync-tombstone.service.test.ts
git commit -m "feat(spec-799): hub menerbitkan tombstone & menolak kebangkitan

applyPush membaca 'versi saat ini' dari baris ATAU tombstone, jadi penolakan
kebangkitan jatuh dari optimistic-concurrency yang sudah ada. op=delete menang
tanpa syarat & idempoten; baris feed tetap membawa snapshot sah demi client lama.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `deleteSynced()` — satu panggilan, sadar-peran

**Files:**
- Create: `server/src/services/sync-delete.ts`
- Modify: `server/src/services/sync-notify.ts`
- Test: `server/test/sync-delete.service.test.ts`

**Interfaces:**
- Consumes: `snapshot`/`deleteRow`/`consumeTombstoneOnRecreate`/`publishDelete` (Task 2), `writeTombstone`/`findTombstone` (Task 1), `enqueueOutbox`/`listOutbox` (`services/outbox`)
- Produces:
  - `notifyDeleted(entity: string, id: string): Promise<void>`
  - `deleteSynced(entity: Entity, id: string, deviceId?: string): Promise<boolean>`
  - `listPendingDeletes(): Promise<{ entity: string; recordId: string; deletedAt: string }[]>`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/sync-delete.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { deleteSynced, listPendingDeletes } from "../src/services/sync-delete";
import { notifySynced } from "../src/services/sync-notify";
import { findTombstone } from "../src/services/tombstone";
import { pull, snapshot } from "../src/services/sync";
import { listOutbox } from "../src/services/outbox";
import { clearConfig } from "../src/config";

const clean = async () => {
  await prisma.runtimeConfig.deleteMany(); clearConfig();
  await prisma.syncTombstone.deleteMany(); await prisma.syncLog.deleteMany();
  await prisma.syncOutbox.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const project = () => prisma.project.create({
  data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null },
});
const specRow = (id: string) => prisma.spec.create({
  data: { id, projectId: "p1", title: "t", source: "brief", stage: "planned",
          priority: "sedang", author: "a", objective: "o", version: 4 },
});
const asClient = async () => {
  await prisma.runtimeConfig.create({ data: { key: "SYNC_SERVER_URL", value: "http://hub.test" } });
  clearConfig();
};

describe("deleteSynced (SPEC-799 · ADR-0119)", () => {
  it("peran HUB: hapus baris, tulis tombstone, terbitkan ke feed", async () => {
    await project(); await specRow("SPEC-1");
    expect(await deleteSynced("spec", "SPEC-1")).toBe(true);

    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await findTombstone("spec", "SPEC-1")).toMatchObject({ version: 5 });
    expect((await pull("0")).records).toContainEqual(
      expect.objectContaining({ entity: "spec", recordId: "SPEC-1", op: "delete", version: 5 }),
    );
    expect(await listOutbox()).toHaveLength(0);
  });

  it("peran CLIENT: tombstone + outbox, TANPA menulis feed", async () => {
    await asClient();
    await project(); await specRow("SPEC-1");
    await deleteSynced("spec", "SPEC-1");

    expect(await findTombstone("spec", "SPEC-1")).not.toBeNull();
    expect((await listOutbox()).map((o) => o.recordId)).toContain("SPEC-1");
    expect((await pull("0")).records.filter((r) => r.op === "delete")).toHaveLength(0);
  });

  it("baris yang tak ada → false, tanpa tombstone & tanpa feed", async () => {
    expect(await deleteSynced("spec", "SPEC-HANTU")).toBe(false);
    expect(await findTombstone("spec", "SPEC-HANTU")).toBeNull();
    expect((await pull("0")).records).toHaveLength(0);
  });

  it("listPendingDeletes hanya melaporkan outbox yang barisnya sudah tak ada", async () => {
    await asClient();
    await project(); await specRow("SPEC-1"); await specRow("SPEC-2");
    await deleteSynced("spec", "SPEC-1");
    await notifySynced("spec", "SPEC-2"); // edit biasa → outbox, TAPI barisnya masih ada

    const pending = await listPendingDeletes();
    expect(pending.map((p) => p.recordId)).toEqual(["SPEC-1"]);
  });

  it("membuat ulang id bertombstone lalu notifySynced → tombstone dikonsumsi, version terangkat", async () => {
    await asClient();
    await project(); await specRow("SPEC-1");
    await deleteSynced("spec", "SPEC-1");          // tombstone di version 5
    await specRow("SPEC-1");                        // lahir lagi (version 4 dari fixture)
    await notifySynced("spec", "SPEC-1");

    expect(await findTombstone("spec", "SPEC-1")).toBeNull();
    expect((await snapshot("spec", "SPEC-1"))?.version).toBe(5);
    expect(await listPendingDeletes()).toHaveLength(0);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/sync-delete.service.test.ts
```
Expected: FAIL — `Cannot find module '../src/services/sync-delete'`.

- [x] **Step 3: Tulis `server/src/services/sync-delete.ts`**

```ts
import { snapshot, deleteRow, type Entity } from "./sync";
import { writeTombstone, findTombstone } from "./tombstone";
import { notifyDeleted } from "./sync-notify";
import { listOutbox } from "./outbox";

// SPEC-799 · ADR-0119 · SATU panggilan untuk menghapus record tersync: baca versi + snapshot
// (sesudah delete barisnya tak ada lagi, jadi urutannya bukan selera), hapus, tulis tombstone,
// terbitkan sadar-peran. Memecahnya jadi tiga langkah berarti setiap call site baru harus
// mengingat ketiganya BERIKUT urutannya — kelas bug yang sudah menggigit repo ini empat kali
// (SPEC-431/448/475/481) dan pelajaran `releaseWorktree()` di ADR-0116.
export async function deleteSynced(entity: Entity, id: string, deviceId?: string): Promise<boolean> {
  const snap = await snapshot(entity, id);
  if (!snap) return false;
  await deleteRow(entity, id); // cascade tingkat-DB merambat ke anak; penerima melakukan hal sama
  await writeTombstone(entity, id, snap.version + 1, snap.data, deviceId);
  await notifyDeleted(entity, id);
  return true;
}

// SPEC-799 · penghapusan yang masih menunggu jendela online: entri outbox yang barisnya sudah tak
// ada TAPI tombstone-nya ada. Tanpa umpan balik ini operator membaca "hapusnya gagal" lalu
// mengulanginya, dan penghapusan yang tak terlihat efeknya adalah penghapusan yang dikira gagal.
export async function listPendingDeletes(): Promise<{ entity: string; recordId: string; deletedAt: string }[]> {
  const out: { entity: string; recordId: string; deletedAt: string }[] = [];
  for (const item of await listOutbox()) {
    const tomb = await findTombstone(item.entity, item.recordId);
    if (!tomb) continue;
    out.push({ entity: item.entity, recordId: item.recordId, deletedAt: tomb.deletedAt.toISOString() });
  }
  return out;
}
```

Entri outbox yang punya tombstone **selalu** berarti "delete menunggu": `deleteSynced` menghapus barisnya lebih dulu, dan id yang dibuat ulang sudah kehilangan tombstone-nya lewat `consumeTombstoneOnRecreate` di `notifySynced`.

- [x] **Step 4: `sync-notify.ts` — `notifyDeleted` + konsumsi tombstone**

Ganti seluruh isi `server/src/services/sync-notify.ts`:

```ts
import { effectiveStr } from "../config";
import { enqueueOutbox } from "./outbox";
import { publishLocal, publishDelete, consumeTombstoneOnRecreate, isEntity, type Entity } from "./sync";

// SPEC-268 · ADR-0066 · sebarkan write LOKAL ke peer, sadar-peran:
//  - client (SYNC_SERVER_URL ada) → enqueueOutbox → syncOnce push ke hub (perilaku lama).
//  - hub (SYNC_SERVER_URL kosong) → publishLocal → masuk change-feed sendiri → client pull.
// Best-effort: kegagalan TIDAK menggagalkan write utama (cermin enqueueOutbox).
export async function notifySynced(entity: string, id: string): Promise<void> {
  try {
    if (!isEntity(entity)) return;
    // SPEC-799 · ADR-0119 · id bertombstone yang barisnya ada lagi = seseorang membuatnya ulang.
    // Lapisnya duduk DI SINI, choke point yang sudah dipanggil setiap tulisan lokal — menaruhnya
    // di tiap jalur `create` adalah kelas bug SPEC-431/448/475/481.
    await consumeTombstoneOnRecreate(entity, id);
    if (effectiveStr("SYNC_SERVER_URL")) await enqueueOutbox(entity, id);
    else await publishLocal(entity, id);
  } catch { /* jangan blok write utama */ }
}

// SPEC-799 · ADR-0119 · cermin persis notifySynced untuk penghapusan. Tombstone-nya sudah ditulis
// pemanggil (`deleteSynced`) — yang di sini murni penyebarannya, supaya kedua peran punya bentuk
// yang sama dan tak ada satu pun call site yang harus tahu ia sedang berperan apa.
export async function notifyDeleted(entity: string, id: string): Promise<void> {
  try {
    if (!isEntity(entity)) return;
    if (effectiveStr("SYNC_SERVER_URL")) await enqueueOutbox(entity, id);
    else await publishDelete(entity as Entity, id);
  } catch { /* jangan blok write utama */ }
}
```

- [x] **Step 5: Jalankan test — pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/sync-delete.service.test.ts server/test/sync-notify.test.ts
pnpm --filter ./server typecheck
```
Expected: keduanya PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/services/sync-delete.ts server/src/services/sync-notify.ts server/test/sync-delete.service.test.ts
git commit -m "feat(spec-799): deleteSynced() satu panggilan + notifyDeleted sadar-peran

notifySynced sekaligus mengonsumsi tombstone saat id-nya dibuat ulang: choke
point yang sudah ada, bukan lapis baru di tiap jalur create.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Sisi client — menerapkan tombstone, mem-push delete, membuang yatim dengan sengaja

**Files:**
- Modify: `server/src/services/sync-client.ts`
- Modify: `server/src/services/notifications.ts`
- Modify: `server/src/routes/sync.ts` (hanya `zPush` + penerusan `op`)
- Test: `server/test/sync-tombstone.client.test.ts`, `server/test/sync-tombstone.compat.test.ts`, `server/test/sync-parents-dmmf.test.ts`

**Interfaces:**
- Consumes: `PARENTS`/`SyncOp`/`deleteRow`/`snapshot` (Task 2), `findTombstone`/`writeTombstone`/`clearTombstone` (Task 1)
- Produces:
  - `SyncStats = { pulled: number; pushed: number; conflicts: number; deleted: number; dropped: number }`
  - `validateIncomingRecord(input): { entity; recordId; version; data; op: SyncOp | null }` — `op: null` = jenis dari hub yang lebih baru
  - `applyRemote(entity, recordId, version, data, op?: SyncOp): Promise<"applied" | "dropped">`
  - `recordSyncDelete(entity: string, recordId: string, version: number, title: string): Promise<void>` (di `notifications.ts`)

- [x] **Step 1: Tulis test yang gagal — perilaku client**

Buat `server/test/sync-tombstone.client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { applyPush } from "../src/services/sync";
import { enqueueOutbox, listOutbox } from "../src/services/outbox";
import { syncOnce, setCursor, getCursor, applyFeedFrame, validateIncomingRecord, type Transport } from "../src/services/sync-client";
import { findTombstone, writeTombstone } from "../src/services/tombstone";
import { deleteSynced } from "../src/services/sync-delete";
import { clearConfig } from "../src/config";

const app = buildApp();
const clean = async () => {
  await prisma.runtimeConfig.deleteMany(); clearConfig();
  await prisma.notification.deleteMany();
  await prisma.syncTombstone.deleteMany(); await prisma.syncConflict.deleteMany();
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany(); await prisma.syncState.deleteMany();
  await prisma.ticketAttachment.deleteMany(); await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

// Transport palsu: kita mengarang isi feed langsung, jadi kedua sisi bisa diuji di satu proses.
function fakeTransport(records: unknown[], cursor = "99", onPush?: (body: any) => any): Transport {
  return async (method, path, body) => {
    if (method === "GET") return { status: 200, body: { cursor, records } };
    return { status: 200, body: onPush ? onPush(body) : { results: [{ ok: true, version: 1 }] } };
  };
}
const project = () => prisma.project.create({
  data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null },
});
const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang",
  author: "a", objective: "o", ...over,
});

describe("client: menerapkan tombstone (SPEC-799 · ADR-0119)", () => {
  it("tombstone dari feed menghapus baris lokal + menyimpan tombstone + memajukan kursor", async () => {
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 1, ...specData() } });
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData() }]);

    const s = await syncOnce(t);
    expect(s.deleted).toBe(1);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await findTombstone("spec", "SPEC-1")).toMatchObject({ version: 2 });
    expect(await getCursor()).toBe("99");
  });

  it("tombstone untuk baris yang TAK PERNAH ada = no-op sukses, kursor tetap maju", async () => {
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-ASING", version: 3, op: "delete", data: {} }]);
    const s = await syncOnce(t);
    expect(s.deleted).toBe(1);
    expect(await findTombstone("spec", "SPEC-ASING")).not.toBeNull();
    expect(await getCursor()).toBe("99");
  });

  it("upsert BASI atas id bertombstone dibuang (replay full-pull tak membangkitkan)", async () => {
    await project();
    await writeTombstone("spec", "SPEC-1", 5, {});
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-1", version: 4, data: specData() }]);
    const s = await syncOnce(t);
    expect(s.dropped).toBe(1);
    expect(s.pulled).toBe(0);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });

  it("upsert ber-version LEBIH TINGGI menghidupkan (pembuatan ulang sah dari hub)", async () => {
    await project();
    await writeTombstone("spec", "SPEC-1", 5, {});
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-1", version: 6, data: specData({ title: "lahir lagi" }) }]);
    const s = await syncOnce(t);
    expect(s.pulled).toBe(1);
    expect(await findTombstone("spec", "SPEC-1")).toBeNull();
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))?.title).toBe("lahir lagi");
  });

  it("record anak untuk induk bertombstone dibuang SENGAJA (bukan warn yatim)", async () => {
    await writeTombstone("project", "p-mati", 2, {});
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-9", version: 1, data: specData({ projectId: "p-mati" }) }]);
    const s = await syncOnce(t);
    expect(s.dropped).toBe(1);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-9" } })).toBeNull();
  });

  it("delete MENANG atas edit lokal pending + melahirkan notifikasi", async () => {
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 1, ...specData({ title: "edit lokal" }) } });
    await enqueueOutbox("spec", "SPEC-1");
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData() }]);

    await syncOnce(t);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await listOutbox()).toHaveLength(0);
    const n = await prisma.notification.findFirst({ where: { key: "sync-delete:spec:SPEC-1:2" } });
    expect(n).not.toBeNull();
  });

  it("op tak dikenal DILEWATI tanpa menyalakan feedHole", async () => {
    await project();
    const t = fakeTransport([
      { entity: "spec", recordId: "SPEC-X", version: 1, op: "gaya-baru", data: specData() },
      { entity: "spec", recordId: "SPEC-Y", version: 1, data: specData() },
    ]);
    const s = await syncOnce(t);
    expect(s.dropped).toBe(1);
    expect(s.pulled).toBe(1);
    expect(await getCursor()).toBe("99");
  });

  it("hapus lokal saat offline → siklus berikutnya mem-push op=delete", async () => {
    await prisma.runtimeConfig.create({ data: { key: "SYNC_SERVER_URL", value: "http://hub.test" } });
    clearConfig();
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 4, ...specData() } });
    await deleteSynced("spec", "SPEC-1");

    let sent: any = null;
    const t = fakeTransport([], "0", (body) => { sent = body; return { results: [{ ok: true, version: 5 }] }; });
    const s = await syncOnce(t);

    expect(s.pushed).toBe(1);
    expect(sent.records[0]).toMatchObject({ entity: "spec", id: "SPEC-1", op: "delete", baseVersion: 4 });
    expect(sent.records[0].data).toMatchObject({ title: "t" }); // snapshot terakhir, demi hub lama
    expect(await listOutbox()).toHaveLength(0);
  });

  it("hub menolak upsert karena sudah dihapus → client mengadopsi tombstone & berhenti mendorong", async () => {
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 1, ...specData() } });
    await enqueueOutbox("spec", "SPEC-1");
    const t = fakeTransport([], "0", () => ({
      results: [{ ok: false, conflict: true, deleted: true, deletedVersion: 7, server: null }],
    }));

    const s = await syncOnce(t);
    expect(s.deleted).toBe(1);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await findTombstone("spec", "SPEC-1")).toMatchObject({ version: 7 });
    expect(await listOutbox()).toHaveLength(0);
  });

  it("frame WS op=delete diterapkan lewat applyFeedFrame", async () => {
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 1, ...specData() } });
    const ok = await applyFeedFrame({ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData(), seq: "12" });
    expect(ok).toBe(true);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await getCursor()).toBe("12");
  });

  it("full pull (kursor 0) memutar ulang feed TANPA membangkitkan yang bertombstone", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const tok = await issueDeviceToken(u.id, "laptop");
    const real: Transport = async (method, path, body) => {
      const res = await app.inject({ method, url: path, headers: { authorization: `Bearer ${tok.token}` }, ...(body ? { payload: body } : {}) });
      return { status: res.statusCode, body: res.json() };
    };
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());              // feed: upsert
    await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");  // feed: delete
    await prisma.spec.deleteMany();                                 // lokal sudah bersih

    await setCursor("0");
    await syncOnce(real);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();

    await setCursor("0");                 // putar ulang lagi — tetap konvergen
    await syncOnce(real);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });
});
```

- [x] **Step 2: Tulis test kompatibilitas**

Buat `server/test/sync-tombstone.compat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateIncomingRecord } from "../src/services/sync-client";

const specData = {
  projectId: "p1", title: "t", source: "brief", stage: "planned",
  priority: "sedang", author: "a", objective: "o",
};

describe("kompat versi campur (SPEC-799 · ADR-0119)", () => {
  it("record TANPA op terbaca sebagai upsert (hub versi lama)", () => {
    expect(validateIncomingRecord({ entity: "spec", recordId: "SPEC-1", version: 1, data: specData }).op).toBe("upsert");
  });

  it("op hidup di TOP-LEVEL, tak menyentuh allowlist data", () => {
    expect(validateIncomingRecord({ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData }).op).toBe("delete");
    // Penanda DI DALAM data tetap ditolak — itulah yang akan membuat client lama mandek.
    expect(() => validateIncomingRecord({
      entity: "spec", recordId: "SPEC-1", version: 2, data: { ...specData, __deleted: true },
    })).toThrow(/field/);
  });

  it("op tak dikenal → null (dilewati), BUKAN melempar", () => {
    expect(validateIncomingRecord({ entity: "spec", recordId: "SPEC-1", version: 2, op: "gaya-baru", data: specData }).op).toBeNull();
  });

  it("data sebuah tombstone tetap lolos kontrak field entitasnya", () => {
    expect(() => validateIncomingRecord({ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData })).not.toThrow();
  });
});
```

- [x] **Step 3: Tulis test kontrak DMMF untuk `PARENTS`**

Buat `server/test/sync-parents-dmmf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { PARENTS, SYNCED, type Entity } from "../src/services/sync";

// SPEC-799 · ADR-0119 · PARENTS disalin dari skema, jadi ia basi DIAM-DIAM begitu FK baru lahir
// antar entitas SYNCED. Gerbangnya cuma test ini (preseden PG_ORDER · cli/test/migrate-pg.test.ts).
const modelOf = (e: Entity) => e.charAt(0).toUpperCase() + e.slice(1);

describe("PARENTS = himpunan FK antar model SYNCED", () => {
  it("tak ada relasi FK antar entitas SYNCED yang terlewat", () => {
    const modelToEntity = new Map(SYNCED.map((e) => [modelOf(e), e] as const));
    const expected: Record<string, { field: string; entity: string }[]> = {};

    for (const entity of SYNCED) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelOf(entity))!;
      for (const f of model.fields) {
        if (f.kind !== "object" || !f.relationFromFields?.length) continue;
        const parent = modelToEntity.get(f.type);
        if (!parent) continue; // relasi ke model di luar SYNCED — bukan urusan mesin sync
        (expected[entity] ??= []).push({ field: f.relationFromFields[0]!, entity: parent });
      }
    }

    const norm = (v: Record<string, { field: string; entity: string }[]>) =>
      Object.fromEntries(Object.entries(v).map(([k, arr]) =>
        [k, [...arr].map((x) => `${x.field}->${x.entity}`).sort()]).sort());

    expect(norm(PARENTS as never)).toEqual(norm(expected));
  });
});
```

- [x] **Step 4: Jalankan ketiga test — pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/sync-tombstone.client.test.ts server/test/sync-tombstone.compat.test.ts server/test/sync-parents-dmmf.test.ts
```
Expected: FAIL — `op` belum ada di `validateIncomingRecord`, `SyncStats` belum punya `deleted`/`dropped`.

- [x] **Step 5: `notifications.ts` — `recordSyncDelete`**

Tambahkan di akhir `server/src/services/notifications.ts`:

```ts
// SPEC-799 · ADR-0119 · delete menang TANPA SYARAT atas edit lokal yang belum sempat ter-push.
// Menang bukan berarti diam: tanpa baris ini suntingan operator lenyap tanpa satu pun jejak, dan
// "hilang tanpa sebab" adalah persis keluhan yang melahirkan spec ini. `key` memuat versi tombstone
// supaya penghapusan BERIKUTNYA atas id yang sudah dibuat ulang tetap punya suaranya sendiri.
export async function recordSyncDelete(
  entity: string, recordId: string, version: number, title: string,
): Promise<void> {
  await prisma.notification.create({
    data: { type: "sync", key: `sync-delete:${entity}:${recordId}:${version}`, title, projectId: null },
  }).catch(() => { /* P2002: sudah ada */ });
}
```

- [x] **Step 6: `sync-client.ts` — `op` di validasi & apply**

Ganti impor teratas:

```ts
import {
  pull as _pull, snapshot, upsertLocal, deleteRow, isEntity, validateSyncData,
  PARENTS, type Entity, type SyncOp,
} from "./sync";
import { findTombstone, writeTombstone, clearTombstone } from "./tombstone";
import { recordSyncDelete } from "./notifications";
```

Ganti `validateIncomingRecord` (baris 18-30):

```ts
const MAX_SYNC_RECORD_BYTES = 1024 * 1024;

// SPEC-799 · ADR-0119 · `op` dibaca dari TOP-LEVEL record dan TIDAK pernah dari `data` — allowlist
// `validateSyncData` akan menolak penanda di sana, dan penolakan itu menyalakan `feedHole` yang
// menahan kursor selamanya. Jenis yang tak dikenal (hub lebih baru) mengembalikan `null` supaya
// pemanggil MELEWATINYA; melempar di sini berarti hub yang lebih baru bisa mematikan client lama.
export function validateIncomingRecord(input: unknown): {
  entity: Entity; recordId: string; version: number; data: Record<string, unknown>; op: SyncOp | null;
} {
  if (!input || typeof input !== "object") throw new Error("sync record harus object");
  const row = input as Record<string, unknown>;
  if (typeof row.entity !== "string" || !isEntity(row.entity)) throw new Error("sync entity tak dikenal");
  if (typeof row.recordId !== "string" || !row.recordId || row.recordId.length > 256) throw new Error("sync recordId invalid");
  if (!Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new Error("sync version invalid");
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) throw new Error("sync data invalid");
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_SYNC_RECORD_BYTES) throw new Error("sync record terlalu besar");
  validateSyncData(row.entity, row.data as Record<string, unknown>, { allowProjectRename: true });
  const op: SyncOp | null =
    row.op === undefined || row.op === null || row.op === "upsert" ? "upsert" : row.op === "delete" ? "delete" : null;
  return { entity: row.entity, recordId: row.recordId, version: Number(row.version), data: row.data as Record<string, unknown>, op };
}
```

Ganti `applyRemote` (baris 42-45) dengan tiga fungsi:

```ts
// SPEC-799 · ADR-0119 · "dropped" = dibuang SENGAJA (bukan gagal): upsert basi atas id bertombstone,
// atau record anak bagi induk yang sudah bertombstone. Membedakannya dari lemparan itu yang membuat
// `syncOnce` tahu mana yang layak ditunda dan mana yang memang sudah selesai urusannya.
export async function applyRemote(
  entity: string, recordId: string, version: number, data: Record<string, unknown>, op: SyncOp = "upsert",
): Promise<"applied" | "dropped"> {
  if (!isEntity(entity)) return "dropped";
  if (op === "delete") { await applyRemoteDelete(entity, recordId, version, data); return "applied"; }

  const tomb = await findTombstone(entity, recordId);
  if (tomb) {
    if (version <= tomb.version) return "dropped";   // replay feed lama — inilah konvergensi full-pull
    await clearTombstone(entity, recordId);          // hub memakai ulang id-nya secara sah
  }
  if (await parentTombstoned(entity, data)) return "dropped";
  await upsertLocal(entity, recordId, version, data);
  return "applied";
}

// Idempoten by construction: tombstone untuk baris yang sudah tak ada = no-op SUKSES. Kalau ia
// melempar, kursor tertahan di depannya (feedHole) dan seluruh sync client mandek — kegagalan
// lama yang ditutup ADR-0082, jangan dibuka lagi lewat pintu ini.
async function applyRemoteDelete(entity: Entity, recordId: string, version: number, data: Record<string, unknown>): Promise<void> {
  const existing = await snapshot(entity, recordId);
  await writeTombstone(entity, recordId, version, existing?.data ?? data);
  if (existing) await deleteRow(entity, recordId);
  const pending = await prisma.syncOutbox.findFirst({ where: { entity, recordId } });
  if (!pending) return;
  await clearOutbox(entity, recordId);
  if (existing) {
    await recordSyncDelete(entity, recordId, version,
      `Dihapus di peer: ${entity} ${recordId} — suntingan lokal yang belum tersinkron dibuang`);
  }
}

// SPEC-799 · ADR-0119 · anak yatim BUKAN anomali: induknya memang dihapus, dan penerima sudah punya
// keadaan itu. Dulu ia jatuh ke `console.warn("induk absen?")` — sebuah tebakan yang tak bisa
// dibedakan dari kegagalan sungguhan.
async function parentTombstoned(entity: Entity, data: Record<string, unknown>): Promise<boolean> {
  for (const p of PARENTS[entity] ?? []) {
    const v = data[p.field];
    if (typeof v !== "string" || !v) continue;
    if (await findTombstone(p.entity, v)) return true;
  }
  return false;
}
```

`applyFeedFrame` meneruskan `op` dan melewati jenis tak dikenal:

```ts
export async function applyFeedFrame(msg: {
  entity?: string; recordId?: string; version?: number; op?: string; data?: Record<string, unknown>; seq?: string | number;
}): Promise<boolean> {
  if (!msg.entity || !msg.recordId) return true; // bukan frame record — tak ada yang bisa hilang
  try {
    const record = validateIncomingRecord({ ...msg, version: Number(msg.version ?? 0), data: msg.data ?? {} });
    // `op` tak dikenal = frame dari hub yang lebih baru. Dilewati, TIDAK menahan kursor: menahannya
    // berarti satu jenis peristiwa masa depan cukup untuk mematikan client ini.
    if (record.op) await applyRemote(record.entity, record.recordId, record.version, record.data, record.op);
  } catch {
    feedHole = true;
    return false;
  }
  if (msg.seq && !feedHole) await setCursor(String(msg.seq));
  return true;
}
```

- [x] **Step 7: `sync-client.ts` — `syncOnce` menghitung & mem-push delete**

Ganti `SyncStats` (baris 70):

```ts
export type SyncStats = { pulled: number; pushed: number; conflicts: number; deleted: number; dropped: number };
```

Di `syncOnce`, ganti inisialisasi (baris 75) menjadi:

```ts
  let pulled = 0, pushed = 0, conflicts = 0, deleted = 0, dropped = 0;
```

Ganti loop pull (baris 96-110) menjadi:

```ts
  const deferred: typeof records = [];
  for (const rec of records) {
    if (!isEntity(rec.entity)) continue;
    // SPEC-799 · jenis peristiwa dari hub yang lebih baru — dilewati, bukan ditunda & bukan melempar.
    if (!rec.op) { dropped++; continue; }
    // SPEC-270 · anti-clobber HANYA untuk upsert. Delete menang tanpa syarat, jadi edit lokal
    // pending justru bukan alasan menundanya — di situlah keputusannya harus berlaku.
    if (rec.op === "upsert" && pending.has(`${rec.entity}:${rec.recordId}`)) {
      const local = await snapshot(rec.entity as Entity, rec.recordId);
      if (local && JSON.stringify(local.data) !== JSON.stringify(rec.data)) {
        await markConflict(rec.entity, rec.recordId,
          { version: local.version, data: local.data }, { version: rec.version, data: rec.data });
      }
      continue;
    }
    try {
      const r = await applyRemote(rec.entity, rec.recordId, rec.version, rec.data, rec.op);
      if (r === "dropped") dropped++;
      else if (rec.op === "delete") deleted++;
      else pulled++;
    } catch { deferred.push(rec); }
  }
```

Loop pass-ulang (baris 113-129) ikut memakai hasilnya:

```ts
  let rest = deferred;
  while (rest.length) {
    const still: typeof rest = [];
    for (const rec of rest) {
      try {
        const r = await applyRemote(rec.entity, rec.recordId, rec.version, rec.data, rec.op ?? "upsert");
        if (r === "dropped") dropped++; else if (rec.op === "delete") deleted++; else pulled++;
      } catch { still.push(rec); }
    }
    if (still.length === rest.length) {
      // Yatim yang induknya TIDAK bertombstone — `applyRemote` sudah membuang yang bertombstone
      // secara sengaja. Sisa ini benar-benar tak bisa dijelaskan; dilewati dengan jejak, bukan
      // didiamkan: menahan kursor di sini = livelock (ADR-0082).
      for (const rec of still) {
        console.warn(`sync: record ${rec.entity}:${rec.recordId} tak bisa diterapkan — dilewati`);
        dropped++;
      }
      break;
    }
    rest = still;
  }
```

Ganti awal loop push (baris 149-155) menjadi:

```ts
    if (!isEntity(item.entity)) { await clearOutbox(item.entity, item.recordId); continue; }
    const snap = await snapshot(item.entity, item.recordId);
    // SPEC-799 · ADR-0119 · baris tak ada TAPI tombstone ada = penghapusan lokal menunggu jendela
    // online. Dulu cabang ini sekadar `clearOutbox` ("record hilang lokal") — di situlah setiap
    // penghapusan client mati tanpa jejak.
    const tomb = snap ? null : await findTombstone(item.entity, item.recordId);
    if (!snap && !tomb) { await clearOutbox(item.entity, item.recordId); continue; }
    if (tomb) {
      // `baseVersion` = versi SEBELUM dihapus & `data` = snapshot terakhir: hub versi LAMA membuang
      // `op` sebagai field tak dikenal dan memperlakukannya sebagai update biasa — record sekadar
      // hidup di sana (status quo), bukan 500 di tiap siklus push karena create tanpa kolom required.
      const res = await transport("POST", "/api/sync/push", {
        records: [{ entity: item.entity, id: item.recordId, baseVersion: Math.max(tomb.version - 1, 0), op: "delete", data: tomb.data }],
      });
      if (res.body?.results?.[0]?.ok) { await clearOutbox(item.entity, item.recordId); pushed++; }
      continue;
    }
```

Dan pada cabang konflik push (baris 163-173), sisipkan **sebelum** perbandingan data:

```ts
    } else if (r?.conflict) {
      // SPEC-799 · ADR-0119 · hub sudah menghapusnya. Delete menang: adopsi tombstone-nya, buang
      // edit lokal, berhenti mendorong. Tanpa lapis ini record bertombstone terus di-push selamanya.
      if (r.deleted) {
        await applyRemote(item.entity, item.recordId, Number(r.deletedVersion ?? snap.version + 1), snap.data, "delete");
        await clearOutbox(item.entity, item.recordId);
        deleted++;
        continue;
      }
      const server = r.server as { version: number; data: Record<string, unknown> } | null;
      ...
```

`return { pulled, pushed, conflicts, deleted, dropped };` di akhir `syncOnce`, dan `syncNow` menjumlahkan kelima field:

```ts
  const total: SyncStats = { pulled: 0, pushed: 0, conflicts: 0, deleted: 0, dropped: 0 };
  ...
    total.pulled += s.pulled; total.pushed += s.pushed; total.conflicts += s.conflicts;
    total.deleted += s.deleted; total.dropped += s.dropped;
```

- [x] **Step 8: `routes/sync.ts` — `op` di push**

Ganti `zPush` (baris 17-22):

```ts
const zPush = z.object({
  records: z.array(z.object({
    entity: z.string(), id: z.string(), baseVersion: z.number().int().nonnegative(),
    data: z.record(z.unknown()),
    // SPEC-799 · ADR-0119 · absen = "upsert" (client versi lama). Hub versi lama membuang field ini
    // dan sekadar memperlakukan push delete sebagai update — status quo, bukan galat.
    op: z.enum(["upsert", "delete"]).optional(),
  })),
});
```

Dan pemanggilannya (baris 54):

```ts
      const r = await applyPush(rec.entity, rec.id, rec.baseVersion, data, req.device!.id, rec.op ?? "upsert");
```

- [x] **Step 9: Jalankan test — pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/sync-tombstone.client.test.ts server/test/sync-tombstone.compat.test.ts server/test/sync-parents-dmmf.test.ts
```
Expected: PASS semua.

- [x] **Step 10: Regresi sync yang sudah ada + typecheck**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/sync-client.test.ts server/test/sync-ticket-attachment.test.ts server/test/sync-notify.test.ts \
  server/test/custom-agent-sync.test.ts server/test/github-sync.test.ts server/test/vps-sync.test.ts
pnpm --filter ./server typecheck
```
Expected: PASS. Test lama yang menyebut `SyncStats` lengkap (mis. `toEqual({pulled,pushed,conflicts})`) perlu ditambahi `deleted: 0, dropped: 0` — kontraknya memang bertambah.

- [x] **Step 11: Commit**

```bash
git add server/src/services/sync-client.ts server/src/services/notifications.ts server/src/routes/sync.ts \
        server/test/sync-tombstone.client.test.ts server/test/sync-tombstone.compat.test.ts server/test/sync-parents-dmmf.test.ts
git commit -m "feat(spec-799): client menerapkan & mendorong tombstone

Upsert basi atas id bertombstone dibuang (replay konvergen), anak bagi induk
bertombstone dibuang sengaja lewat peta PARENTS ber-gerbang DMMF, dan op tak
dikenal dilewati alih-alih menahan kursor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Enam route DELETE memakai `deleteSynced`

**Files:**
- Modify: `server/src/routes/projects.ts:97-107`, `specs.ts:303-322`, `vps.ts:65-70`, `tickets.ts:130-137`, `custom-agents.ts:190-209`, `session-results.ts:29-40`
- Test: `server/test/sync-delete.routes.test.ts`

**Interfaces:**
- Consumes: `deleteSynced` (Task 3)
- Produces: tak ada API baru — kontrak HTTP keenam route **tidak berubah**

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/sync-delete.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";
import { findTombstone } from "../src/services/tombstone";
import { pull } from "../src/services/sync";
import { pruneOldTickets } from "../src/services/ticket";

// Pola test route repo ini: auth dimatikan di level app, fixture lewat ./factory.
const app = buildApp({ requireAuth: false });
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await resetDb(); });

const feedHasDelete = (entity: string, id: string) =>
  pull("0").then((f) => f.records.some((r) => r.entity === entity && r.recordId === id && r.op === "delete"));

describe("route DELETE menerbitkan tombstone (SPEC-799 · ADR-0119)", () => {
  it("DELETE /projects/:id", async () => {
    await makeProject({ id: "p1" });
    const res = await app.inject({ method: "DELETE", url: "/api/projects/p1" });
    expect(res.statusCode).toBe(204);
    expect(await findTombstone("project", "p1")).not.toBeNull();
    expect(await feedHasDelete("project", "p1")).toBe(true);
  });

  it("DELETE /specs/:id", async () => {
    await makeProject({ id: "p1" });
    await makeSpec({ id: "SPEC-1", projectId: "p1" });
    await app.inject({ method: "DELETE", url: "/api/specs/SPEC-1" });
    expect(await findTombstone("spec", "SPEC-1")).not.toBeNull();
    expect(await feedHasDelete("spec", "SPEC-1")).toBe(true);
  });

  it("DELETE /vps/:id", async () => {
    await prisma.vps.create({ data: { id: "v1", name: "v", host: "h", user: "root" } });
    await app.inject({ method: "DELETE", url: "/api/vps/v1" });
    expect(await findTombstone("vps", "v1")).not.toBeNull();
    expect(await feedHasDelete("vps", "v1")).toBe(true);
  });

  it("DELETE /vps/:id yang tak ada tetap 404", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/vps/tak-ada" });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /tickets/:id", async () => {
    await makeProject({ id: "p1" });
    await prisma.ticket.create({ data: { id: "t1", projectId: "p1", number: 1, category: "bug",
      title: "t", detail: "d", reporterEmail: "a@b.co", status: "new", accessKeyHash: "h1" } });
    await app.inject({ method: "DELETE", url: "/api/tickets/t1" });
    expect(await findTombstone("ticket", "t1")).not.toBeNull();
    expect(await feedHasDelete("ticket", "t1")).toBe(true);
  });

  it("DELETE /custom-agents/:id", async () => {
    await prisma.customAgent.create({ data: { id: "global:reviewer", name: "reviewer",
      description: "d", instructions: "i" } });
    await app.inject({ method: "DELETE", url: "/api/custom-agents/global%3Areviewer" });
    expect(await findTombstone("customAgent", "global:reviewer")).not.toBeNull();
  });

  it("DELETE /session-results (purge) menerbitkan satu tombstone per baris", async () => {
    await prisma.sessionResult.create({ data: { id: "sr1", projectId: "p1", status: "ok" } });
    await prisma.sessionResult.create({ data: { id: "sr2", projectId: "p1", status: "ok" } });
    const res = await app.inject({ method: "DELETE", url: "/api/session-results?projectId=p1" });
    expect(res.json()).toMatchObject({ purged: 2 });
    expect(await findTombstone("sessionResult", "sr1")).not.toBeNull();
    expect(await findTombstone("sessionResult", "sr2")).not.toBeNull();
  });

  it("prune retensi TIDAK menerbitkan tombstone (batas yang sudah ada, dinyatakan)", async () => {
    await makeProject({ id: "p1" });
    const tua = new Date(Date.now() - 400 * 86_400_000);
    await prisma.ticket.create({ data: { id: "t-tua", projectId: "p1", number: 9, category: "bug",
      title: "t", detail: "d", reporterEmail: "a@b.co", status: "rejected", accessKeyHash: "h9",
      createdAt: tua } });
    await pruneOldTickets();
    expect(await prisma.ticket.findUnique({ where: { id: "t-tua" } })).toBeNull();
    expect(await findTombstone("ticket", "t-tua")).toBeNull();
  });
});
```

Verifikasi dua asumsi kecil sebelum menjalankan: `resetDb()` di `server/test/factory.ts:149` harus ikut mengosongkan `syncTombstone`/`syncLog` — bila belum, tambahkan keduanya di sana (satu tempat, dipakai seluruh test route). Dan `pruneOldTickets()` di `server/src/services/ticket.ts:53` memang tanpa argumen wajib.

- [x] **Step 2: Jalankan test — pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/sync-delete.routes.test.ts
```
Expected: FAIL — tombstone `null` di keenam kasus pertama.

- [x] **Step 3: `projects.ts`**

Tambahkan impor `import { deleteSynced } from "../services/sync-delete";` lalu ganti baris 105:

```ts
    // ponytail: worktree di .worktrees/ tidak ikut dibersihkan; tambahkan kalau disknya penuh.
    // SPEC-799 · ADR-0119 · spec/ticket/customAgent/githubIssue ikut lewat onDelete: Cascade di SINI
    // maupun di setiap penerima — karena itu tombstone hanya untuk INDUK, bukan per anak.
    await deleteSynced("project", id);
    return reply.code(204).send();
```

- [x] **Step 4: `specs.ts`**

Ganti baris 309 (`await prisma.spec.delete({ where: { id } }).catch(() => { });`):

```ts
    await deleteSynced("spec", id).catch(() => { });
```

Tambahkan impor `deleteSynced`. Pembersihan `dependsOn` di bawahnya **tetap seperti sekarang** — ia menyunting spec LAIN dan sudah memanggil `notifySynced` sendiri.

- [x] **Step 5: `vps.ts`**

Ganti isi handler (baris 65-70):

```ts
  app.delete("/vps/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deleteSynced("vps", id))) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });
```

Tambahkan impor `deleteSynced`. `deleteSynced` mengembalikan `false` untuk baris yang tak ada, jadi `try/catch` lama tak lagi dibutuhkan.

- [x] **Step 6: `tickets.ts`**

Ganti baris 135 (`await prisma.ticket.delete({ where: { id } });`):

```ts
    await deleteSynced("ticket", id); // lampiran ikut lewat onDelete: Cascade, di sini & di penerima
```

Tambahkan impor `deleteSynced`. Loop `deleteUpload` di atasnya tetap.

- [x] **Step 7: `custom-agents.ts`**

Ganti baris 195 (`await prisma.customAgent.delete({ where: { id } });`):

```ts
    await deleteSynced("customAgent", id);
```

Tambahkan impor `deleteSynced`. Pencabutan `mentions` di bawahnya tetap.

- [x] **Step 8: `session-results.ts`**

Ganti blok purge (baris 38-39):

```ts
    // SPEC-799 · ADR-0119 · id dikumpulkan LEBIH DULU: `deleteMany` tak mengembalikan barisnya, dan
    // tombstone butuh version + snapshot tiap baris. Purge tetap satu operasi bagi pemanggilnya.
    const rows = await prisma.sessionResult.findMany({ where, select: { id: true } });
    let purged = 0;
    for (const r of rows) if (await deleteSynced("sessionResult", r.id)) purged++;
    return { purged };
```

Tambahkan impor `import { deleteSynced } from "../services/sync-delete";`.

- [x] **Step 9: Jalankan test — pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/sync-delete.routes.test.ts server/test/projects.route.test.ts server/test/specs.route.test.ts
pnpm --filter ./server typecheck
```
Expected: PASS. Bila `projects.route.test.ts`/`specs.route.test.ts` tak ada dengan nama itu, jalankan yang benar-benar ada: `ls server/test | grep -E "project|spec"`.

- [x] **Step 10: Commit**

```bash
git add server/src/routes/projects.ts server/src/routes/specs.ts server/src/routes/vps.ts \
        server/src/routes/tickets.ts server/src/routes/custom-agents.ts server/src/routes/session-results.ts \
        server/test/sync-delete.routes.test.ts
git commit -m "feat(spec-799): enam route DELETE menerbitkan tombstone

Retensi otomatis sengaja tak ikut: ia memang sudah di luar permukaan
notifySynced, dan pemangkasan adalah kebijakan penyimpanan per-instance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Umpan balik UI untuk penghapusan yang tertunda

**Files:**
- Modify: `server/src/routes/sync.ts` (endpoint baru), `server/src/app.ts:134`
- Modify: `shared/src/api.ts:186-188`
- Modify: `src/src/api/client.ts:183-189`, `src/src/screens/SyncButton.tsx`
- Test: `server/test/sync-pending.route.test.ts`, `src/src/test/sync-pending-badge.test.tsx`

**Interfaces:**
- Consumes: `listPendingDeletes` (Task 3), `SyncStats` ber-`deleted`/`dropped` (Task 4)
- Produces:
  - `GET /api/sync/pending` → `{ deletes: { entity: string; recordId: string; deletedAt: string }[]; total: number }`
  - `paths.syncPending` di `@hanoman/shared`
  - `api.getSyncPending()` di klien web

- [x] **Step 1: Tulis test route yang gagal**

Buat `server/test/sync-pending.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { deleteSynced } from "../src/services/sync-delete";
import { resetDb, makeProject } from "./factory";
import { clearConfig } from "../src/config";

const app = buildApp({ requireAuth: false });
const guarded = buildApp();               // auth hidup — untuk membuktikan gerbangnya
beforeEach(async () => { await resetDb(); clearConfig(); });
afterAll(async () => { await resetDb(); clearConfig(); });

describe("GET /api/sync/pending (SPEC-799 · ADR-0119)", () => {
  it("kosong saat tak ada apa pun tertunda", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sync/pending" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deletes: [], total: 0 });
  });

  it("melaporkan penghapusan yang menunggu push", async () => {
    await prisma.runtimeConfig.create({ data: { key: "SYNC_SERVER_URL", value: "http://hub.test" } });
    clearConfig();
    await makeProject({ id: "p1" });
    await deleteSynced("project", "p1");

    const res = await app.inject({ method: "GET", url: "/api/sync/pending" });
    expect(res.json().total).toBe(1);
    expect(res.json().deletes[0]).toMatchObject({ entity: "project", recordId: "p1" });
  });

  it("cookie-only: tanpa cookie ditolak, TIDAK jatuh ke bypass device-token /api/sync", async () => {
    const res = await guarded.inject({ method: "GET", url: "/api/sync/pending" });
    expect(res.statusCode).toBe(401);
  });
});
```

- [x] **Step 2: Jalankan — pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/sync-pending.route.test.ts
```
Expected: FAIL — 404 pada route.

- [x] **Step 3: Endpoint + pengecualian gate**

Di `server/src/routes/sync.ts`, tambahkan impor `import { listPendingDeletes } from "../services/sync-delete";` lalu sesudah handler `/sync/conflicts`:

```ts
  // SPEC-799 · ADR-0119 · penghapusan yang belum sempat menyeberang (client offline). Cookie-authed
  // seperti /sync/now & /sync/conflicts — ini permukaan UI, bukan kanal mesin-ke-mesin.
  app.get("/sync/pending", async () => {
    const deletes = await listPendingDeletes();
    return { deletes, total: deletes.length };
  });
```

Di `server/src/app.ts:134`, ganti barisnya:

```ts
        // SPEC-799 · KECUALI GET /api/sync/pending — umpan balik hapus tertunda = aksi UI, cookie-only.
        if (path.startsWith("/api/sync") && path !== "/api/sync/now" && path !== "/api/sync/pending"
          && !path.startsWith("/api/sync/conflicts")) return;
```

- [x] **Step 4: Verifikasi gerbang agent-token**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/sync-pending.route.test.ts server/test/mcp-capability.test.ts server/test/agent-doc-contract.test.ts
```
Expected: PASS. `/sync/*` sudah cookie-only bagi agent token; endpoint baru mewarisi aturan itu karena berada di bawah prefix yang sama. Bila salah satu test kontrak merah, ikuti pesannya — daftar cookie-only memang kontrak yang dijaga.

- [x] **Step 5: Path bersama + klien API**

Di `shared/src/api.ts`, sesudah baris `syncConflicts`:

```ts
  syncPending: `${API}/sync/pending`,
```

Di `src/src/api/client.ts`, sesudah `syncNow`:

```ts
  // SPEC-799 · ADR-0119 · penghapusan yang masih menunggu jendela online (instance client offline).
  getSyncPending: () => j<{ deletes: { entity: string; recordId: string; deletedAt: string }[]; total: number }>(
    paths.syncPending),
```

dan lengkapi tipe balikan `syncNow` dengan dua hitungan baru:

```ts
  syncNow: (opts?: { full?: boolean }) =>
    j<{ ok: boolean; reason?: string; full?: boolean; pulled?: number; pushed?: number;
        conflicts?: number; deleted?: number; dropped?: number }>(
      paths.syncNow, { method: "POST", ...body({ full: opts?.full === true }) }),
```

- [x] **Step 6: Tulis test web yang gagal**

Buat `src/src/test/sync-pending-badge.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SyncButton, __resetSyncActiveCache } from "../screens/SyncButton";
import { api } from "../api/client";

beforeEach(() => { __resetSyncActiveCache(); vi.restoreAllMocks(); });

describe("SyncButton — hapus tertunda (SPEC-799 · ADR-0119)", () => {
  it("merender lencana saat ada penghapusan menunggu", async () => {
    vi.spyOn(api, "getConfig").mockResolvedValue({ sync: { running: true } } as never);
    vi.spyOn(api, "getSyncPending").mockResolvedValue({
      deletes: [{ entity: "project", recordId: "p1", deletedAt: "2026-08-15T00:00:00.000Z" }], total: 1,
    });
    render(<SyncButton onDone={() => {}} onToast={() => {}} />);
    expect(await screen.findByText(/1 hapus menunggu/i)).toBeInTheDocument();
  });

  it("tanpa penghapusan tertunda, lencana tak dirender", async () => {
    vi.spyOn(api, "getConfig").mockResolvedValue({ sync: { running: true } } as never);
    vi.spyOn(api, "getSyncPending").mockResolvedValue({ deletes: [], total: 0 });
    render(<SyncButton onDone={() => {}} onToast={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Sync$/i })).toBeInTheDocument());
    expect(screen.queryByText(/hapus menunggu/i)).toBeNull();
  });
});
```

- [x] **Step 7: Jalankan — pastikan GAGAL**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/src/test/sync-pending-badge.test.tsx
```
Expected: FAIL — teks lencana belum ada.

- [x] **Step 8: Render lencana di `SyncButton.tsx`**

Sesudah `const [showModal, setShowModal] = React.useState(false);` tambahkan:

```tsx
  // SPEC-799 · ADR-0119 · penghapusan yang menunggu jendela online. Tanpa lencana ini operator
  // membaca "hapusnya gagal" lalu mengulanginya — penghapusan yang tak terlihat efeknya adalah
  // penghapusan yang dikira gagal.
  const [pendingDeletes, setPendingDeletes] = React.useState(0);
  const refreshPending = React.useCallback(() => {
    api.getSyncPending().then((r) => setPendingDeletes(r.total)).catch(() => setPendingDeletes(0));
  }, []);
  React.useEffect(() => { if (active) refreshPending(); }, [active, refreshPending]);
```

Di dalam `run()`, sesudah `onDone();` tambahkan `refreshPending();`, dan lengkapi toast-nya:

```tsx
      else onToast(
        `Sinkron: ↓${r.pulled ?? 0} ↑${r.pushed ?? 0}`
        + (r.deleted ? ` ⨯${r.deleted}` : "")
        + (r.conflicts ? ` · ${r.conflicts} konflik` : ""),
        r.conflicts ? "warn" : "ok", r.conflicts ? "triangle-alert" : "check");
```

Dan di JSX, sesudah tombol "Tarik ulang":

```tsx
      {pendingDeletes > 0 && (
        <span className="hn-muted" style={{ fontSize: 12 }}
          title="Penghapusan sudah tercatat di mesin ini dan akan menyeberang ke hub pada sync berikutnya">
          {pendingDeletes} hapus menunggu
        </span>
      )}
```

- [x] **Step 9: Jalankan test — pastikan LULUS**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/src/test/sync-pending-badge.test.tsx
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/sync-pending.route.test.ts
```
Expected: PASS keduanya.

- [x] **Step 10: Commit**

```bash
git add server/src/routes/sync.ts server/src/app.ts shared/src/api.ts src/src/api/client.ts \
        src/src/screens/SyncButton.tsx server/test/sync-pending.route.test.ts src/src/test/sync-pending-badge.test.tsx
git commit -m "feat(spec-799): umpan balik penghapusan tertunda saat offline

GET /api/sync/pending (cookie-only) + lencana 'N hapus menunggu' + hitungan
hapus di toast sync.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Docs — ADR-0119 & index yang tersentuh

**Files:**
- Create: `internal/docs/adr/0119-tombstone-sync-penghapusan-menyeberang.md`
- Modify: `internal/docs/README.md` (daftar adr), `internal/docs/adr/README.md` (narasi),
  `internal/docs/adr/0068-lampiran-tiket-masuk-record-sync.md`, `internal/docs/adr/0082-kontrak-apply-changefeed-record-tertunda.md`,
  `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`,
  `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: seluruh keputusan Task 1–6
- Produces: dokumen SoT; tak ada kode

- [x] **Step 1: Pastikan nomor 0119 masih bebas**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman && git worktree list
for b in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do git ls-tree -r --name-only "$b" -- internal/docs/adr; done | grep -oE '01[0-9][0-9]-' | sort -u | tail -5
```
Expected: tertinggi `0118-`. Bila sesi paralel sudah mengklaim `0119`, naik ke nomor bebas berikutnya dan ganti seluruh rujukan `ADR-0119` di kode + docs.

- [x] **Step 2: Tulis `internal/docs/adr/0119-tombstone-sync-penghapusan-menyeberang.md`**

Ikuti struktur ADR repo (`# ADR-0119 — …`, `**Status:** accepted · **Tanggal:** 2026-08-15 · **Spec:** SPEC-799`, `**Terkait:**`, `## Konteks`, `## Keputusan`, `## Konsekuensi`). Isi yang wajib ada — semuanya sudah diputuskan, tinggal dituliskan:

1. **Konteks** — dua jalur kebangkitan (client-hapus vs hub-hapus) berikut rujukan baris:
   `routes/projects.ts:105` (delete tanpa notifikasi apa pun), `sync.ts:201-213` (insert id-absen selalu diterima),
   `sync-client.ts:114-129` (yatim ditelan `console.warn`), `sync-client.ts:203-220` (tarik ulang memutar seluruh feed).
2. **Keputusan 1 — hard-delete + `SyncTombstone`, bukan soft-delete `deletedAt`.** Sebutkan biaya bentuk yang ditolak: setiap query baca 8 entitas, cascade tingkat-DB gugur, `@@unique([projectId, number])` menolak pembuatan ulang, tap webhook ADR-0100 membaca hapus sebagai update.
3. **Keputusan 2 — tombstone ADALAH versi record, berkeadaan dihapus.** `applyPush` membaca `existing.version` dari baris **atau** tombstone → penolakan kebangkitan jatuh dari aturan yang sudah ada.
4. **Keputusan 3 — `op` di TOP-LEVEL `SyncLog`, `data` tetap snapshot yang sah.** Alasannya kompatibilitas: `validateSyncData` menegakkan allowlist atas `data`, dan lemparan di client lama menyalakan `feedHole` yang menahan kursor **selamanya**. Sertakan matriks empat arah dari spec.
5. **Keputusan 4 — delete menang TANPA SYARAT**, sekaligus jawaban wajib brief atas "hapus-vs-edit". Nyatakan harganya (edit bersamaan hilang) dan mitigasinya (`Notification` `sync-delete:<entity>:<id>:<version>`; snapshot tetap ada di `SyncLog` **dan** di `SyncTombstone.data`).
6. **Keputusan 5 — anak yatim dibuang SENGAJA** lewat `PARENTS` + gerbang DMMF; `sessionResult` & `ticketAttachment.projectId` sengaja absen karena bukan FK.
7. **Keputusan 6 — retensi otomatis TIDAK menerbitkan tombstone**, dengan alasan "batas yang sudah ada, bukan pengecualian baru".
8. **Jalan pulang** — hapus ulang sekali di sisi mana pun sesudah upgrade; tanpa migrasi data.
9. **Enam gotcha wajib**, ditulis sebagai daftar:
   (1) `op` **tak boleh** masuk `data` — allowlist client lama melemparnya → `feedHole` → mandek total;
   (2) baris feed `op:"delete"` **wajib** membawa snapshot sah — objek kosong membuat hub lama 500 (create tanpa kolom required) dan client lama menerapkan baris kosong;
   (3) `SyncTombstone` **wajib** masuk `PG_ORDER` (`cli/test/migrate-pg.test.ts` satu-satunya gerbangnya, cermin ADR-0105);
   (4) `writeTombstone` **wajib monoton** — keadaan lebih tua yang tiba belakangan (replay full-pull) tak boleh menurunkan versi;
   (5) konsumsi tombstone saat pembuatan ulang duduk di **`notifySynced`**, bukan di tiap jalur `create` — kelas bug SPEC-431/448/475/481 — dan **wajib mengangkat `version` baris ke versi tombstone**, kalau tidak push-nya membawa `baseVersion = 0` dan ditolak selamanya;
   (6) `op` tak dikenal **dilewati**, tak pernah melempar — melempar berarti hub yang lebih baru bisa mematikan client lama lewat satu jenis peristiwa.

- [x] **Step 3: Tandai ADR yang tersentuh**

Di `internal/docs/adr/0068-lampiran-tiket-masuk-record-sync.md`, tepat di bawah baris `**Status:** accepted …`, tambahkan:

```markdown
> **Sebagian dicabut oleh [ADR-0119](0119-tombstone-sync-penghapusan-menyeberang.md)** (SPEC-799):
> konsekuensi "propagasi delete/tombstone di luar scope" tidak lagi berlaku — penghapusan kini
> menyeberang dua arah. Sisa keputusan ADR ini (metadata di feed, byte lazy-fetch) utuh.
```

Di `internal/docs/adr/0082-kontrak-apply-changefeed-record-tertunda.md`, tepat di bawah `**Status:** accepted …`:

```markdown
> **Sebagian dicabut oleh [ADR-0119](0119-tombstone-sync-penghapusan-menyeberang.md)** (SPEC-799):
> batasan "feed append-only tanpa tombstone (delete tak merambat)" tidak lagi berlaku, dan "yatim
> sejati dilewati diam-diam" kini punya cabang yang dinyatakan — anak dari induk bertombstone dibuang
> SENGAJA dan terhitung. Keputusan 1–5 (record tertunda, kursor tak melompat, tarik ulang penuh)
> justru **ditegakkan**: tombstone mengalir lewat kontrak apply yang sama.
```

- [x] **Step 4: Tautkan di kedua index**

Di `internal/docs/README.md`, bagian `## adr`, sisipkan **di atas** baris 0118:

```markdown
- [0119 — Tombstone sync: hard-delete + `SyncTombstone`, `SyncLog.op`, delete menang tanpa syarat](adr/0119-tombstone-sync-penghapusan-menyeberang.md)
```

Di `internal/docs/adr/README.md`, tambahkan entri narasi ADR-0119 mengikuti bentuk tetangganya: apa yang diperluas/dicabut, keputusan intinya, dan keenam gotcha. Jangan salin ADR-nya utuh — sub-index ini dibaca saat butuh riwayat.

- [x] **Step 5: Perbarui doc arsitektur**

`internal/docs/architecture/data-model.md`: tambahkan `SyncTombstone` (entity, recordId, version, data, deletedAt, deviceId; unique `(entity, recordId)`; LOCAL sebagai tabel, tapi maknanya menyeberang) dan kolom `SyncLog.op`.

`internal/docs/architecture/api-contract.md`: `POST /api/sync/push` menerima `op?: "upsert"|"delete"` per record dan bisa membalas `{ ok:false, conflict:true, deleted:true, deletedVersion, server:null }`; `GET /api/sync/pull` memancarkan `op`; endpoint baru `GET /api/sync/pending` (cookie-only).

`internal/skills/hanoman/SKILL.md`: satu butir baru di "Aturan Arsitektur", ditulis dengan kepadatan yang sama seperti butir tetangganya (SPEC + ADR + keputusan inti + gotcha yang mengikat).

- [x] **Step 6: Verifikasi integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli exec tsx src/index.ts docs index --check
```
Expected: laporan bersih. Bila perintahnya tak tersedia di worktree ini, verifikasi manual bahwa berkas ADR baru tertaut di `internal/docs/README.md` **dan** `internal/docs/adr/README.md`.

- [x] **Step 7: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(spec-799): ADR-0119 tombstone sync + index & doc arsitektur

ADR-0068 & ADR-0082 ditandai sebagian dicabut (batasan 'feed append-only tanpa
tombstone'); kontrak apply ADR-0082 justru ditegakkan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Verifikasi end-to-end dua instance + penutup

**Files:** tak ada perubahan kode yang direncanakan. Bila verifikasi menemukan cacat, perbaiki di task ini berikut testnya.

**Interfaces:**
- Consumes: seluruh Task 1–7
- Produces: bukti kriteria selesai brief

- [x] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  --changed "$HANOMAN_BASE_SHA"
```
Expected: hijau. **Pastikan test-nya benar-benar berjalan** — `--changed` menyalakan `passWithNoTests`, jadi "no test files" bukan bukti. Hitung jumlah berkas & test yang dilaporkan.

- [x] **Step 2: Typecheck paket tersentuh**

```bash
pnpm --filter ./server typecheck
pnpm --filter ./shared typecheck
env -u NODE_ENV pnpm --filter ./src typecheck
pnpm --filter ./cli typecheck
```
Expected: bersih. (Empat paket, bukan `-r`: `shared/api.ts`, `cli/migrate-pg.ts`, dan UI memang ikut berubah.)

- [x] **Step 3: Siapkan dua instance nyata**

```bash
HUB_HOME=$(mktemp -d); CLI_HOME=$(mktemp -d)
echo "HUB_HOME=$HUB_HOME CLI_HOME=$CLI_HOME"
```

Boot HUB di port 7801 dan CLIENT di port 7802, masing-masing dengan `HANOMAN_HOME` sendiri (jangan pernah memakai `~/.hanoman` — itu DB produksi). Jalankan tiap server di background, catat PID-nya, dan matikan **per-PID** di akhir (`kill <pid>`) — **jangan** `pkill -f`, itu membunuh agen sesi tetangga di mesin ini (SPEC-402).

Pada CLIENT, setel `SYNC_SERVER_URL=http://127.0.0.1:7801` dan `SYNC_DEVICE_TOKEN=<token dari hub>`
(terbitkan lewat `POST /api/device-tokens` di hub dengan cookie admin).

- [x] **Step 4: Bukti arah client → hub**

1. Buat project `e2e-1` di **hub**, tunggu client menariknya (`GET /api/projects` di client memuatnya).
2. `DELETE /api/projects/e2e-1` di **client**.
3. Picu `POST /api/sync/now` di client.
4. `GET /api/projects` di **hub** → `e2e-1` **hilang**.
5. Restart hub (kill per-PID lalu boot lagi; `backfillFeed()` jalan saat boot).
6. `POST /api/sync/now {"full":true}` di client.
7. `GET /api/projects` di **kedua** instance → `e2e-1` **tetap hilang**.

- [x] **Step 5: Bukti arah hub → client**

1. Buat project `e2e-2` di **hub**, tunggu client menariknya.
2. `PATCH /api/projects/e2e-2` di **client** (edit lokal → entri outbox).
3. `DELETE /api/projects/e2e-2` di **hub**.
4. `POST /api/sync/now` di client.
5. `GET /api/projects` di **client** → `e2e-2` **hilang**; `GET /api/notifications` memuat satu baris `sync-delete:project:e2e-2:*`.
6. `POST /api/sync/now` sekali lagi → `e2e-2` **tidak** muncul lagi di hub (push client tak membangkitkannya).

- [x] **Step 6: Bersihkan & catat bukti**

Matikan kedua server **per-PID**, hapus kedua `HANOMAN_HOME` sementara. Tulis ringkasan hasil langkah 4–5 (perintah + respons kunci) ke dalam pesan commit atau ke ADR-0119 sebagai catatan verifikasi.

- [x] **Step 7: Centang seluruh kotak plan & commit penutup**

Pastikan tak ada lagi `- [x]` yang tersisa di berkas ini, lalu:

```bash
git add -u docs/superpowers/plans/2026-08-15-spec-799-sync-tombstone.md
git commit -m "chore(spec-799): tuntaskan plan tombstone sync + verifikasi dua instance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin HEAD:refs/heads/hanoman/spec-799
```
