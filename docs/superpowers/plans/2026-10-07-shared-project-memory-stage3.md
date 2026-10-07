# Memori Project Bersama — Tahap 3 (Sync Lintas Mesin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ProjectMemory` dan `MemoryEvent` menyeberang lewat record-sync hub/client yang sudah ada — tanpa pernah membuat client versi lama macet, tanpa modal konflik untuk status memori, dan dengan hapus permanen yang menang tanpa syarat.

**Architecture:** Kedua model masuk registri sync (`SYNCED`, `FIELDS`, `PARENTS`, `BOOTSTRAP_ORDER`) sebagai **entitas opsional** (`OPTIONAL_ENTITIES`). Hub menyaring entitas opsional dari pull/bootstrap/WS bagi client yang tidak menyebutnya di query `entities=`, dengan kursor tetap maju melewati baris yang disaring. Client baru menyebutnya, mencatat entitas yang didukung hub dari balasan pull, menunda push entitas opsional sampai hub mendukungnya, dan menjalankan **catch-up bootstrap** sekali per entitas opsional (penanda di `SyncState.entities`). Merge `projectMemory` memakai lattice status di hub (`applyPush`) dan di client (cabang outbox pending); `memoryEvent` immutable → idempoten.

**Spec:** [desain](../specs/2026-10-07-shared-project-memory-design.md) §4. Tahap 1–2: ADR-0178, ADR-0179.

## Keputusan tahap 3 (disetujui operator 2026-10-07)

| # | Keputusan |
|---|---|
| 1 | Negosiasi entitas opsional (query `entities=`) + hub menyaring + catch-up bootstrap sekali |
| 2 | Client melewati entitas tak dikenal (peringatan), tak lagi melempar — untuk rilis mendatang |
| 3 | Hub mengiklankan entitas opsionalnya di balasan pull/bootstrap; client menunda push entitas opsional sampai hub mendukung |
| 4 | Merge lattice `projectMemory` di hub & client tanpa `SyncConflict`; field immutable beda → konflik biasa. `memoryEvent` idempoten |
| 5 | Perbaiki bug tahap 1: store tak lagi menaikkan `version` lokal; panggil `notifySynced` |
| 6 | Migration: `MemoryEvent.version` + `updatedAt`, `SyncState.entities`; ADR-0180 |
| 7 | `DELETE /api/memories/:id` cookie-only via `deleteSynced` (tombstone, event ikut cascade) |
| 8 | `sourceDeviceId` = `LOCAL_DEVICE_ID` saat dibuat |

## Temuan yang membentuk plan (peta sync 2026-10-07)

- `validateIncomingRecord` (`sync-client.ts:40`) **melempar** untuk entitas tak dikenal, tanpa try/catch di `syncOnce:245` → kursor client lama tak pernah maju. Tak ada negosiasi versi/entitas sama sekali.
- `applyPush` (`sync.ts:300`) = optimistic concurrency murni; hub tak pernah membuat `SyncConflict` (hanya client). Tak ada preseden merge kustom.
- Konvensi: tulisan lokal **tak menyentuh** `version`; hub menaikkannya di `publishLocal`, client menyalin versi hub sesudah push. `store.ts` tahap 1 melanggarnya (`version: { increment: 1 }` ×3).
- Semua entitas sync wajib `version` + `updatedAt` (`snapshot`, `applyPush`, `upsertLocal`, `publishLocal`).
- Anak cascade tak ditombstone sendiri; penerima membuang anak yang induknya bertombstone (`parentTombstoned`).
- Test kontrak yang akan merah sampai diperbarui: `sync-exclusions.test.ts` (daftar `SYNCED` persis), `sync-bootstrap.test.ts` (cakupan + urutan), `sync-parents-dmmf.test.ts` (`PARENTS` vs FK skema).

## Global Constraints

- Client versi lama (tanpa `entities=`) **tak pernah** menerima baris entitas opsional, di pull, bootstrap, maupun WS — dan kursornya tetap maju.
- Kursor `pull` = seq baris terakhir yang **dikonsumsi** (dikirim atau sengaja disaring), tak pernah melewati baris yang belum dikirim karena anggaran byte.
- Test server: `env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_PUBLIC_ORIGINS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run <paths> --no-file-parallelism`.
- Migration + ADR-0180. Tanpa mengubah perilaku entitas sync lain.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `server/prisma/schema.prisma` + migration `20261007130000_memory_sync` | `MemoryEvent.version/updatedAt`, `SyncState.entities` |
| `server/src/services/sync.ts` | registri, `OPTIONAL_ENTITIES`, filter pull/bootstrap, merge di `applyPush` |
| `server/src/services/memory/sync-merge.ts` (create) | merge murni record memori |
| `server/src/services/sync-hub.ts`, `server/src/routes/sync.ts` | filter WS per klien, parse `entities`, iklan |
| `server/src/services/sync-client.ts` | toleransi entitas tak dikenal, query `entities`, gating push, merge pending, catch-up |
| `server/src/services/memory/store.ts` | tanpa bump versi, `notifySynced`, `sourceDeviceId` |
| `server/src/routes/memories.ts`, `agent-capabilities.ts` | `DELETE /memories/:id` cookie-only |
| ADR-0180 + docs | |

---

### Task 1: Skema & registri sync

**Files:** schema, migration, `server/src/services/sync.ts`, `server/test/sync-memory.registry.test.ts`, test kontrak (`sync-exclusions`, `sync-bootstrap`, `sync-parents-dmmf` bila perlu).

- [x] **Step 1: Skema** — di `model MemoryEvent` tambahkan sebelum `@@index`:

```prisma
  version   Int           @default(0)   // ADR-0180 · wajib bagi entitas sync
  updatedAt DateTime      @updatedAt
```

di `model SyncState`:

```prisma
  // ADR-0180 · LOCAL-only: entitas sync OPSIONAL yang sudah di-catch-up mesin ini (dipisah koma).
  entities String @default("")
```

Bangkitkan migration `20261007130000_memory_sync` dengan prosedur tahap 1 (deploy ke DB sementara → `migrate diff --from-schema-datasource … --to-schema-datamodel … --script` → periksa: tak ada `DROP` data selain redefine tabel SQLite yang menyalin baris → verifikasi NO-DRIFT → `prisma generate`). Bila Prisma menolak kolom `updatedAt` NOT NULL tanpa default untuk baris lama, sunting SQL redefine agar `INSERT INTO new_MemoryEvent … SELECT …, "createdAt" AS "updatedAt"` — catat di ADR.

- [x] **Step 2: Test registri yang gagal** — `server/test/sync-memory.registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOOTSTRAP_ORDER, OPTIONAL_ENTITIES, PARENTS, SYNCED, isEntity, validateSyncData } from "../src/services/sync";

describe("registri sync memori (ADR-0180)", () => {
  it("projectMemory & memoryEvent tersync dan opsional; MemoryLocalState tidak", () => {
    expect(isEntity("projectMemory")).toBe(true);
    expect(isEntity("memoryEvent")).toBe(true);
    expect(isEntity("memoryLocalState")).toBe(false);
    expect([...OPTIONAL_ENTITIES].sort()).toEqual(["memoryEvent", "projectMemory"]);
    for (const e of OPTIONAL_ENTITIES) expect(SYNCED).toContain(e);
  });
  it("induk mendahului anak di bootstrap", () => {
    const i = (e: string) => BOOTSTRAP_ORDER.indexOf(e as never);
    expect(i("project")).toBeLessThan(i("projectMemory"));
    expect(i("projectMemory")).toBeLessThan(i("memoryEvent"));
    expect(PARENTS.memoryEvent).toEqual([{ field: "memoryId", entity: "projectMemory", onDelete: "cascade" }]);
  });
  it("validasi tipe: anchors/scopePaths JSON, trusted boolean, field asing ditolak", () => {
    const ok = { projectId: "p", kind: "fact", content: "c", scopePaths: [], anchors: [], status: "active",
      supersedesId: null, reviewReason: null, sourceRuntime: "human", sourceSessionId: null, sourceTokenId: null,
      sourceDeviceId: "local", commitSha: null, trusted: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect(() => validateSyncData("projectMemory", ok)).not.toThrow();
    expect(() => validateSyncData("projectMemory", { ...ok, trusted: "ya" })).toThrow();
    expect(() => validateSyncData("projectMemory", { ...ok, verdict: "valid" })).toThrow();
  });
});
```

- [x] **Step 3: Registri** di `sync.ts`:
  - `SYNCED`: tambahkan `"projectMemory", "memoryEvent"` di akhir.
  - Tepat di bawah `type Entity`:

```ts
// ADR-0180 · entitas yang hanya dikirim ke client yang MENYEBUTNYA (`?entities=`). Client versi lama
// melempar pada entitas tak dikenal dan kursornya berhenti selamanya (sync-client `validateIncomingRecord`)
// — jadi entitas baru tak boleh pernah sampai ke sana. Hub menyaring; kursor tetap maju melewatinya.
export const OPTIONAL_ENTITIES = ["projectMemory", "memoryEvent"] as const satisfies readonly Entity[];
export type OptionalEntity = (typeof OPTIONAL_ENTITIES)[number];
export function acceptedOptional(raw: unknown): Set<string> {
  const want = typeof raw === "string" ? raw.split(",").map((s) => s.trim()) : [];
  return new Set(OPTIONAL_ENTITIES.filter((e) => want.includes(e)));
}
export const isOptionalEntity = (e: string): e is OptionalEntity => (OPTIONAL_ENTITIES as readonly string[]).includes(e);
```

  - `DELEGATE`: `projectMemory: prisma.projectMemory as unknown as Delegate, memoryEvent: prisma.memoryEvent as unknown as Delegate,`
  - `FIELDS`:

```ts
  // ADR-0180 · tanpa `version` (dikelola sync) dan tanpa MemoryLocalState (verdict per mesin).
  projectMemory: ["projectId", "kind", "content", "scopePaths", "anchors", "status", "supersedesId", "reviewReason",
    "sourceRuntime", "sourceSessionId", "sourceTokenId", "sourceDeviceId", "commitSha", "trusted", "createdAt", "updatedAt"],
  memoryEvent: ["memoryId", "op", "actorKind", "actorId", "reason", "createdAt", "updatedAt"],
```

  - `DATE_FIELDS`: `projectMemory: ["createdAt", "updatedAt"], memoryEvent: ["createdAt", "updatedAt"],`
  - `PARENTS`: `projectMemory: [{ field: "projectId", entity: "project", onDelete: "cascade" }], memoryEvent: [{ field: "memoryId", entity: "projectMemory", onDelete: "cascade" }],`
  - `BOOLEAN_FIELDS` += `"projectMemory:trusted"`; `JSON_FIELDS` += `"projectMemory:scopePaths", "projectMemory:anchors"`.
  - `BOOTSTRAP_ORDER`: sisipkan `"projectMemory", "memoryEvent"` setelah entitas QA (sesudah `project`).

- [x] **Step 4: Test kontrak** — perbarui `sync-exclusions.test.ts` (daftar persis + judul `ADR-0180: +projectMemory, +memoryEvent`), lalu jalankan `sync-memory.registry`, `sync-exclusions`, `sync-bootstrap`, `sync-parents-dmmf`, `sync-qa.service` → PASS.

- [x] **Step 5: Commit** `feat(memory): ProjectMemory & MemoryEvent masuk registri sync sebagai entitas opsional`

---

### Task 2: Hub menyaring entitas opsional (pull, bootstrap, WS) + iklan

**Files:** `sync.ts` (`pull`, `bootstrapSnapshot`), `sync-hub.ts`, `routes/sync.ts`; test `server/test/sync-memory.filter.test.ts`.

- [x] **Step 1: Test yang gagal**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { bootstrapSnapshot, publishLocal, pull } from "../src/services/sync";
import { __resetSyncHub, attachSync, broadcastSyncLog } from "../src/services/sync-hub";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "sf-p" } });
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "sf-p", name: "p", desc: "", kind: "existing" } });
  await publishLocal("project", "sf-p");
  const m = await prisma.projectMemory.create({ data: { projectId: "sf-p", kind: "fact", content: "c", scopePaths: [],
    anchors: [], status: "active", sourceRuntime: "human" } });
  await publishLocal("projectMemory", m.id);
  await prisma.project.update({ where: { id: "sf-p" }, data: { desc: "d2" } });
  await publishLocal("project", "sf-p");
});
afterAll(clean);

describe("pull menyaring entitas opsional", () => {
  it("client lama (tanpa entities) tak melihat memori, dan kursornya MAJU sampai ujung", async () => {
    const r = await pull("0");
    expect(r.records.map((x) => x.entity)).toEqual(["project", "project"]);
    const tip = await prisma.syncLog.findFirst({ orderBy: { seq: "desc" } });
    expect(r.cursor).toBe(String(tip!.seq));
    expect(r.entities).toEqual(["projectMemory", "memoryEvent"]);   // iklan hub
  });
  it("client baru menerima memori", async () => {
    const r = await pull("0", 500, undefined, { accept: new Set(["projectMemory", "memoryEvent"]) });
    expect(r.records.map((x) => x.entity)).toEqual(["project", "projectMemory", "project"]);
  });
  it("feed yang isinya HANYA baris tersaring tetap memajukan kursor", async () => {
    const before = (await prisma.syncLog.findFirst({ orderBy: { seq: "desc" } }))!.seq;
    const m = await prisma.projectMemory.findFirst();
    await publishLocal("projectMemory", m!.id);
    const r = await pull(String(before));
    expect(r.records).toEqual([]);
    expect(Number(r.cursor)).toBeGreaterThan(before);
  });
});

describe("bootstrap menyaring + only", () => {
  it("tanpa accept → tanpa memori; only → hanya entitas yang diminta", async () => {
    expect((await bootstrapSnapshot(null)).records.map((r) => r.entity)).not.toContain("projectMemory");
    const only = await bootstrapSnapshot(null, undefined, { accept: new Set(["projectMemory"]), only: new Set(["projectMemory"]) });
    expect(only.records.map((r) => r.entity)).toEqual(["projectMemory"]);
  });
});

describe("WS menyaring per klien", () => {
  it("klien tanpa accept tak menerima frame memori", () => {
    __resetSyncHub();
    const oldC: string[] = []; const newC: string[] = [];
    attachSync({ send: (m) => oldC.push(m), close: () => {} });
    attachSync({ send: (m) => newC.push(m), close: () => {}, accept: new Set(["projectMemory"]) });
    broadcastSyncLog({ entity: "projectMemory", recordId: "x", version: 1, data: {}, seq: "9" });
    expect(oldC).toEqual([]);
    expect(newC.length).toBe(1);
    __resetSyncHub();
  });
});
```

- [x] **Step 2: Implementasi**

`pull` — tanda tangan `pull(sinceCursor, limit = 500, maxBytes = PULL_MAX_BYTES, opts: { accept?: Set<string> } = {})`, kembalian ditambah `entities: string[]`. Ganti loop:

```ts
  const accept = opts.accept ?? new Set<string>();
  const records: PulledRecord[] = [];
  let bytes = 0;
  let trimmed = false;
  // ADR-0180 · kursor = baris terakhir yang DIKONSUMSI: dikirim, atau sengaja disaring untuk client
  // yang tak menyebut entitas opsional itu. Baris tersaring bukan "tertinggal" — ia memang tak untuknya.
  let consumed: number | null = null;
  for (const r of rows) {
    if (isOptionalEntity(r.entity) && !accept.has(r.entity)) { consumed = r.seq; continue; }
    const rec: PulledRecord = {
      entity: r.entity, recordId: r.recordId, version: r.version,
      op: r.op === "delete" ? "delete" : "upsert", data: r.data,
    };
    const size = recordBytes(rec);
    if (records.length && bytes + size > maxBytes) { trimmed = true; break; }
    bytes += size;
    records.push(rec);
    consumed = r.seq;
  }
  const cursor = consumed !== null ? String(consumed) : sinceCursor || "0";
  return { cursor, records, hasMore: trimmed || rows.length === limit, entities: [...OPTIONAL_ENTITIES] };
```

(hapus komentar & baris `const cursor = records.length ? …` lama; pertahankan komentar SPEC-382 dengan menyesuaikan kalimatnya.)

`bootstrapSnapshot(after, maxBytes = PULL_MAX_BYTES, opts: { accept?: Set<string>; only?: Set<string> } = {})` — di loop entitas, tepat setelah `const entity = BOOTSTRAP_ORDER[i]!;`:

```ts
    if (isOptionalEntity(entity) && !(opts.accept ?? new Set()).has(entity)) continue;
    if (opts.only && !opts.only.has(entity)) continue;
```

dan tipe `BootstrapPage` + kembalian ditambah `entities: [...OPTIONAL_ENTITIES]` (keduanya `return`).

`sync-hub.ts`:

```ts
export function broadcastSyncLog(row: { entity: string; recordId: string; version: number; data: unknown; seq: string }): void {
  const s = JSON.stringify({ t: "sync", ...row });
  for (const c of clients) {
    // ADR-0180 · klien yang tak menyebut entitas opsional tak boleh menerimanya (client lama melempar).
    if (isOptionalEntity(row.entity) && !c.accept?.has(row.entity)) continue;
    try { c.send(s); } catch { clients.delete(c); }
  }
}
```

dengan tipe klien lokal `type SyncClient = Client & { accept?: Set<string> }` (`attachSync(c: SyncClient)`), import `isOptionalEntity` dari `./sync`.

`routes/sync.ts`: `/sync/pull` → `pull(since, undefined, undefined, { accept: acceptedOptional((req.query as { entities?: string }).entities) })`; `/sync/bootstrap` → `bootstrapSnapshot(after, undefined, { accept, only })` dengan `only = q.only ? acceptedOptional(q.only) : undefined`; `/sync/ws` → `const client: SyncClient = { send, close, accept: acceptedOptional((req.query as { entities?: string }).entities) }`. Pastikan `requireDeviceWs` hanya menolak query `token` (tidak `entities`).

- [x] **Step 3: PASS** `sync-memory.filter.test.ts` + `sync-client.test.ts`, `sync-bootstrap.test.ts`, `sync-pull*.test.ts` (glob `server/test/sync-*.test.ts`). **Step 4: Commit** `feat(sync): hub menyaring entitas opsional per client + iklan`

---

### Task 3: Merge memori di hub (`applyPush`)

**Files:** create `server/src/services/memory/sync-merge.ts`; modify `sync.ts:applyPush`; test `server/test/sync-memory.merge.test.ts`.

- [x] **Step 1: Test yang gagal**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { applyPush, publishLocal, snapshot } from "../src/services/sync";
import { mergeMemoryRecord } from "../src/services/memory/sync-merge";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "mm-p" } });
};
let id = "";
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "mm-p", name: "p", desc: "", kind: "existing" } });
  const m = await prisma.projectMemory.create({ data: { projectId: "mm-p", kind: "fact", content: "c", scopePaths: [],
    anchors: [], status: "proposed", sourceRuntime: "human" } });
  id = m.id;
  await publishLocal("projectMemory", id);            // hub v1
  await prisma.projectMemory.update({ where: { id }, data: { status: "active" } });
  await publishLocal("projectMemory", id);            // hub v2 (diaktifkan di hub)
});
afterAll(clean);

describe("mergeMemoryRecord (murni)", () => {
  const base = { content: "c", kind: "fact", status: "active" };
  it("immutable sama → status lattice", () => {
    expect(mergeMemoryRecord({ ...base, status: "active" }, { ...base, status: "invalidated" }))
      .toEqual({ kind: "merged", data: { ...base, status: "invalidated" } });
    expect(mergeMemoryRecord({ ...base, status: "invalidated" }, { ...base, status: "active" })).toEqual({ kind: "same" });
  });
  it("immutable beda → conflict", () => {
    expect(mergeMemoryRecord(base, { ...base, content: "lain" })).toEqual({ kind: "conflict" });
  });
});

describe("applyPush projectMemory", () => {
  it("client basi (base v1) meng-invalidate → hub menggabung, bukan konflik", async () => {
    const snap = (await snapshot("projectMemory", id))!;
    const r = await applyPush("projectMemory", id, 1, { ...snap.data, status: "invalidated" });
    expect(r).toMatchObject({ ok: true, version: 3 });
    expect((await prisma.projectMemory.findUnique({ where: { id } }))?.status).toBe("invalidated");
  });
  it("client basi dengan status lebih rendah → ok tanpa menulis (hub sudah lebih maju)", async () => {
    const snap = (await snapshot("projectMemory", id))!;
    const r = await applyPush("projectMemory", id, 1, { ...snap.data, status: "proposed" });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((await prisma.projectMemory.findUnique({ where: { id } }))?.status).toBe("active");
  });
  it("isi immutable beda → konflik biasa", async () => {
    const snap = (await snapshot("projectMemory", id))!;
    const r = await applyPush("projectMemory", id, 1, { ...snap.data, content: "diubah" });
    expect(r).toMatchObject({ ok: false, conflict: true });
  });
});

describe("applyPush memoryEvent idempoten", () => {
  it("event yang sudah ada dengan base basi → ok versi sekarang", async () => {
    const e = await prisma.memoryEvent.create({ data: { memoryId: id, op: "propose", actorKind: "user" } });
    await publishLocal("memoryEvent", e.id);
    const snap = (await snapshot("memoryEvent", e.id))!;
    expect(await applyPush("memoryEvent", e.id, 0, snap.data)).toMatchObject({ ok: true, version: snap.version });
  });
});
```

- [x] **Step 2: `sync-merge.ts`**

```ts
// ADR-0180 · merge record memori untuk sync. Murni. Field selain `status`/`updatedAt` tak pernah
// berubah setelah record lahir (ADR-0178 §2), jadi dua salinan yang berbeda HANYA di status bisa
// digabung tanpa manusia: lattice monoton, yang lebih tinggi menang, seri → yang sudah ada.
import type { MemoryStatus } from "@hanoman/shared";
import { mergeStatus } from "./rules";

const MUTABLE = new Set(["status", "updatedAt"]);
type Data = Record<string, unknown>;

export function mergeMemoryRecord(current: Data, incoming: Data):
  { kind: "same" } | { kind: "merged"; data: Data } | { kind: "conflict" } {
  for (const k of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
    if (MUTABLE.has(k)) continue;
    if (JSON.stringify(current[k] ?? null) !== JSON.stringify(incoming[k] ?? null)) return { kind: "conflict" };
  }
  const merged = mergeStatus(current.status as MemoryStatus, incoming.status as MemoryStatus);
  return merged === current.status ? { kind: "same" } : { kind: "merged", data: { ...current, status: merged } };
}
```

- [x] **Step 3: `applyPush`** — ubah parameter `data` menjadi `let`-able (`data: Record<string, unknown>` → gunakan `let incoming = data;` dan ganti pemakaian `data` sesudah blok rename dengan `incoming`), lalu ganti blok konflik:

```ts
  if (currentVersion !== null && currentVersion !== baseVersion) {
    // ADR-0180 · memori: status ber-lattice, isi immutable → gabung tanpa manusia. Event append-only
    // yang sudah ada = push ulang yang idempoten.
    if (existing && entity === "memoryEvent") return { ok: true, version: currentVersion };
    if (existing && entity === "projectMemory") {
      const server = await snapshot(entity, id);
      const m = server ? mergeMemoryRecord(server.data, incoming) : { kind: "conflict" as const };
      if (m.kind === "same") return { ok: true, version: currentVersion };
      if (m.kind === "merged") { incoming = m.data; baseVersion = currentVersion; }
    }
    if (currentVersion !== baseVersion) return {
      ok: false, conflict: true, server: await snapshot(entity, id),
      ...(tomb && !existing ? { deleted: true, deletedVersion: tomb.version } : {}),
    };
  }
```

(`baseVersion` parameter juga dijadikan `let` lokal: `let base = baseVersion` — sesuaikan nama.) Import `mergeMemoryRecord` dari `./memory/sync-merge`.

- [x] **Step 4: PASS** merge test + `sync-*.test.ts`. **Step 5: Commit** `feat(sync): merge lattice status memori di hub tanpa SyncConflict`

---

### Task 4: Client — toleransi, negosiasi, gating push, merge pending, catch-up

**Files:** `server/src/services/sync-client.ts`; test `server/test/sync-memory.client.test.ts`.

**Interfaces:** `UnknownEntityError`; `hubOptional` (modul, `Set<string> | null`, di-reset oleh `__resetSyncClientState()` untuk test); `catchUpOptional(transport): Promise<number>`; `OPTIONAL_QUERY = "entities=projectMemory,memoryEvent"`.

- [ ] **Step 1: Test yang gagal** — transport `app.inject` dengan device token (pola `realTransport()` di `sync-client.test.ts:19-26`), hub & client berbagi DB sehingga skenario memakai `applyRemote`/`snapshot` langsung:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import {
  __resetSyncClientState, applyFeedFrame, catchUpOptional, syncOnce, validateIncomingRecord, type Transport,
} from "../src/services/sync-client";
import { enqueueOutbox } from "../src/services/outbox";
import { publishLocal } from "../src/services/sync";

const app = buildApp({ requireAuth: false });
let token = "";
const transport = (opts: { oldHub?: boolean } = {}): Transport => async (method, path, body) => {
  const r = await app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, ...(body ? { payload: body as object } : {}) });
  const parsed = r.body ? JSON.parse(r.body) : null;
  if (opts.oldHub && parsed && "entities" in parsed) delete parsed.entities;   // hub lama tak beriklan
  return { status: r.statusCode, body: parsed };
};
const seen: string[] = [];
const spy = (t: Transport): Transport => async (m, p, b) => { seen.push(`${m} ${p}`); return t(m, p, b); };

const clean = async () => {
  await prisma.syncOutbox.deleteMany(); await prisma.syncState.deleteMany(); await prisma.syncConflict.deleteMany();
  await prisma.syncLog.deleteMany(); await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "sc-p" } });
};
beforeEach(async () => {
  await clean(); __resetSyncClientState(); seen.length = 0;
  await prisma.user.deleteMany({ where: { email: "sc@t.co" } });
  const u = await prisma.user.create({ data: { email: "sc@t.co", passwordHash: "x" } });
  token = (await issueDeviceToken(u.id, "dev")).token;
  await prisma.project.create({ data: { id: "sc-p", name: "p", desc: "", kind: "existing" } });
  await publishLocal("project", "sc-p");
});
afterAll(clean);

describe("toleransi entitas tak dikenal", () => {
  it("validateIncomingRecord tetap melempar UnknownEntityError (kontrak lama)", () => {
    expect(() => validateIncomingRecord({ entity: "masaDepan", recordId: "x", version: 1, data: {} })).toThrow(/entity/);
  });
  it("frame WS entitas tak dikenal tak menyalakan feedHole (kursor tetap maju)", async () => {
    expect(await applyFeedFrame({ entity: "masaDepan", recordId: "x", version: 1, data: {}, seq: "99" })).toBe(true);
  });
});

describe("negosiasi", () => {
  it("pull & bootstrap menyebut entities=", async () => {
    await syncOnce(spy(transport()));
    expect(seen.some((s) => s.includes("entities=projectMemory,memoryEvent"))).toBe(true);
  });
  it("hub lama (tanpa iklan) → push memori DITAHAN di outbox, tanpa error", async () => {
    const m = await prisma.projectMemory.create({ data: { projectId: "sc-p", kind: "fact", content: "c", scopePaths: [],
      anchors: [], status: "active", sourceRuntime: "human" } });
    await enqueueOutbox("projectMemory", m.id);
    await syncOnce(transport({ oldHub: true }));
    expect(await prisma.syncOutbox.count({ where: { entity: "projectMemory" } })).toBe(1);
  });
});

describe("merge pending di client", () => {
  it("record memori pending + hub mengirim status lebih tinggi → status lokal naik, tanpa SyncConflict", async () => {
    const m = await prisma.projectMemory.create({ data: { projectId: "sc-p", kind: "fact", content: "c", scopePaths: [],
      anchors: [], status: "active", sourceRuntime: "human" } });
    await publishLocal("projectMemory", m.id);
    await prisma.projectMemory.update({ where: { id: m.id }, data: { status: "invalidated" } });
    await publishLocal("projectMemory", m.id);     // "hub" kini invalidated
    await prisma.projectMemory.update({ where: { id: m.id }, data: { status: "active", version: 1 } }); // lokal basi
    await enqueueOutbox("projectMemory", m.id);
    await syncOnce(transport());
    expect(await prisma.syncConflict.count()).toBe(0);
    expect((await prisma.projectMemory.findUnique({ where: { id: m.id } }))?.status).toBe("invalidated");
  });
});

describe("catch-up entitas opsional", () => {
  it("kursor sudah maju, penanda kosong, hub beriklan → bootstrap only=… sekali, lalu penanda tercatat", async () => {
    await syncOnce(transport());                    // kursor > 0, hubOptional terisi
    await prisma.syncState.update({ where: { id: 1 }, data: { entities: "" } });
    seen.length = 0;
    await catchUpOptional(spy(transport()));
    expect(seen.some((s) => s.includes("/api/sync/bootstrap") && s.includes("only=projectMemory,memoryEvent"))).toBe(true);
    expect((await prisma.syncState.findUnique({ where: { id: 1 } }))?.entities).toBe("projectMemory,memoryEvent");
    seen.length = 0;
    await catchUpOptional(spy(transport()));
    expect(seen).toEqual([]);
  });
});
```

Sesuaikan pembuatan user/device token dengan factory yang ada (`server/test/factory.ts`, mis. `makeUser`) bila skema `User` mewajibkan kolom lain.

- [ ] **Step 2: Implementasi** di `sync-client.ts`:

```ts
import { OPTIONAL_ENTITIES, isOptionalEntity } from "./sync";
import { mergeMemoryRecord } from "./memory/sync-merge";

// ADR-0180 · entitas opsional yang diminta mesin ini. Query, bukan header: `Transport` tak membawa
// header, dan URL WS hanya menolak `token` di query.
export const OPTIONAL_QUERY = `entities=${OPTIONAL_ENTITIES.join(",")}`;
// Entitas opsional yang DIIKLANKAN hub pada pull terakhir. `null` = belum tahu / hub lama.
let hubOptional: Set<string> | null = null;
export function __resetSyncClientState(): void { hubOptional = null; feedHole = false; }

export class UnknownEntityError extends Error {
  constructor(entity: unknown) { super(`sync entity tak dikenal: ${String(entity)}`); }
}
```

- `validateIncomingRecord`: `throw new UnknownEntityError(row.entity)` menggantikan `throw new Error("sync entity tak dikenal")`.
- `applyFeedFrame`: di `catch (e)`, `if (e instanceof UnknownEntityError) { if (msg.seq && !feedHole) await setCursor(String(msg.seq)); return true; }` sebelum `feedHole = true`.
- `bootstrapOnce`: URL `/api/sync/bootstrap?${OPTIONAL_QUERY}${after ? `&after=${…}` : ""}`; record `UnknownEntityError` → `continue`. Setelah sukses, `await setOptionalMarker(res.body.entities)` (hanya entitas yang diiklankan).
- `syncOnce` pull: URL `/api/sync/pull?since=${cursor}&${OPTIONAL_QUERY}`; `hubOptional = Array.isArray(pullRes.body?.entities) ? new Set(pullRes.body.entities) : null;`; ganti `rawRecords.map(validateIncomingRecord)` dengan:

```ts
    const records: IncomingRecord[] = [];
    for (const raw of rawRecords) {
      try { records.push(validateIncomingRecord(raw)); }
      catch (e) {
        if (!(e instanceof UnknownEntityError)) throw e;
        // ADR-0180 · hub lebih baru dari mesin ini: lewati, jangan macet.
        stats.dropped++;
      }
    }
```

- Cabang pending: sebelum `const local = await snapshot(...)` khusus memori:

```ts
      if (rec.op === "upsert" && pending.has(`${rec.entity}:${rec.recordId}`)) {
        const local = await snapshot(rec.entity as Entity, rec.recordId);
        if (local && rec.entity === "memoryEvent") continue;   // immutable — push akan idempoten
        if (local && rec.entity === "projectMemory") {
          const m = mergeMemoryRecord(local.data, rec.data);
          if (m.kind !== "conflict") {
            // Ambil status gabungan, tetap di outbox: push berikutnya digabung lagi di hub.
            if (m.kind === "merged") await prisma.projectMemory.update({ where: { id: rec.recordId }, data: { status: m.data.status as string } });
            continue;
          }
        }
        if (local && JSON.stringify(local.data) !== JSON.stringify(rec.data)) { … (tetap) }
        continue;
      }
```

  Catatan: `mergeMemoryRecord(local, remote)` mengembalikan `same` bila lokal sudah lebih tinggi — lokal dibiarkan, dan push akan menaikkan hub.

- Setelah loop pull & `retryDeferred`, sebelum loop outbox: `await catchUpOptional(transport).catch((e) => console.warn("sync: catch-up entitas opsional gagal —", (e as Error).message));`
- Loop outbox, setelah `if (!isEntity(item.entity)) …`:

```ts
    // ADR-0180 · hub yang belum mendukung entitas opsional akan menolaknya per-record selamanya.
    // Tahan di outbox (bukan dibuang) — terkirim begitu hub naik versi.
    if (isOptionalEntity(item.entity) && !hubOptional?.has(item.entity)) continue;
```

- Catch-up:

```ts
async function getOptionalMarker(): Promise<Set<string>> {
  const s = await prisma.syncState.findUnique({ where: { id: 1 } });
  return new Set((s?.entities ?? "").split(",").filter(Boolean));
}
async function setOptionalMarker(entities: unknown): Promise<void> {
  const have = await getOptionalMarker();
  for (const e of Array.isArray(entities) ? entities : []) if (isOptionalEntity(String(e))) have.add(String(e));
  const value = OPTIONAL_ENTITIES.filter((e) => have.has(e)).join(",");
  await prisma.syncState.upsert({ where: { id: 1 }, create: { id: 1, entities: value }, update: { entities: value } });
}

/**
 * ADR-0180 · mesin yang naik versi SESUDAH hub mulai menyimpan memori: kursornya sudah melewati
 * baris memori yang dulu disaring untuknya. Tarik KEADAAN entitas itu sekali lewat bootstrap `only`,
 * tanpa memindahkan kursor feed (baris yang lebih baru tetap datang lewat pull).
 */
export async function catchUpOptional(transport: Transport): Promise<number> {
  const have = await getOptionalMarker();
  const missing = OPTIONAL_ENTITIES.filter((e) => !have.has(e) && hubOptional?.has(e));
  if (!missing.length) return 0;
  if (await getCursor() === "0") { await setOptionalMarker(missing); return 0; }   // drain dari nol membawanya
  const only = missing.join(",");
  let after: string | null = null; let applied = 0;
  for (let page = 0; page < MAX_DRAIN_PAGES; page++) {
    const q = `${OPTIONAL_QUERY}&only=${only}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const res = await transport("GET", `/api/sync/bootstrap?${q}`);
    if (res.status !== 200 || !Array.isArray(res.body?.records)) return applied;   // coba lagi siklus berikutnya
    for (const raw of res.body.records as unknown[]) {
      const rec = validateIncomingRecord(raw);
      if (rec.op) { await applyRemote(rec.entity, rec.recordId, rec.version, rec.data, rec.op); applied++; }
    }
    const next = res.body.next ? String(res.body.next) : null;
    if (!res.body.hasMore || !next) break;
    after = next;
  }
  await setOptionalMarker(missing);
  return applied;
}
```

- WS client (`sync-client.ts` ±478): `const wsUrl = … + "/api/sync/ws?" + OPTIONAL_QUERY;`

- [ ] **Step 3: PASS** `sync-memory.client.test.ts` + seluruh `server/test/sync-*.test.ts`, `team-sync-runtime.test.ts`, `qa-sync-wiring.route.test.ts`. Bila `sync-client.test.ts` mencocokkan URL pull secara literal, perbarui ekspektasinya dengan query baru (perilaku tak berubah).
- [ ] **Step 4: Commit** `feat(sync): client — toleransi entitas tak dikenal, negosiasi opsional, merge memori pending, catch-up`

---

### Task 5: Store memori ikut sync + hapus permanen

**Files:** `server/src/services/memory/store.ts`, `server/src/routes/memories.ts`, `server/src/services/agent-capabilities.ts`; test `server/test/memory-sync-wiring.test.ts`, tambahan `memories.route.test.ts`, `memory-token.test.ts`.

- [ ] **Step 1: Test yang gagal**

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { invalidateMemory, proposeMemory } from "../src/services/memory/store";
import { deleteSynced } from "../src/services/sync-delete";

let dir = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncTombstone.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "sw-p" } });
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-sw-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "a.ts"), "1\n"); g("add", "."); g("commit", "-qm", "1"); head = g("rev-parse", "HEAD");
});
beforeEach(async () => { await clean(); await prisma.project.create({ data: { id: "sw-p", name: "p", desc: "", kind: "existing", repoDir: dir } }); });
afterAll(clean);
const scope = () => ({ projectId: "sw-p", repoDir: dir, head, headVerified: true });
const actor = { kind: "user" as const, id: "u1" };

describe("store memori → feed sync (peran hub)", () => {
  it("propose aktif: memori + kedua event masuk SyncLog; versi dinaikkan HANYA oleh publishLocal", async () => {
    const r = await proposeMemory(scope(), actor, { kind: "fact", content: "a.ts ada", scopePaths: [], anchors: [{ path: "a.ts" }] });
    if (!r.ok) throw new Error("setup");
    const logs = await prisma.syncLog.findMany({ orderBy: { seq: "asc" } });
    expect(logs.map((l) => l.entity)).toEqual(["projectMemory", "memoryEvent", "memoryEvent"]);
    expect((await prisma.projectMemory.findUnique({ where: { id: r.memory.id } }))?.version).toBe(1);
    expect(r.memory.source.deviceId).toBe("local");
  });
  it("invalidate: status baru ikut feed, versi naik 1", async () => {
    const r = await proposeMemory(scope(), actor, { kind: "fact", content: "a.ts ada", scopePaths: [], anchors: [{ path: "a.ts" }] });
    if (!r.ok) throw new Error("setup");
    await invalidateMemory(scope(), actor, r.memory.id, "salah");
    expect((await prisma.projectMemory.findUnique({ where: { id: r.memory.id } }))?.version).toBe(2);
  });
  it("hapus permanen: tombstone, event ikut cascade", async () => {
    const r = await proposeMemory(scope(), actor, { kind: "fact", content: "a.ts ada", scopePaths: [], anchors: [{ path: "a.ts" }] });
    if (!r.ok) throw new Error("setup");
    await deleteSynced("projectMemory", r.memory.id);
    expect(await prisma.memoryEvent.count({ where: { memoryId: r.memory.id } })).toBe(0);
    expect(await prisma.syncTombstone.count({ where: { entity: "projectMemory", recordId: r.memory.id } })).toBe(1);
  });
});
```

Tambahan route (`memories.route.test.ts`, blok cookie): `DELETE /api/memories/:id?projectId=rt-a` → `204`; id project lain → `404`; agent token → `403`. Tambahan peta (`memory-token.test.ts`): `capabilityForRoute("DELETE", "/api/memories/abc")` → `"COOKIE_ONLY"`.

- [ ] **Step 2: Implementasi `store.ts`**
  - Hapus ketiga `version: { increment: 1 }`.
  - `import { LOCAL_DEVICE_ID } from "@hanoman/shared"; import { notifySynced } from "../sync-notify";`
  - Di `create()` data: `sourceDeviceId: LOCAL_DEVICE_ID,`.
  - Setiap transaksi mengumpulkan sentuhan lalu, SESUDAH commit, memberi tahu sync — memori lebih dulu daripada event (urutan FK di outbox):

```ts
type Touched = { memories: string[]; events: string[] };
async function notifyTouched(t: Touched): Promise<void> {
  for (const id of t.memories) await notifySynced("projectMemory", id);
  for (const id of t.events) await notifySynced("memoryEvent", id);
}
```

  `retireSuperseded(tx, m, actor, touched)` mendorong `old.id` ke `touched.memories` dan id event ke `touched.events`. `create`, `invalidateMemory`, `reviewMemory` membuat `const touched: Touched = { memories: [], events: [] }`, mengisi id setiap baris yang dibuat/diubah di dalam transaksi (`tx.memoryEvent.create` mengembalikan baris → ambil `.id`), lalu `await notifyTouched(touched)` sebelum `return`.
  - Pastikan tanda tangan `notifySynced(entity, id)` di `sync-notify.ts` menerima `Entity` — impor tipe bila perlu.

- [ ] **Step 3: Hapus permanen**
  - `agent-capabilities.ts` cabang `memories`: `if (method === "DELETE" || seg[2] === "activate" || seg[2] === "reject") return "COOKIE_ONLY";`
  - `routes/memories.ts`:

```ts
  // ADR-0180 · hapus permanen (mis. memori berisi secret yang lolos). Manusia saja; tombstone menang
  // tanpa syarat di semua mesin, event ikut cascade.
  app.delete("/memories/:id", async (req, reply) => {
    if (!req.user) return reply.code(403).send({ error: "cookie session required" });
    const { id } = req.params as { id: string };
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) return reply.code(400).send({ error: "projectId wajib" });
    const m = await prisma.projectMemory.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!m) return reply.code(404).send({ error: "memori tidak ditemukan" });
    await deleteSynced("projectMemory", id);
    return reply.code(204).send();
  });
```

- [ ] **Step 4: PASS** `memory-sync-wiring`, semua `memory*.test.ts`, `memories.route.test.ts`, `mcp-coverage.test.ts` (DELETE cookie-only dilewati). **Step 5: Commit** `feat(memory): store ikut sync (tanpa bump versi lokal) + hapus permanen cookie-only`

---

### Task 6: ADR-0180, docs, verifikasi nyata

- [ ] **Step 1: ADR** `internal/docs/adr/0180-sync-memori-entitas-opsional.md`: konteks (B1 client lama macet, B2 kolom, B3 bump versi tahap 1), keputusan 1–8, mekanisme kursor-dikonsumsi, urutan rilis (hub dulu tetap disarankan; client baru + hub lama aman: memori tertahan di outbox), konsekuensi (dua pengganti paralel untuk memori yang sama bisa sama-sama aktif; `sourceTokenId` adalah id token mesin asal, tak bermakna di mesin lain).
- [ ] **Step 2: Docs** — `internal/docs/architecture/data-model.md` (bagian sync: dua entitas baru + opsional + `SyncState.entities`; bagian memori: kolom baru `MemoryEvent`), `api-contract.md` (`?entities=`, `?only=`, field `entities` di balasan pull/bootstrap, `DELETE /api/memories/:id`), ADR-0178 baris "tahap sync" → tautan ADR-0180, `internal/docs/README.md` (entri ADR-0180).
- [ ] **Step 3: Seluruh test sync + memori** — `server/test/sync-*.test.ts`, `memory*.test.ts`, `memories.route.test.ts`, `team-sync-runtime.test.ts`, `qa-sync-wiring.route.test.ts`, `mcp-coverage.test.ts`, `cli/test`, typecheck server/cli/shared/src.
- [ ] **Step 4: Verifikasi nyata dua instance** — hub (`HANOMAN_HOME` A, port 8799) dan client (`HANOMAN_HOME` B, port 8798, `SYNC_SERVER_URL=http://127.0.0.1:8799`, device token dari hub): buat project + memori di hub → `POST /api/sync/now` di client → memori ada di client; invalidate di client → sync → status `invalidated` di hub; hapus permanen di hub → sync → hilang di client. Lalu simulasi client lama: `curl /api/sync/pull?since=0` dengan device token **tanpa** `entities=` → tak ada baris memori dan `cursor` = ujung feed. Catat hasil.
- [ ] **Step 5: Centang & commit** `docs(memory): ADR-0180 sync memori + kontrak + hasil verifikasi tahap 3`

## Hasil verifikasi lokal

_(diisi di Task 6 Step 4)_
