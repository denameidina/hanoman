# SPEC-804 — Tandai backlog selesai (done) manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator (dan agen lewat REST) bisa menandai satu item backlog sebagai `done` dari dashboard tanpa menjalankan sesi, dengan konfirmasi, jejak siapa/kapan/alasan, dan efek yang identik dengan item yang selesai lewat sesi.

**Architecture:** Satu endpoint operasi khusus `POST /specs/:id/done` (bukan pelonggaran `PATCH {stage}` yang sengaja backward-only) → satu titik cekik `services/spec-complete.ts` yang melakukan CAS stage + `recordCompletion` + `recordSessionResult` + `notifySynced`. Jejaknya satu kolom `Spec.manualDone Json?` (`{at, by, reason?}`). Overlay stage-live sudah forward-only sehingga tulisan itu durable; sweep auto-merge diberi gerbang agar penyelesaian manual tak pernah men-trigger merge.

**Tech Stack:** Fastify + Prisma 6 (SQLite) + zod (`@hanoman/shared`) + React/TS (Vite) + vitest.

## Global Constraints

- Design doc acuan: `docs/superpowers/specs/2026-08-15-spec-804-tandai-backlog-selesai-manual-design.md`.
- `PATCH /specs/:id {stage}` **tetap backward-only**. Jangan menyentuh gerbang `STAGES.indexOf(stage) >= STAGES.indexOf(spec.stage)` di `server/src/routes/specs.ts:211`.
- `doneAt` (ADR-0105) tetap tulis-sekali dan **hanya** ditulis di dalam `recordCompletion()`. Jangan menulisnya dari call site baru.
- Kolom baru wajib masuk `FIELDS.spec` + `JSON_FIELDS` di `server/src/services/sync.ts`. **Bukan** `DATE_FIELDS` — `at` hidup di dalam JSON.
- Migration **ditulis tangan**, aditif murni. Jangan menjalankan `prisma migrate dev` (worktree tetangga membuatnya me-reset DB saat ada drift).
- Batas panjang alasan: **280 karakter**.
- Semua test server dijalankan dengan `--no-file-parallelism` **dan** `TEST_DATABASE_URL` terpisah:
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>`
- Bahasa komentar & string UI: Indonesia, mengikuti berkas sekitarnya. Jangan menulis komentar yang mengulang kode.

---

### Task 1: Kolom `Spec.manualDone` + kontrak bersama (schema, migration, sync, webhook, zod)

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Spec`, sesudah `doneAt`)
- Create: `server/prisma/migrations/20260815130000_spec_manual_done/migration.sql`
- Modify: `shared/src/entities.ts` (`zManualDone`, `zSpec`)
- Modify: `shared/src/dto.ts` (`zMarkSpecDone`)
- Modify: `shared/src/webhook.ts` (`WEBHOOK_ENTITIES` entri `spec`: `fields` + `sample`)
- Modify: `server/src/services/sync.ts` (`FIELDS.spec`, `JSON_FIELDS`)
- Test: `server/test/spec-manual-done-contract.test.ts` (baru)

**Interfaces:**
- Consumes: —
- Produces:
  - `zManualDone` / `type ManualDone = { at: string; by: string; reason?: string }` (`@hanoman/shared`)
  - `zMarkSpecDone` / `type MarkSpecDone = { reason?: string; confirm?: boolean }` (`@hanoman/shared`)
  - kolom Prisma `Spec.manualDone: Prisma.JsonValue | null`

- [ ] **Step 1: Tulis test kontrak yang gagal**

Create `server/test/spec-manual-done-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { WEBHOOK_ENTITIES, zManualDone, zMarkSpecDone, zSpec } from "@hanoman/shared";
import { __FIELDS, __DATE_FIELDS, __JSON_FIELDS } from "../src/services/sync";

const specModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Spec")!;

describe("SPEC-804 · kontrak kolom Spec.manualDone", () => {
  it("kolomnya ada di skema sebagai Json opsional", () => {
    const col = specModel.fields.find((f) => f.name === "manualDone");
    expect(col).toBeTruthy();
    expect(col!.type).toBe("Json");
    expect(col!.isRequired).toBe(false);
  });

  // Kelas gagal-senyap ADR-0090/0093/0094/0105: `upsert` yang tak menyebut sebuah kolom TETAP
  // berhasil, jadi kolom yang lupa didaftarkan mendarat sebagai null palsu di tiap client.
  it("ikut menyeberang sync sebagai JSON, bukan DATE", () => {
    expect(__FIELDS.spec).toContain("manualDone");
    expect(__JSON_FIELDS.has("spec:manualDone")).toBe(true);
    expect(__DATE_FIELDS.spec).not.toContain("manualDone");
  });

  it("penerima webhook bisa membedakan selesai-manual dari selesai-lewat-sesi", () => {
    const spec = WEBHOOK_ENTITIES.find((d) => d.entity === "spec")!;
    expect(spec.fields).toContain("manualDone");
  });

  it("zManualDone menuntut at & by, reason opsional", () => {
    expect(zManualDone.safeParse({ at: "2026-08-15T00:00:00.000Z", by: "dena@x" }).success).toBe(true);
    expect(zManualDone.safeParse({ at: "2026-08-15T00:00:00.000Z", by: "dena@x", reason: "sudah ter-merge" }).success).toBe(true);
    expect(zManualDone.safeParse({ by: "dena@x" }).success).toBe(false);
  });

  it("zMarkSpecDone: body kosong sah, alasan > 280 ditolak", () => {
    expect(zMarkSpecDone.safeParse({}).success).toBe(true);
    expect(zMarkSpecDone.safeParse({ reason: "x".repeat(280), confirm: true }).success).toBe(true);
    expect(zMarkSpecDone.safeParse({ reason: "x".repeat(281) }).success).toBe(false);
  });

  it("zSpec membawa manualDone dan tetap parse respons versi lama", () => {
    const old = {
      id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "done", priority: "sedang",
      author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null,
      createdAt: "2026-08-15T00:00:00.000Z", startedAt: null,
    };
    const parsed = zSpec.parse(old);
    expect(parsed.manualDone).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-manual-done-contract.test.ts`
Expected: FAIL — `zManualDone`/`zMarkSpecDone`/`__JSON_FIELDS` belum diekspor.

- [ ] **Step 3: Tambahkan kolom di `server/prisma/schema.prisma`**

Sisipkan tepat sesudah baris `doneAt     DateTime?` di model `Spec`:

```prisma
  // SPEC-804 · ADR-0120 · jejak penandaan selesai MANUAL: { at, by, reason? }. Satu kolom, bukan
  // tiga skalar — ketiganya satu peristiwa, dan tiga kolom nullable bisa drift tanpa tipe yang
  // memaksanya konsisten (kelas gagal-senyap ADR-0090/0093/0094/0105). null = item ini tak pernah
  // ditandai manual. Ditimpa tiap penandaan berikutnya: ia menjelaskan keadaan yang BERLAKU;
  // riwayat transisi stage tinggal di SessionResult (ADR-0047). Ikut FIELDS.spec sync.
  manualDone Json?
```

- [ ] **Step 4: Tulis migration**

Create `server/prisma/migrations/20260815130000_spec_manual_done/migration.sql`:

```sql
-- SPEC-804 · ADR-0120 · jejak penandaan selesai manual sebagai kolom.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu kolom NULLABLE tanpa default, tak ada tabel diredefinisi.
--
-- TANPA backfill, sengaja: sebelum spec ini jalur "tandai selesai manual" memang tak ada, jadi
-- tak ada stempel lama yang bisa dipulihkan. Item lama tetap NULL = "selesai lewat sesi / tak
-- diketahui", dan itu jawaban yang jujur.
ALTER TABLE "Spec" ADD COLUMN "manualDone" JSONB;
```

- [ ] **Step 5: Terapkan migration + regenerate client**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server exec prisma generate
```
Expected: `Generated Prisma Client`. (Migration diterapkan otomatis oleh `server/test/global-setup.ts` saat test dijalankan.)

- [ ] **Step 6: Tambahkan `zManualDone` + field `zSpec` di `shared/src/entities.ts`**

Sisipkan tepat sebelum `export const zSpec = z.object({`:

```ts
// SPEC-804 · ADR-0120 · jejak penandaan selesai MANUAL. `at` menjawab "kapan operator menandai" —
// pertanyaan yang BERBEDA dari `doneAt` (ADR-0105, "selesai pertama"), jadi keduanya tak bersaing.
export const zManualDone = z.object({
  at: z.string(), by: z.string(), reason: z.string().optional(),
});
export type ManualDone = z.infer<typeof zManualDone>;
```

Lalu sisipkan sebagai field terakhir di dalam `zSpec` (sesudah `sourceHistory`):

```ts
  // SPEC-804 · ADR-0120 · terisi hanya bila item ditandai selesai manual; null = selesai lewat
  // sesi atau belum selesai. `.nullable().default(null)` menjaga respons/klien versi lama parse.
  manualDone: zManualDone.nullable().default(null),
```

- [ ] **Step 7: Tambahkan `zMarkSpecDone` di `shared/src/dto.ts`**

Sisipkan tepat sesudah blok `zChangeSpecSource` (yang berakhir di baris `});` sebelum komentar `// SPEC-175 · rebase/merge`):

```ts
// SPEC-804 · ADR-0120 · tandai backlog selesai MANUAL. Operasi khusus, bukan field `zPatchSpec`:
// `stage` di sana backward-only by construction (SPEC-167) dan melonggarkannya meruntuhkan
// seluruh premis "kemajuan hanya berasal dari fase sesi" (ADR-0008).
// `confirm` hanya dibutuhkan saat ada sesi hidup untuk item ini (dua langkah, cermin ADR-0088).
export const zMarkSpecDone = z.object({
  reason: z.string().trim().max(280).optional(),
  confirm: z.boolean().optional(),
});
export type MarkSpecDone = z.infer<typeof zMarkSpecDone>;
```

Verifikasi `zManualDone`/`zMarkSpecDone` ikut terekspor: `shared/src/index.ts` sudah mengekspor `entities.ts` & `dto.ts` secara agregat — cek dengan `rtk proxy grep -n "entities\|dto" shared/src/index.ts`. Bila ekspornya bernama satu per satu, tambahkan kedua nama itu.

- [ ] **Step 8: Daftarkan kolom di `server/src/services/sync.ts`**

Pada `FIELDS.spec` (baris ~54), tambahkan `"manualDone"` tepat sesudah `"sourceHistory"`, dan tambahkan blok komentar di atas `spec:` :

```ts
  // SPEC-804 · ADR-0120 · manualDone ikut menyeberang: "item ini ditandai selesai manusia" adalah
  // bagian keadaan yang harus dilihat sama oleh semua mesin — di antaranya gerbang auto-merge.
  // BUKAN DATE_FIELDS — `at` hidup di dalam JSON-nya, kolomnya sendiri bukan DateTime.
```

Pada `JSON_FIELDS` (baris ~111), tambahkan `"spec:manualDone"` ke baris `"spec:payload", "spec:dependsOn", "spec:sourceHistory",`.

Tepat di bawah `export const __DATE_FIELDS = DATE_FIELDS;` (baris ~105) tambahkan ekspor test-only baru — letakkan **sesudah** deklarasi `JSON_FIELDS` agar tak ada TDZ; yaitu sisipkan sesudah baris yang menutup `const JSON_FIELDS = new Set([...]);`:

```ts
export const __JSON_FIELDS = JSON_FIELDS;
```

- [ ] **Step 9: Tambahkan kolom ke katalog webhook `shared/src/webhook.ts`**

Pada entri `entity: "spec"`, ubah array `fields` (baris ~89–90) agar memuat `"manualDone"` sesudah `"startedAt"`:

```ts
    fields: ["id", "projectId", "title", "source", "stage", "priority", "author", "objective",
      "branchFrom", "baseSha", "headSha", "dependsOn", "autoMerge", "createdAt", "startedAt",
      // SPEC-804 · ADR-0120 · penerima harus bisa membedakan "selesai lewat sesi" dari "ditandai
      // manusia" tanpa mendiff dua amplop. Peristiwanya tetap `spec.stage_changed`.
      "manualDone", "updatedAt"],
```

Pada `sample` entri yang sama (baris ~107–115), tambahkan setelah `startedAt`:

```ts
      manualDone: null,
```

- [ ] **Step 10: Jalankan test kontrak — harus lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-manual-done-contract.test.ts server/test/webhook-catalog-dmmf.test.ts server/test/spec-done-at.test.ts`
Expected: PASS (3 berkas, semua hijau).

- [ ] **Step 11: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`
Expected: keluar 0 tanpa error.

- [ ] **Step 12: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260815130000_spec_manual_done \
  shared/src/entities.ts shared/src/dto.ts shared/src/webhook.ts \
  server/src/services/sync.ts server/test/spec-manual-done-contract.test.ts
git commit -m "feat(spec-804): kolom Spec.manualDone + kontrak sync/webhook/zod"
```

---

### Task 2: `services/spec-complete.ts` — satu titik cekik penyelesaian manual

**Files:**
- Create: `server/src/services/spec-complete.ts`
- Test: `server/test/spec-complete.service.test.ts` (baru)

**Interfaces:**
- Consumes: kolom `Spec.manualDone` (Task 1); `recordCompletion` (`server/src/services/notifications.ts`), `recordSessionResult` (`server/src/services/session-result.ts`), `notifySynced` (`server/src/services/sync-notify.ts`).
- Produces:
  ```ts
  export type ManualDoneInput = { by: string; reason?: string; at?: Date };
  export type CompleteResult = { ok: false } | { ok: true; spec: Spec };
  export async function completeSpecManually(spec: Spec, input: ManualDoneInput): Promise<CompleteResult>
  ```
  (`Spec` = tipe baris Prisma, `import type { Spec } from "@prisma/client"`.)

- [ ] **Step 1: Tulis test yang gagal**

Create `server/test/spec-complete.service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { completeSpecManually } from "../src/services/spec-complete";
import { resetDb, makeProject, makeSpec } from "./factory";

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
});

const load = (id: string) => prisma.spec.findUnique({ where: { id } });

describe("SPEC-804 · completeSpecManually", () => {
  it("memindahkan stage ke done dan menyimpan jejak {at,by,reason}", async () => {
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "planned", title: "judul" });
    const spec = (await load("SPEC-1"))!;
    const res = await completeSpecManually(spec, { by: "dena@x", reason: "sudah ter-merge lewat PR #12" });
    expect(res.ok).toBe(true);
    const after = (await load("SPEC-1"))!;
    expect(after.stage).toBe("done");
    expect(after.manualDone).toMatchObject({ by: "dena@x", reason: "sudah ter-merge lewat PR #12" });
    expect(typeof (after.manualDone as { at: string }).at).toBe("string");
  });

  it("alasan absen tak menulis key `reason`", async () => {
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "brainstorming" });
    await completeSpecManually((await load("SPEC-2"))!, { by: "dena@x" });
    expect(Object.keys((await load("SPEC-2"))!.manualDone as object).sort()).toEqual(["at", "by"]);
  });

  it("menstempel doneAt + notifikasi done: + SessionResult ber-author", async () => {
    await makeSpec({ id: "SPEC-3", projectId: "p1", stage: "executing", title: "judul" });
    await completeSpecManually((await load("SPEC-3"))!, { by: "dena@x" });
    expect((await load("SPEC-3"))!.doneAt).toBeInstanceOf(Date);
    const notif = await prisma.notification.findFirst({ where: { key: "done:SPEC-3" } });
    expect(notif).toBeTruthy();
    const result = await prisma.sessionResult.findFirst({ where: { specId: "SPEC-3" } });
    expect(result).toMatchObject({ oldStage: "executing", newStage: "done", status: "done", author: "dena@x" });
  });

  it("CAS: item yang keburu done di bawah kita ditolak tanpa menulis apa pun", async () => {
    await makeSpec({ id: "SPEC-4", projectId: "p1", stage: "planned" });
    const stale = (await load("SPEC-4"))!;
    await prisma.spec.update({ where: { id: "SPEC-4" }, data: { stage: "done" } });
    const res = await completeSpecManually(stale, { by: "dena@x" });
    expect(res.ok).toBe(false);
    expect((await load("SPEC-4"))!.manualDone).toBeNull();
  });

  it("doneAt yang sudah ada tak bergeser — write-once ADR-0105", async () => {
    const old = new Date("2026-01-01T00:00:00.000Z");
    await makeSpec({ id: "SPEC-5", projectId: "p1", stage: "executing", doneAt: old });
    await completeSpecManually((await load("SPEC-5"))!, { by: "dena@x" });
    expect((await load("SPEC-5"))!.doneAt!.toISOString()).toBe(old.toISOString());
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-complete.service.test.ts`
Expected: FAIL — `Cannot find module '../src/services/spec-complete'`.

- [ ] **Step 3: Implementasikan servicenya**

Create `server/src/services/spec-complete.ts`:

```ts
import type { Prisma, Spec } from "@prisma/client";
import { prisma } from "../db";
import { recordCompletion } from "./notifications";
import { recordSessionResult } from "./session-result";
import { notifySynced } from "./sync-notify";

export type ManualDoneInput = { by: string; reason?: string; at?: Date };
export type CompleteResult = { ok: false } | { ok: true; spec: Spec };

// SPEC-804 · ADR-0120 · SATU titik cekik penyelesaian manual. Route memanggilnya; tak ada call
// site kedua. Efek samping penyelesaian sudah tiga kali dibayar repo ini saat disalin ke banyak
// call site (SPEC-431 `baseSha`, SPEC-448 `rootBypassEnv`, SPEC-475 `headSha`).
export async function completeSpecManually(spec: Spec, input: ManualDoneInput): Promise<CompleteResult> {
  const at = input.at ?? new Date();
  const manualDone = {
    at: at.toISOString(), by: input.by, ...(input.reason ? { reason: input.reason } : {}),
  };
  // CAS `stage != done`: sesi atau overlay stage-live bisa mencapai `done` di bawah kita, dan dua
  // penulisan atas satu transisi berarti dua jejak untuk satu peristiwa. Yang kalah menyerah.
  // Tap Prisma ADR-0100 memancarkan `spec.stage_changed` dari `updateMany` ini.
  const { count } = await prisma.spec.updateMany({
    where: { id: spec.id, stage: { not: "done" } },
    data: { stage: "done", manualDone: manualDone as Prisma.InputJsonValue },
  });
  if (count === 0) return { ok: false };
  // `doneAt` + notifikasi `done:` lewat fungsi yang SUDAH dipanggil ketiga jalur persist `done`
  // (advanceStage · scheduler/reconcile · liveSpecs) — bukan disalin ke sini.
  await recordCompletion(spec.id, spec.title, spec.projectId);
  // ADR-0047 · activity log. `commitSha`/`branch` sengaja tak diisi: memang tak ada.
  await recordSessionResult({
    projectId: spec.projectId, specId: spec.id, oldStage: spec.stage, newStage: "done",
    status: "done", author: input.by,
  }).catch(() => { /* activity log opsional, pola advanceStage */ });
  await notifySynced("spec", spec.id); // SPEC-213/330 · client antre push, hub publish ke feed
  return { ok: true, spec: (await prisma.spec.findUnique({ where: { id: spec.id } }))! };
}
```

- [ ] **Step 4: Jalankan test — harus lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-complete.service.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/spec-complete.ts server/test/spec-complete.service.test.ts
git commit -m "feat(spec-804): completeSpecManually sebagai satu titik cekik"
```

---

### Task 3: Endpoint `POST /specs/:id/done`

**Files:**
- Modify: `server/src/routes/specs.ts` (import + route baru sesudah `POST /specs/:id/source`, yaitu sesudah baris `});` di ~274)
- Test: `server/test/spec-done.route.test.ts` (baru)

**Interfaces:**
- Consumes: `completeSpecManually` (Task 2), `zMarkSpecDone` (Task 1), `listSessions` dari `../services/pty`.
- Produces: `POST /api/specs/:id/done` `{ reason?, confirm? }` → `Spec` (200) · `{ error: "not found" }` (404) · `{ error: "backlog item sudah selesai" }` (409) · `{ error: "confirm-required", session: { id, agent } }` (409) · `{ error: <zod flatten> }` (400).

- [ ] **Step 1: Tulis test rute yang gagal**

Create `server/test/spec-done.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/app";
import { listSessions } from "../src/services/pty";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { resetDb, makeProject, makeSpec } from "./factory";

// Overlay stage-live & daftar sesi membaca tmux nyata; di test tak ada pane. Mock keduanya —
// `listSessions` adalah gerbang "ada sesi hidup untuk item ini", dan itu yang diuji di sini.
vi.mock("../src/services/pty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/pty")>();
  return { ...actual, sessionPhasesBySpec: vi.fn(() => new Map()), listSessions: vi.fn(() => []) };
});

const app = buildApp({ requireAuth: false });
const post = (id: string, body: unknown = {}) =>
  app.inject({ method: "POST", url: `/api/specs/${id}/done`, payload: body as object });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  vi.mocked(listSessions).mockReturnValue([]);
});

describe("SPEC-804 · ADR-0120 · POST /specs/:id/done", () => {
  it("menandai selesai + menyimpan jejak, dan item hilang dari filter startable", async () => {
    await makeSpec({ id: "SPEC-810", projectId: "p1", stage: "planned", title: "judul" });
    const r = await post("SPEC-810", { reason: "sudah tercakup SPEC-799" });
    expect(r.statusCode).toBe(200);
    expect(r.json().stage).toBe("done");
    expect(r.json().manualDone).toMatchObject({ by: "system", reason: "sudah tercakup SPEC-799" });

    const list = await app.inject({ method: "GET", url: "/api/specs?project=p1&startable=true" });
    expect(list.json().items.map((s: { id: string }) => s.id)).not.toContain("SPEC-810");
  });

  it("body kosong sah — alasan opsional", async () => {
    await makeSpec({ id: "SPEC-811", projectId: "p1", stage: "brainstorming" });
    const r = await post("SPEC-811");
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json().manualDone).sort()).toEqual(["at", "by"]);
  });

  it("alasan > 280 karakter ditolak 400", async () => {
    await makeSpec({ id: "SPEC-812", projectId: "p1", stage: "planned" });
    const r = await post("SPEC-812", { reason: "x".repeat(281) });
    expect(r.statusCode).toBe(400);
  });

  it("spec tak ada → 404", async () => {
    expect((await post("SPEC-NIHIL")).statusCode).toBe(404);
  });

  it("item yang sudah done → 409, dan jejaknya tak ditulis di atas penyelesaian lama", async () => {
    await makeSpec({ id: "SPEC-813", projectId: "p1", stage: "done" });
    const r = await post("SPEC-813");
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain("sudah selesai");
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-813" } }))!.manualDone).toBeNull();
  });

  it("sesi hidup untuk item ini menuntut konfirmasi eksplisit lebih dulu", async () => {
    await makeSpec({ id: "SPEC-814", projectId: "p1", stage: "executing" });
    vi.mocked(listSessions).mockReturnValue([
      { id: "spec-814", projectId: "p1", specId: "SPEC-814", cwd: "/tmp/wt", exited: false, agent: "claude" },
    ] as unknown as ReturnType<typeof listSessions>);

    const first = await post("SPEC-814");
    expect(first.statusCode).toBe(409);
    expect(first.json().error).toBe("confirm-required");
    expect(first.json().session.id).toBe("spec-814");
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-814" } }))!.stage).toBe("executing");

    const second = await post("SPEC-814", { confirm: true });
    expect(second.statusCode).toBe(200);
    expect(second.json().stage).toBe("done");
  });

  it("pane MATI untuk item ini bukan sesi hidup — tak menuntut konfirmasi", async () => {
    await makeSpec({ id: "SPEC-815", projectId: "p1", stage: "executing" });
    vi.mocked(listSessions).mockReturnValue([
      { id: "spec-815", projectId: "p1", specId: "SPEC-815", cwd: "/tmp/wt", exited: true, agent: "claude" },
    ] as unknown as ReturnType<typeof listSessions>);
    expect((await post("SPEC-815")).statusCode).toBe(200);
  });

  it("capability-nya backlog:write, bukan cookie-only", () => {
    expect(capabilityForRoute("POST", "/api/specs/SPEC-810/done")).toBe("backlog:write");
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-done.route.test.ts`
Expected: FAIL — 404 pada semua kasus (route belum ada).

- [ ] **Step 3: Tambahkan import di `server/src/routes/specs.ts`**

Ubah baris 6 dari:

```ts
import { createSession } from "../services/pty";
```

menjadi:

```ts
import { createSession, listSessions } from "../services/pty";
```

Ubah baris 3 agar memuat `zMarkSpecDone`:

```ts
import { zCreateSpec, zPatchSpec, zIntegrate, zBatchCreateSpec, zChangeSpecSource, zMarkSpecDone, type Stage } from "@hanoman/shared";
```

Tambahkan sesudah baris 19 (`import { deleteSynced } …`):

```ts
import { completeSpecManually } from "../services/spec-complete";
```

- [ ] **Step 4: Tambahkan route**

Sisipkan tepat sesudah blok `app.post("/specs/:id/source", …)` (baris ~274, sebelum komentar `// SPEC-170 · dokumen sebuah backlog item`):

```ts
  // SPEC-804 · ADR-0120 · tandai item selesai MANUAL — item yang beres di luar sesi (dikerjakan
  // langsung, sudah ter-merge, atau sudah tercakup item lain) tak punya jalan lain untuk keluar
  // dari daftar siap-kerja selain dihapus, yang membuang id SPEC-nnn beserta riwayatnya.
  // Operasi khusus, bukan field `PATCH /specs/:id`: `stage` di sana backward-only by construction
  // (SPEC-167), dan melonggarkannya meruntuhkan premis "kemajuan hanya berasal dari fase sesi"
  // (ADR-0008) yang menopang ketiga guard CAS persist stage.
  app.post("/specs/:id/done", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zMarkSpecDone.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const spec = await prisma.spec.findUnique({ where: { id } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    // No-op adalah bug klien; menerimanya diam-diam berarti menulis jejak manual di atas
    // penyelesaian yang bukan manual (pola `POST /specs/:id/source` menolak "source tak berubah").
    if (spec.stage === "done") return reply.code(409).send({ error: "backlog item sudah selesai" });
    // Yang ditanya: adakah pane yang MENGAKU mengerjakan item ini. Itu properti `specId` pane,
    // bukan tebakan atas nama sesinya. Dua langkah, cermin `POST /update/apply` (ADR-0088).
    const live = listSessions().find((s) => s.specId === id && !s.exited);
    if (live && parsed.data.confirm !== true)
      return reply.code(409).send({ error: "confirm-required", session: { id: live.id, agent: live.agent } });
    const res = await completeSpecManually(spec, {
      by: req.user?.email ?? "system", reason: parsed.data.reason || undefined,
    });
    // count 0 = sesi/overlay menyelesaikannya di bawah kita antara findUnique dan CAS.
    if (!res.ok) return reply.code(409).send({ error: "backlog item sudah selesai" });
    return res.spec;
  });
```

- [ ] **Step 5: Jalankan test — harus lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-done.route.test.ts`
Expected: PASS (8 test).

- [ ] **Step 6: Typecheck server**

Run: `pnpm --filter ./server typecheck`
Expected: keluar 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/specs.ts server/test/spec-done.route.test.ts
git commit -m "feat(spec-804): POST /specs/:id/done dengan gerbang sesi hidup"
```

---

### Task 4: Durabilitas stage-live + gerbang auto-merge

**Files:**
- Modify: `server/src/services/auto-merge.ts` (fungsi `settleOne`, sesudah baris `if (!spec || spec.stage !== "done") return false;`)
- Test: `server/test/spec-manual-done-effects.test.ts` (baru)
- Test: `server/test/auto-merge.service.test.ts` (tambahkan satu test)

**Interfaces:**
- Consumes: `completeSpecManually` (Task 2), kolom `manualDone` (Task 1), `liveSpecs` (`server/src/services/live-specs.ts`), `sweepAutoMerge` (`server/src/services/auto-merge.ts`).
- Produces: perilaku — `settleOne` mengabaikan kandidat ber-`manualDone`.

- [ ] **Step 1: Tulis test durabilitas stage-live yang gagal**

Create `server/test/spec-manual-done-effects.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "../src/db";
import { sessionPhasesBySpec } from "../src/services/pty";
import { liveSpecs } from "../src/services/live-specs";
import { completeSpecManually } from "../src/services/spec-complete";
import { resetDb, makeProject, makeSpec } from "./factory";

vi.mock("../src/services/pty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/pty")>();
  return { ...actual, sessionPhasesBySpec: vi.fn(() => new Map()) };
});

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
});

describe("SPEC-804 · penandaan manual tak ditimpa overlay stage-live", () => {
  // Batasan spec: "jangan sekadar menulis kolom DB yang lalu ditimpa penurunan stage". Overlay
  // `liveSpecs` forward-only dan `done` stage terakhir — tapi itu bergantung pada satu
  // perbandingan indeks di berkas lain, jadi ia dikunci di sini, bukan diasumsikan.
  it("sesi yang masih melaporkan Execute tak menyeret item kembali dari done", async () => {
    await makeSpec({ id: "SPEC-820", projectId: "p1", stage: "executing", title: "judul" });
    await completeSpecManually((await prisma.spec.findUnique({ where: { id: "SPEC-820" } }))!, { by: "dena@x" });
    vi.mocked(sessionPhasesBySpec).mockReturnValue(new Map([["SPEC-820", {
      phases: [
        { name: "Brainstorm", state: "done" as const }, { name: "Objective", state: "done" as const },
        { name: "Spec", state: "done" as const }, { name: "Plan", state: "done" as const },
        { name: "Execute", state: "active" as const },
      ],
      cwd: "/tmp/tidak-ada-worktree",
    }]]));

    const out = await liveSpecs({ project: "p1" });
    expect(out.find((s) => s.id === "SPEC-820")!.stage).toBe("done");
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-820" } }))!.stage).toBe("done");
  });
});
```

- [ ] **Step 2: Jalankan test — harus lulus tanpa perubahan kode**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-manual-done-effects.test.ts`
Expected: PASS. Bila FAIL, overlay tidak forward-only seperti yang diasumsikan design — **hentikan dan laporkan**, jangan menambal `liveSpecs`.

- [ ] **Step 3: Tulis test gerbang auto-merge yang gagal**

Buka `server/test/auto-merge.service.test.ts`, baca pola `describe`-nya, dan tambahkan test berikut ke dalam `describe` teratas (sesuaikan nama helper fixture/deps dengan yang sudah ada di berkas itu — bila berkas memakai `makeDeps()`/`deps` lokal, pakai nama itu apa adanya):

```ts
  it("SPEC-804 · penyelesaian MANUAL tak pernah di-auto-merge", async () => {
    // Kandidat sweep = notifikasi `done:` (ditulis recordCompletion, kini juga oleh jalur manual).
    // Tanpa gerbang ini item yang ditandai manual memicu merge branch sesi lama yang ditinggalkan.
    await makeProject({ id: "pm", autoMerge: { mode: "branch", dest: "local", branch: "main", deleteBranch: false } });
    await makeSpec({ id: "SPEC-830", projectId: "pm", stage: "done", title: "judul",
      manualDone: { at: new Date().toISOString(), by: "dena@x" } });
    await prisma.notification.create({
      data: { type: "done", key: "done:SPEC-830", specId: "SPEC-830", projectId: "pm", title: "judul" },
    });

    const integrate = vi.fn();
    await sweepAutoMerge({ ...deps, integrate }, new Date());

    expect(integrate).not.toHaveBeenCalled();
    expect(await prisma.notification.findFirst({ where: { key: "automerge:SPEC-830" } })).toBeNull();
  });
```

- [ ] **Step 4: Jalankan test — harus gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/auto-merge.service.test.ts`
Expected: FAIL — `integrate` terpanggil, atau notifikasi `automerge:SPEC-830` lahir.

- [ ] **Step 5: Pasang gerbangnya**

Di `server/src/services/auto-merge.ts`, fungsi `settleOne`, sisipkan tepat sesudah baris `if (!spec || spec.stage !== "done") return false;`:

```ts
  // SPEC-804 · ADR-0120 · "ditandai selesai manual" berarti pekerjaannya beres DI LUAR sesi — tak
  // ada yang perlu di-merge. Tanpa gerbang ini item tanpa sesi melahirkan notifikasi "branch kerja
  // belum ter-push" sesudah grace, dan item yang punya branch sesi lama yang DITINGGALKAN akan
  // di-merge setengah jadi. Diam, bukan `report()`: tak ada yang perlu dilaporkan ke operator.
  if (spec.manualDone) return false;
```

- [ ] **Step 6: Jalankan test — harus lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/auto-merge.service.test.ts server/test/spec-manual-done-effects.test.ts`
Expected: PASS (semua test lama tetap hijau).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/auto-merge.ts server/test/auto-merge.service.test.ts \
  server/test/spec-manual-done-effects.test.ts
git commit -m "feat(spec-804): auto-merge melewati penyelesaian manual + kunci durabilitas stage-live"
```

---

### Task 5: Dashboard — dialog konfirmasi, aksi di daftar & detail, jejak

**Files:**
- Modify: `shared/src/api.ts` (`paths.specDone`)
- Modify: `src/src/api/client.ts` (`markSpecDone`)
- Create: `src/src/screens/MarkDoneDialog.tsx`
- Modify: `src/src/screens/BacklogScreen.tsx` (`SpecActions`, `SpecCard`, `SpecRow`, `BoardCard`, `SpecDetail`, `BacklogScreen`)
- Modify: `src/src/App.tsx` (handler `markSpecDone` + prop ke `BacklogScreen`)
- Test: `src/test/backlog-mark-done.test.tsx` (baru)

**Interfaces:**
- Consumes: `POST /api/specs/:id/done` (Task 3), `zSpec.manualDone` (Task 1).
- Produces:
  - `paths.specDone(id: string): string`
  - `api.markSpecDone(id: string, b: { reason?: string; confirm?: boolean }): Promise<Spec>`
  - `type MarkDoneResult = { needConfirm: true; sessionId?: string } | Spec | undefined`
  - `onMarkDone?: (s: Spec, reason: string, confirm?: boolean) => Promise<MarkDoneResult>` — prop `BacklogScreen`, diteruskan ke `SpecActions` & `SpecDetail`.
  - `<MarkDoneDialog spec onClose onSubmit />`

- [ ] **Step 1: Tulis test frontend yang gagal**

Create `src/test/backlog-mark-done.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec = {
  id: "SPEC-804", projectId: "p1", title: "Judul", source: "brief", stage: "planned",
  priority: "sedang", author: "dena", objective: "obj", payload: {}, branchFrom: null,
  baseSha: null, createdAt: "2026-08-15T00:00:00.000Z", startedAt: null,
  dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [], manualDone: null,
} as unknown as Spec;

const screenWith = (onMarkDone: any, backlog: Spec[] = [spec], detailId?: string) =>
  render(<BacklogScreen backlog={backlog} projects={[{ id: "p1", name: "p1" } as any]}
    projectFilter="all" onProjectFilter={() => {}} onMarkDone={onMarkDone}
    initialDetailId={detailId} />);

describe("SPEC-804 · tandai selesai dari dashboard", () => {
  it("aksi ada di baris daftar untuk item belum selesai, hilang untuk item done", () => {
    const { unmount } = screenWith(vi.fn());
    expect(screen.getAllByLabelText("Tandai selesai").length).toBeGreaterThan(0);
    unmount();
    screenWith(vi.fn(), [{ ...spec, stage: "done" } as Spec]);
    expect(screen.queryByLabelText("Tandai selesai")).toBeNull();
  });

  it("dialog meminta konfirmasi dan mengirim alasan", async () => {
    const onMarkDone = vi.fn().mockResolvedValue({ ...spec, stage: "done" });
    screenWith(onMarkDone);
    fireEvent.click(screen.getAllByLabelText("Tandai selesai")[0]!);
    fireEvent.change(screen.getByLabelText("Alasan singkat (opsional)"),
      { target: { value: "sudah ter-merge lewat PR #12" } });
    fireEvent.click(screen.getByRole("button", { name: "Tandai selesai" }));
    await waitFor(() =>
      expect(onMarkDone).toHaveBeenCalledWith(spec, "sudah ter-merge lewat PR #12", false));
  });

  it("409 confirm-required memunculkan peringatan sesi hidup lalu kirim ulang dengan confirm", async () => {
    const onMarkDone = vi.fn()
      .mockResolvedValueOnce({ needConfirm: true, sessionId: "spec-804" })
      .mockResolvedValueOnce({ ...spec, stage: "done" });
    screenWith(onMarkDone);
    fireEvent.click(screen.getAllByLabelText("Tandai selesai")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Tandai selesai" }));
    expect(await screen.findByTestId("mark-done-live")).toBeTruthy();
    expect(screen.getByTestId("mark-done-live").textContent).toContain("spec-804");
    fireEvent.click(screen.getByRole("button", { name: /sesi tetap berjalan/i }));
    await waitFor(() => expect(onMarkDone).toHaveBeenLastCalledWith(spec, "", true));
  });

  it("detail item menampilkan aksi dan jejak penandaan manual", () => {
    const marked = { ...spec, stage: "done",
      manualDone: { at: "2026-08-15T04:00:00.000Z", by: "dena@x", reason: "sudah tercakup SPEC-799" } } as unknown as Spec;
    screenWith(vi.fn(), [marked], "SPEC-804");
    const trail = screen.getByTestId("manual-done-trail");
    expect(trail.textContent).toContain("dena@x");
    expect(trail.textContent).toContain("sudah tercakup SPEC-799");
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

Run: `pnpm vitest --run src/test/backlog-mark-done.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Tandai selesai`.

- [ ] **Step 3: Tambahkan path & klien API**

Di `shared/src/api.ts`, sisipkan sesudah baris `specSource: (id: string) => …`:

```ts
  // SPEC-804 · ADR-0120 · tandai item selesai manual (operasi khusus, bukan field PATCH).
  specDone: (id: string) => `${API}/specs/${id}/done`,
```

Di `src/src/api/client.ts`, sisipkan sesudah `changeSpecSource` (baris ~159):

```ts
  // SPEC-804 · ADR-0120 · tandai item selesai manual. 409 `confirm-required` (detail memuat
  // `session`) = ada sesi hidup; kirim ulang dengan `confirm: true`.
  markSpecDone: (id: string, b: { reason?: string; confirm?: boolean }) =>
    j<Spec>(paths.specDone(id), { method: "POST", ...body(b) }),
```

- [ ] **Step 4: Buat `MarkDoneDialog`**

Create `src/src/screens/MarkDoneDialog.tsx`:

```tsx
import React from "react";
import { Button, Field, HnTextarea, Modal } from "../ds";
import type { Spec } from "./types";

export type MarkDoneResult = { needConfirm: true; sessionId?: string } | Spec | undefined;

const REASON_MAX = 280;

// SPEC-804 · ADR-0120 · satu dialog untuk kedua permukaan (baris daftar & detail item). Dua
// langkahnya hidup DI DALAM komponen ini: menyalinnya ke tiap call site berarti dua kalimat
// konfirmasi yang bisa berselisih. Peringatan sesi hidup datang dari respons server
// (`needConfirm`), bukan dari daftar sesi klien yang bisa basi.
export function MarkDoneDialog({ spec, onClose, onSubmit }: {
  spec: Spec;
  onClose: () => void;
  onSubmit: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
}) {
  const [reason, setReason] = React.useState("");
  const [live, setLive] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);

  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await onSubmit(spec, reason.trim(), live !== null);
      if (res && "needConfirm" in res) { setLive(res.sessionId ?? ""); return; }
      if (res) onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal open title="Tandai selesai" icon="circle-check" eyebrow={spec.id + " · " + spec.projectId}
      onClose={busy ? undefined : onClose}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 14 }}>
        Item keluar dari daftar siap-kerja dan berstatus selesai — sama seperti item yang selesai
        lewat sesi. Kode, commit, dan dokumen tidak disentuh, dan status ini masih bisa dikembalikan
        lewat “Ubah status”.
      </div>
      {live !== null && (
        <div data-testid="mark-done-live" style={{
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
          background: "var(--bone-100)", padding: 10, marginBottom: 14,
          fontSize: 12.5, color: "var(--text-strong)", lineHeight: 1.5,
        }}>
          Masih ada sesi yang berjalan untuk item ini{live ? ` (${live})` : ""}. Menandainya selesai
          tidak menghentikan sesi itu — tutup sesinya dari Terminal bila memang sudah tak dibutuhkan.
        </div>
      )}
      <Field label="Alasan singkat (opsional)"
        hint={`${reason.trim().length}/${REASON_MAX} — mis. “sudah ter-merge lewat PR #12”`}>
        <HnTextarea aria-label="Alasan singkat (opsional)" rows={2} value={reason}
          maxLength={REASON_MAX} disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="sudah dikerjakan langsung di checkout" />
      </Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Batal</Button>
        <Button size="sm" variant="primary" leftIcon="circle-check" loading={busy} onClick={submit}>
          {live !== null ? "Tandai selesai — sesi tetap berjalan" : "Tandai selesai"}
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Pasang aksi di `SpecActions` (`src/src/screens/BacklogScreen.tsx`)**

Tambahkan import di bawah `import { ChangeSourceDialog } from "./ChangeSourceDialog";`:

```tsx
import { MarkDoneDialog, type MarkDoneResult } from "./MarkDoneDialog";
```

Ubah signature `SpecActions` (baris 518–522) menjadi:

```tsx
function SpecActions({ spec, onStart, onDelete, onOpenRun, onOpenReview, onMarkDone, running }:
  {
    spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void;
    // SPEC-804 · ADR-0120 · tandai selesai manual. Dua langkahnya ditangani MarkDoneDialog.
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    running?: boolean
  }) {
  const [docs, setDocs] = React.useState(false);
  const [markDone, setMarkDone] = React.useState(false);
```

Sisipkan tepat sebelum baris `<IconButton size="sm" variant="ghost" icon="file-text" …>`:

```tsx
      {spec.stage !== "done" && onMarkDone && (
        <IconButton size="sm" variant="ghost" icon="circle-check" label="Tandai selesai"
          onClick={() => setMarkDone(true)} />
      )}
```

Sisipkan tepat sebelum `{docs && <SpecDocsModal …>}`:

```tsx
      {markDone && onMarkDone && (
        <MarkDoneDialog spec={spec} onClose={() => setMarkDone(false)} onSubmit={onMarkDone} />
      )}
```

- [ ] **Step 6: Teruskan prop dari `SpecCard`, `SpecRow`, `BoardCard`, dan `BacklogScreen`**

Untuk masing-masing dari `SpecCard` (baris ~561) dan `SpecRow` (baris ~598): tambahkan `onMarkDone` ke daftar destructuring, tambahkan ke tipe props baris berikutnya:

```tsx
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
```

dan teruskan ke `<SpecActions … onMarkDone={onMarkDone} … />`.

Untuk `BoardCard` (baris ~663) lakukan hal yang sama dan teruskan ke `<SpecActions>` di baris ~700.

Pada `BacklogScreen` (baris 776): tambahkan `onMarkDone` ke destructuring props dan tipenya:

```tsx
    // SPEC-804 · ADR-0120 · tandai selesai manual; `needConfirm` = server minta konfirmasi karena
    // ada sesi hidup.
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
```

Lalu teruskan `onMarkDone={onMarkDone}` ke setiap `<SpecCard>`, `<SpecRow>`, dan `<BoardCard>` yang dirender (cari `<SpecCard`, `<SpecRow`, `<BoardCard` di berkas itu), dan ke `<SpecDetail>` (baris 962–967).

- [ ] **Step 7: Pasang aksi & jejak di `SpecDetail`**

Tambahkan `onMarkDone` ke destructuring `SpecDetail` (baris 110) dan ke tipe props-nya (dekat `onRevertStage`, baris 113):

```tsx
    // SPEC-804 · ADR-0120 · maju ke `done` tanpa sesi. Bersebelahan dengan revert: satu blok,
    // dua arah.
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
```

Tambahkan state di dekat `const [stageTarget, setStageTarget] = React.useState("");`:

```tsx
  const [markDone, setMarkDone] = React.useState(false);
```

Di dalam blok `{onRevertStage && (…)}`, sisipkan tepat sesudah baris `{`Status saat ini: ${currentStageLabel}`}` `</div>`:

```tsx
            {spec.stage !== "done" && onMarkDone && (
              <div style={{ marginBottom: 10 }}>
                <Button size="sm" variant="secondary" leftIcon="circle-check"
                  onClick={() => setMarkDone(true)}>Tandai selesai</Button>
              </div>
            )}
```

Sisipkan blok jejak tepat sebelum blok `{(spec.sourceHistory ?? []).length > 0 && (` (baris ~356):

```tsx
      {/* SPEC-804 · ADR-0120 · jejak penandaan manual. Hanya muncul bila item memang ditandai
          manusia — item yang selesai lewat sesi tak punya barisnya. */}
      {spec.manualDone && (
        <div style={{ marginBottom: 14 }} data-testid="manual-done-trail">
          <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Ditandai selesai manual</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {spec.manualDone.by} · {new Date(spec.manualDone.at).toLocaleString("id-ID")}
            {spec.manualDone.reason ? <div style={{ marginTop: 4 }}>{spec.manualDone.reason}</div> : null}
          </div>
        </div>
      )}
```

Sisipkan dialognya tepat sebelum `{showSource && onChangeSource && (` (baris ~505):

```tsx
      {markDone && onMarkDone && (
        <MarkDoneDialog spec={spec} onClose={() => setMarkDone(false)} onSubmit={onMarkDone} />
      )}
```

- [ ] **Step 8: Jalankan test frontend — harus lulus**

Run: `pnpm vitest --run src/test/backlog-mark-done.test.tsx`
Expected: PASS (4 test).

- [ ] **Step 9: Sambungkan handler di `src/src/App.tsx`**

Sisipkan tepat sesudah fungsi `revertStage` (berakhir di baris ~1108):

```tsx
  // SPEC-804 · ADR-0120 · tandai item selesai manual. 409 `confirm-required` bukan kegagalan:
  // server memberi tahu ada sesi hidup, dan dialog mengirim ulang dengan `confirm: true`.
  async function markSpecDone(spec: Spec, reason: string, confirm: boolean) {
    try {
      const updated = await api.markSpecDone(spec.id, { reason: reason || undefined, confirm });
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " ditandai selesai", "ok", "circle-check");
      return updated;
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { error?: string; session?: { id?: string } } | null) : null;
      if (detail?.error === "confirm-required")
        return { needConfirm: true as const, sessionId: detail.session?.id };
      showToast(detail?.error === "backlog item sudah selesai"
        ? spec.id + " sudah selesai" : "Gagal menandai selesai " + spec.id, "warn", "x-circle");
      return undefined;
    }
  }
```

Cari `<BacklogScreen` di `App.tsx` dan tambahkan prop `onMarkDone={markSpecDone}` di sebelah `onRevertStage={revertStage}`.

- [ ] **Step 10: Jalankan test frontend yang tersentuh + typecheck**

Run:
```bash
pnpm vitest --run src/test/backlog-mark-done.test.tsx src/test/revert-stage.test.tsx \
  src/test/change-source.test.tsx src/test/backlog-board.test.tsx src/test/app-flows.test.tsx \
  src/test/api-client.test.ts
pnpm --filter ./src typecheck
```
Expected: semua PASS, typecheck keluar 0.

- [ ] **Step 11: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/src/screens/MarkDoneDialog.tsx \
  src/src/screens/BacklogScreen.tsx src/src/App.tsx src/test/backlog-mark-done.test.tsx
git commit -m "feat(spec-804): aksi Tandai selesai di daftar & detail backlog"
```

---

### Task 6: Docs Source of Truth + ADR-0120

**Files:**
- Create: `internal/docs/adr/0120-tandai-backlog-selesai-manual.md`
- Modify: `internal/docs/README.md` (daftar adr, satu baris di atas `0119`)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/docs/architecture/api-contract.md` (bagian `## Backlog / specs`)
- Modify: `internal/docs/architecture/data-model.md` (model `Spec`)
- Modify: `internal/skills/hanoman/SKILL.md` (Aturan Arsitektur)
- Modify: `docs/agent-integration.md` (endpoint tersering)
- Test: `server/test/agent-doc-contract.test.ts` (jalankan; jangan diubah kecuali merah)

- [ ] **Step 1: Tulis ADR-0120**

Create `internal/docs/adr/0120-tandai-backlog-selesai-manual.md` dengan struktur yang sama seperti `internal/docs/adr/0109-ubah-source-backlog-item.md` (baca dulu untuk menyalin bentuk heading & nada). Isi wajib:

- **Status**: Diterima · 2026-08-15 · SPEC-804.
- **Konteks**: stage hanya turunan sesi; `PATCH {stage}` backward-only (SPEC-167); item yang beres di luar sesi menggantung dan terus diantrekan checker `UNSTARTED_SPEC_WHERE` (SPEC-431); satu-satunya jalan keluar hari ini = hapus, yang membuang id/riwayat/`dependsOn`.
- **Keputusan** (tujuh butir): operasi khusus `POST /specs/:id/done` (preseden ADR-0064/0109, `PATCH` tetap backward-only); satu kolom `Json?` `manualDone` bukan tiga skalar; `doneAt` ADR-0105 tak berubah maknanya; satu titik cekik `completeSpecManually`; CAS `stage != done`; gerbang konfirmasi dua langkah untuk sesi hidup (cermin ADR-0088), tanpa membunuh sesi; auto-merge ADR-0103 melewati penyelesaian manual.
- **Gotcha wajib** (minimal lima, tulis apa adanya):
  1. `manualDone` wajib di `FIELDS.spec` **dan** `JSON_FIELDS` — `upsert` yang tak menyebut kolom TETAP berhasil (kelas ADR-0090/0093/0094/0105); **bukan** `DATE_FIELDS`.
  2. Kandidat sweep auto-merge adalah notifikasi `done:` yang kini juga ditulis jalur manual → tanpa gerbang, item ber-branch sesi lama yang ditinggalkan **di-merge setengah jadi**.
  3. Durabilitas terhadap overlay stage-live **bukan** properti kode baru melainkan konsekuensi guard forward-only `liveSpecs`; ia dikunci test, bukan diasumsikan.
  4. Gerbang sesi hidup membaca `specId` pane (`listSessions`), bukan `getSession(sessionIdForSpec(id))` — id deterministik menjawab pertanyaan yang berbeda.
  5. `manualDone` **ditimpa**, bukan array — riwayat transisi stage sudah punya rumah (`SessionResult`, ADR-0047); dan revert stage sengaja **tidak** mengosongkannya (cermin `doneAt`).
- **Alternatif ditolak**: melonggarkan `PATCH {stage}` jadi dua arah (meruntuhkan ADR-0008 + ketiga guard CAS); tiga kolom skalar (bisa drift); menyimpan alasan hanya di `SessionResult` (whitelist ADR-0047 tak punya field alasan, dan UI butuh join); tool MCP (ADR-0099 sengaja meniadakan tool yang memindahkan stage).
- **Konsekuensi**: tabel dampak dari design doc (`startable`, checker scheduler, denyut lead, gerbang `dependsOn`, sweep auto-merge, notifikasi, sync, webhook, changelog, revert).

- [ ] **Step 2: Tautkan ADR di index**

Di `internal/docs/README.md`, pada bagian `## adr`, sisipkan tepat di atas baris `- [0119 — Tombstone sync…`:

```markdown
- [0120 — Tandai backlog selesai manual: operasi khusus `POST /specs/:id/done`, jejak `Spec.manualDone`](adr/0120-tandai-backlog-selesai-manual.md)
```

- [ ] **Step 3: Tambahkan narasi di `internal/docs/adr/README.md`**

Baca entri ADR-0119 di berkas itu untuk menyalin bentuknya, lalu tambahkan entri ADR-0120 di posisi yang sama relatifnya (paling atas / paling bawah, ikuti urutan yang berlaku di berkas). Sebutkan: apa yang **ditegakkan** (ADR-0008 stage forward-only, ADR-0105 `doneAt` write-once, ADR-0047 activity log, ADR-0099 batas permukaan MCP), apa yang **diamandemen** (ADR-0103 — kandidat sweep kini disaring `manualDone`), dan kelima gotcha.

- [ ] **Step 4: Perbarui `internal/docs/architecture/api-contract.md`**

Pada bagian `## Backlog / specs`, sisipkan tepat sesudah blok `POST /specs/:id/source …` (baris ~226–234):

```
POST /specs/:id/done      { reason?: string(≤280), confirm?: boolean }   -> Spec        (SPEC-804 · ADR-0120)
#   Tandai item selesai MANUAL — untuk pekerjaan yang beres DI LUAR sesi. Operasi khusus, bukan
#   field PATCH: `stage` di PATCH backward-only by construction (SPEC-167) dan melonggarkannya
#   meruntuhkan premis "kemajuan hanya berasal dari fase sesi" (ADR-0008).
#   409 { error:"backlog item sudah selesai" } · 409 { error:"confirm-required", session:{id,agent} }
#     saat ada sesi tmux HIDUP untuk item ini; kirim ulang dengan confirm:true. Sesinya tidak dibunuh.
#   Efeknya identik dengan selesai lewat sesi: stage `done`, `doneAt` terstempel (recordCompletion),
#   notifikasi `done:<specId>`, SessionResult ber-author, notifySynced, webhook spec.stage_changed.
#   Jejaknya di kolom `Spec.manualDone` = { at, by, reason? }. Sweep auto-merge (ADR-0103) MELEWATI
#   item ber-manualDone — "beres di luar sesi" berarti tak ada yang perlu di-merge.
```

Perbarui juga baris 15 (daftar tindakan berbahaya bagi agen) supaya tak basi: `PATCH /specs/:id {stage}` tetap disebut, tambahkan catatan bahwa `POST /specs/:id/done` **ada** dan berdomain `backlog:write`.

- [ ] **Step 5: Perbarui `internal/docs/architecture/data-model.md`**

Cari bagian model `Spec` (grep `doneAt` di berkas itu) dan tambahkan baris kolom baru mengikuti format yang berlaku di sana:

```
manualDone Json?   — SPEC-804 · ADR-0120 · jejak penandaan selesai MANUAL { at, by, reason? }.
                     null = selesai lewat sesi / belum selesai. Ditimpa tiap penandaan berikutnya
                     (riwayat transisi tinggal di SessionResult). Ikut FIELDS.spec + JSON_FIELDS
                     sync, BUKAN DATE_FIELDS. Dibaca gerbang sweep auto-merge ADR-0103.
```

- [ ] **Step 6: Perbarui `internal/skills/hanoman/SKILL.md`**

Di bagian `## Aturan Arsitektur`, tambahkan satu butir baru (letakkan sesudah butir "Stempel waktu backlog (SPEC-408/ADR-0090)"):

```markdown
- **Backlog bisa ditandai selesai MANUAL** (SPEC-804/**ADR-0120**; ADR-0008 & ADR-0105 & ADR-0047
  ditegakkan, ADR-0103 diamandemen): `POST /specs/:id/done` `{reason?, confirm?}` memajukan satu item
  ke `done` tanpa sesi — untuk pekerjaan yang beres DI LUAR sesi. **Operasi khusus**, bukan field
  `PATCH /specs/:id`: `stage` di sana **backward-only by construction** (SPEC-167) dan melonggarkannya
  meruntuhkan premis "kemajuan hanya berasal dari fase sesi" yang menopang ketiga guard CAS persist
  stage. Jejaknya **satu** kolom `Spec.manualDone Json?` = `{at, by, reason?}` — bukan tiga skalar
  yang bisa drift — dan `doneAt` (ADR-0105) **tak berubah maknanya** (tetap "selesai pertama", tetap
  ditulis hanya di dalam `recordCompletion`). Eksekusinya satu titik cekik `completeSpecManually()`
  (CAS `stage != done` → `recordCompletion` → `recordSessionResult` → `notifySynced`), jadi efek
  penyelesaian tak pernah disalin ke call site (kelas SPEC-431/448/475). **Lima gotcha:** (1)
  `manualDone` wajib di `FIELDS.spec` **dan** `JSON_FIELDS`, **bukan** `DATE_FIELDS` (`at` di dalam
  JSON) — kolom terlewat mendarat sebagai null palsu tanpa satu pun error; (2) kandidat sweep
  auto-merge = notifikasi `done:` yang kini juga ditulis jalur manual, jadi `settleOne` **melewati**
  item ber-`manualDone` — tanpa itu item ber-branch sesi lama yang ditinggalkan **di-merge setengah
  jadi**; (3) durabilitas terhadap overlay stage-live adalah konsekuensi guard forward-only
  `liveSpecs`, **dikunci test**, bukan diasumsikan; (4) gerbang "sesi hidup" membaca `specId` pane
  lewat `listSessions()`, bukan `getSession(sessionIdForSpec(id))`; (5) `manualDone` **ditimpa** tiap
  penandaan dan revert stage sengaja **tidak** mengosongkannya (cermin `doneAt`). Konfirmasi dua
  langkah (`409 confirm-required` + `session`) cermin ADR-0088, dan sesinya **tidak** dibunuh. Tool
  MCP sengaja **tak** ditambahkan — ADR-0099 meniadakan tool yang memindahkan stage.
```

- [ ] **Step 7: Perbarui `docs/agent-integration.md`**

Cari bagian daftar endpoint tersering (grep `POST /specs` di berkas itu) dan tambahkan baris untuk endpoint baru, memakai nada & format yang sudah ada di sana. Sebutkan: butuh `backlog:write`; body `{reason?, confirm?}`; 409 `confirm-required` berikut arti dan cara meneruskannya; dan bahwa ia **tidak** menjalankan atau menghentikan sesi apa pun.

- [ ] **Step 8: Jalankan test kontrak docs**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/agent-doc-contract.test.ts server/test/agent-doc.route.test.ts
pnpm hanoman docs index --check || node cli/dist/cli.js docs index --check || true
```
Expected: test PASS. Bila `docs index --check` melaporkan doc tak ter-link, tautkan di `internal/docs/README.md`.

- [ ] **Step 9: Commit**

```bash
git add internal/docs/adr/0120-tandai-backlog-selesai-manual.md internal/docs/README.md \
  internal/docs/adr/README.md internal/docs/architecture/api-contract.md \
  internal/docs/architecture/data-model.md internal/skills/hanoman/SKILL.md \
  docs/agent-integration.md
git commit -m "docs(spec-804): ADR-0120 + api-contract, data-model, SKILL, panduan agen"
```

---

### Task 7: Verifikasi akhir — test yang tersentuh + smoke endpoint nyata

**Files:** —

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan (server)**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  --changed "$HANOMAN_BASE_SHA"
```
Expected: semua PASS. Pastikan jumlah berkas test yang berjalan **> 0** — `--changed` menyalakan `passWithNoTests`, jadi nol test terlihat hijau.

- [ ] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck`
Expected: ketiganya keluar 0.

- [ ] **Step 3: Smoke endpoint nyata (task ini menyentuh endpoint)**

Boot server di DB khusus lalu curl endpoint baru:

```bash
export HANOMAN_HOME="$(mktemp -d)"
pnpm --filter ./server exec prisma migrate deploy
node server/dist/server.js &   # atau `pnpm dev`; catat PID-nya
```

Lalu, dengan project + spec contoh yang dibuat lewat API:
```bash
curl -s -X POST localhost:3000/api/specs/SPEC-1/done -H 'content-type: application/json' -d '{"reason":"smoke"}'
curl -s 'localhost:3000/api/specs?startable=true' | head -c 400
```
Expected: respons pertama `"stage":"done"` + `"manualDone":{…"reason":"smoke"}`; respons kedua tidak memuat `SPEC-1`.

Matikan server **per-PID** (`kill <pid>`), jangan `pkill -f`.

- [ ] **Step 4: Pastikan diff bersih & seluruh kotak plan tercentang**

Run: `git status --porcelain && rtk proxy grep -n "^- \[ \]" docs/superpowers/plans/2026-08-15-spec-804-tandai-backlog-selesai-manual.md`
Expected: `git status` bersih; grep tak menghasilkan baris apa pun.

- [ ] **Step 5: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-804
```
