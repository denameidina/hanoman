# SPEC-516 — Changelog ringkas per project · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangkitkan changelog naratif berorientasi user per project lewat tiga mode (rentang tanggal backlog, rentang SHA, versi/tag), tampil di dashboard, bisa disalin & diunduh `.md`, dan tersedia lewat REST API untuk agen.

**Architecture:** Pengumpulan data **deterministik** (Prisma untuk backlog, `git log`/`git tag` untuk commit & versi) → **scrub** teknis pada input → satu panggilan agen one-shot lewat `think()` yang **diimpor** dari `services/lead/brain.ts` → scrub lagi pada output → simpan sebagai baris `Changelog` (LOCAL-only). Agen gagal tak melempar: baris tetap lahir dengan draf deterministik + `warning`.

**Tech Stack:** TypeScript strict · Fastify · Prisma 6 / SQLite · zod (`@hanoman/shared`) · vitest · React 18 + Vite

**Spec:** [`docs/superpowers/specs/2026-08-03-spec-516-changelog-per-project-design.md`](../specs/2026-08-03-spec-516-changelog-per-project-design.md)

## Global Constraints

- **Bahasa Indonesia** untuk seluruh prosa: komentar kode, pesan galat, teks UI, dan isi changelog. Kode & identifier tetap Inggris.
- **Non-teknikal di badan changelog:** tanpa nama berkas, nama fungsi, hash commit, atau istilah internal (`SPEC-nnn`/`ADR-nnnn`).
- **Tanpa dependensi npm baru.** Semua dari yang sudah ada.
- **Migration ditulis tangan**, bukan `prisma migrate dev` — worktree tetangga membuat `migrate dev` me-reset DB saat ada drift. Aditif murni.
- **`think()` diimpor, tidak disalin.** Titik spawn agen ketiga akan mengulang SPEC-448.
- **Scope verifikasi = yang berubah.** Setiap `git commit` diikuti test yang tersentuh saja, bukan suite penuh.
- **Perintah test server WAJIB** memakai isolasi DB dan serial:
  ```bash
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path...>
  ```
- **Test web WAJIB** `env -u NODE_ENV` (env sesi bisa `NODE_ENV=production` → RTL `act` gagal massal).
- **Docs yang tersentuh diperbarui dalam commit yang sama** dan ditaut di `internal/docs/README.md`.

## File Structure

**Dibuat:**

| Berkas | Tanggung jawab |
| --- | --- |
| `shared/src/changelog.ts` | Kontrak bersama: mode, zod request, DTO view, `defaultRange` |
| `server/src/services/changelog/scrub.ts` | **Murni.** Buang jejak teknis dari teks |
| `server/src/services/changelog/render.ts` | **Murni.** Draf deterministik + prompt agen |
| `server/src/services/changelog/collect.ts` | Kumpulkan bahan per mode (Prisma + git) |
| `server/src/services/changelog/generate.ts` | Orkestrasi: collect → prompt → agen → simpan |
| `server/src/routes/changelog.ts` | Lima endpoint di bawah `/projects/:id/changelog` |
| `src/src/screens/ChangelogPanel.tsx` | Panel dashboard di detail project |
| `internal/docs/adr/0105-changelog-per-project.md` | ADR |

**Diubah:** `server/prisma/schema.prisma` · `server/src/services/notifications.ts` · `server/src/services/sync.ts` · `server/src/services/agent-capabilities.ts` · `server/src/app.ts` · `shared/src/index.ts` · `shared/src/api.ts` · `src/src/api/client.ts` · `src/src/screens/ProjectDetailScreen.tsx` · `cli/src/commands/migrate-pg.ts` · `server/test/factory.ts` · docs.

---

### Task 1: `Spec.doneAt` — stempel selesai berkolom, satu penulis

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Spec`)
- Create: `server/prisma/migrations/20260803000000_spec_done_at/migration.sql`
- Modify: `server/src/services/notifications.ts` (`recordCompletion`)
- Modify: `server/src/services/sync.ts:44` (`FIELDS.spec`) dan `server/src/services/sync.ts:68` (`DATE_FIELDS.spec`)
- Test: `server/test/spec-done-at.test.ts`

**Interfaces:**
- Consumes: —
- Produces: kolom `Spec.doneAt: Date | null`; `recordCompletion(specId, title, projectId)` (tanda tangan **tidak berubah**) kini juga menstempel `doneAt` sekali.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/spec-done-at.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { recordCompletion } from "../src/services/notifications";
import { __FIELDS, __DATE_FIELDS } from "../src/services/sync";
import { resetDb, makeProject, makeSpec } from "./factory";

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
});

describe("Spec.doneAt (SPEC-516 · ADR-0105)", () => {
  it("recordCompletion menstempel doneAt", async () => {
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done" });
    const before = Date.now();
    await recordCompletion("SPEC-1", "judul", "p1");
    const s = await prisma.spec.findUnique({ where: { id: "SPEC-1" } });
    expect(s!.doneAt).toBeInstanceOf(Date);
    expect(s!.doneAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("panggilan kedua TIDAK memindahkan stempel (selesai PERTAMA, cermin startedAt)", async () => {
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "done" });
    await recordCompletion("SPEC-2", "judul", "p1");
    const first = (await prisma.spec.findUnique({ where: { id: "SPEC-2" } }))!.doneAt!;
    await new Promise((r) => setTimeout(r, 20));
    await recordCompletion("SPEC-2", "judul", "p1");
    const again = (await prisma.spec.findUnique({ where: { id: "SPEC-2" } }))!.doneAt!;
    expect(again.getTime()).toBe(first.getTime());
  });

  it("spec yang sudah dihapus tak membuat recordCompletion melempar", async () => {
    await expect(recordCompletion("SPEC-HILANG", "judul", "p1")).resolves.toBeUndefined();
  });

  // Kelas gagal-senyap ADR-0090/0093/0094: `upsert` yang tak menyebut sebuah kolom TETAP
  // berhasil, jadi kolom yang lupa didaftarkan mendarat sebagai null palsu di tiap client.
  it("doneAt ikut menyeberang sync (FIELDS + DATE_FIELDS)", () => {
    expect(__FIELDS.spec).toContain("doneAt");
    expect(__DATE_FIELDS.spec).toContain("doneAt");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-done-at.test.ts
```

Diharapkan: GAGAL — `doneAt` tak ada di tipe/tabel.

- [ ] **Step 3: Tambahkan kolom di skema**

Di `server/prisma/schema.prisma`, model `Spec`, tepat sesudah blok `startedAt`:

```prisma
  // SPEC-516 · ADR-0105 · kapan item PERTAMA kali masuk stage `done`. Ditulis HANYA di dalam
  // `recordCompletion()` — satu-satunya fungsi yang sudah dipanggil oleh KETIGA jalur persist
  // `done` (advanceStage, scheduler/reconcile, live-specs). Menyalin bookkeeping ini ke call
  // site adalah kelas bug SPEC-431/448/475. Tulis-sekali: reopen lalu selesai lagi tak
  // memindahkannya, cermin `startedAt` = mulai pertama (ADR-0090).
  doneAt     DateTime?
```

- [ ] **Step 4: Tulis migration**

Buat `server/prisma/migrations/20260803000000_spec_done_at/migration.sql`:

```sql
-- SPEC-516 · ADR-0105 · stempel selesai backlog sebagai kolom.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu kolom NULLABLE tanpa default, tak ada tabel diredefinisi.
-- Larangan SQLite atas `ADD COLUMN … DEFAULT <non-konstan>` (lihat migration SPEC-408) tak
-- berlaku karena tak ada default sama sekali.
ALTER TABLE "Spec" ADD COLUMN "doneAt" DATETIME;

-- Backfill sekali-jalan dari stempel yang SUDAH ada: `Notification` ber-key `done:<specId>`
-- ditulis `recordCompletion` tepat pada transisi ke `done` sejak SPEC-180, di ketiga jalur
-- persist (dasar yang sama dipakai sweep auto-merge ADR-0103). Item yang selesai sebelum
-- SPEC-180 — atau yang notifikasinya dihapus operator — tetap NULL; itu keadaan sah yang
-- dilaporkan sebagai catatan di hasil changelog, bukan disamarkan.
UPDATE "Spec" SET "doneAt" = (
  SELECT n."createdAt" FROM "Notification" n WHERE n."key" = 'done:' || "Spec"."id"
) WHERE "doneAt" IS NULL;
```

- [ ] **Step 5: Terapkan migration + regenerate client**

```bash
cd server && pnpm prisma generate && pnpm prisma migrate deploy && cd ..
```

Diharapkan: `generate` sukses; `migrate deploy` melaporkan 1 migration diterapkan (atau "No pending migrations" bila DB dev-mu sudah terisi — DB test dimigrasi ulang otomatis oleh `global-setup.ts`).

- [ ] **Step 6: Tulis `doneAt` di dalam `recordCompletion`**

Di `server/src/services/notifications.ts`, ganti badan `recordCompletion` (baris 24–32) menjadi:

```ts
export async function recordCompletion(specId: string, title: string, projectId: string | null): Promise<void> {
  // SPEC-516 · ADR-0105 · stempel selesai. Ditulis DI SINI, bukan di ketiga call site yang
  // mempersist `stage = "done"` (advanceStage · scheduler/reconcile · live-specs): efek samping
  // yang disalin ke banyak call site adalah kelas bug yang sudah menggigit repo ini tiga kali
  // (SPEC-431 `baseSha`, SPEC-448 `rootBypassEnv`, SPEC-475 `headSha`), dan efek samping tak
  // punya tipe yang memaksanya konsisten. `updateMany` ber-guard `doneAt: null` membuatnya
  // TULIS-SEKALI sekaligus tak melempar bila spec-nya sudah dihapus operator.
  await prisma.spec.updateMany({ where: { id: specId, doneAt: null }, data: { doneAt: new Date() } })
    .catch(() => { /* spec bisa saja sudah dihapus */ });
  // SPEC-184 · dedup pindah ke `key` (specId tak lagi @unique — kini menampung juga notif decision).
  // sessionId turunan = idFor(specId) (pty.ts): id sesi tmux backlog dapat ditebak dari spec-nya,
  // jadi aksi "Buka" pada notif bisa mengecek apakah sesinya masih hidup.
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: { type: "done", key: `done:${specId}`, specId, sessionId, title, projectId },
  }).catch(() => { /* P2002: sudah ada */ });
}
```

- [ ] **Step 7: Daftarkan `doneAt` di sync**

Di `server/src/services/sync.ts` baris 44, tambahkan `"doneAt"` sesudah `"startedAt"`:

```ts
  spec: ["projectId", "title", "source", "stage", "priority", "author", "objective", "payload", "branchFrom", "baseSha", "headSha", "dependsOn", "createdAt", "startedAt", "doneAt", "updatedAt"],
```

Di baris 68, tambahkan `"doneAt"` ke `DATE_FIELDS.spec`:

```ts
  project: ["updatedAt"], spec: ["createdAt", "startedAt", "doneAt", "updatedAt"], vps: ["lastSeenAt", "lastAuditAt", "updatedAt"],
```

Tambahkan satu baris komentar di atas blok `spec:` dalam `FIELDS`:

```ts
  // SPEC-516 · ADR-0105 · doneAt ikut menyeberang — cermin createdAt/startedAt. Tanpa ini spec
  // asal-hub mendarat di tiap client dengan doneAt null tanpa satu pun error, dan changelog
  // mode backlog di client itu selamanya kosong.
```

- [ ] **Step 8: Jalankan test — pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-done-at.test.ts
```

Diharapkan: 4 test lulus.

- [ ] **Step 9: Test tetangga yang menyentuh sync spec masih hijau**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync.service.test.ts server/test/sync-exclusions.test.ts server/test/sync-hub-origin-writes.test.ts server/test/spec-deps.test.ts
```

Diharapkan: semua lulus.

- [ ] **Step 10: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260803000000_spec_done_at \
        server/src/services/notifications.ts server/src/services/sync.ts server/test/spec-done-at.test.ts
git commit -m "feat(spec-516): Spec.doneAt sebagai stempel selesai, ditulis di recordCompletion"
```

---

### Task 2: Model `Changelog` — LOCAL-only

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Project` + model baru `Changelog`)
- Create: `server/prisma/migrations/20260803001000_changelog/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts:16` (`PG_ORDER`)
- Modify: `server/test/factory.ts` (`resetDb`)
- Test: `server/test/changelog-schema.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `prisma.changelog` dengan kolom `id, projectId, mode, title, params, body, generator, warning, itemCount, createdAt, updatedAt`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/changelog-schema.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";
import { resetDb, makeProject } from "./factory";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

describe("model Changelog (SPEC-516 · ADR-0105)", () => {
  it("TAK punya kolom `version` — LOCAL-only, tak pernah masuk changefeed sync", () => {
    const cols = models.get("Changelog")!.fields.map((f) => f.name);
    expect(cols).not.toContain("version");
  });

  it("PG_ORDER memuat Changelog sesudah Project (FK projectId)", () => {
    expect(PG_ORDER).toContain("Changelog");
    expect(PG_ORDER.indexOf("Changelog")).toBeGreaterThan(PG_ORDER.indexOf("Project"));
  });

  it("baris ikut terhapus saat project-nya dihapus (cascade)", async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await prisma.changelog.create({ data: {
      projectId: "p1", mode: "backlog", title: "Juli", params: {} as Prisma.InputJsonValue,
      body: "# Juli", generator: "fallback", itemCount: 1 } });
    await prisma.project.delete({ where: { id: "p1" } });
    expect(await prisma.changelog.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-schema.test.ts
```

Diharapkan: GAGAL — `prisma.changelog` undefined / model tak ada di DMMF.

- [ ] **Step 3: Tambahkan model di skema**

Di `server/prisma/schema.prisma`, tambahkan relasi ke model `Project` (sesudah baris `githubIssues GithubIssue[]`):

```prisma
  changelogs   Changelog[]   // SPEC-516 · ADR-0105 · changelog tersimpan project ini
```

Lalu tambahkan model baru tepat sesudah blok `model Spec { … }`:

```prisma
// SPEC-516 · ADR-0105 · changelog naratif per project yang sudah dibangkitkan.
//
// LOCAL-only: TANPA kolom `version`, jadi ia tak pernah masuk changefeed sync (cermin LeadFlow,
// WebhookEndpoint, dan Project.autoMerge). Dua dari tiga modenya diturunkan dari checkout git di
// MESIN INI, jadi barisnya fakta lokal; yang portabel adalah keluarannya, dan jalannya sudah ada
// — unduh .md.
model Changelog {
  id         String   @id @default(cuid())
  projectId  String
  mode       String   // "backlog" | "commit" | "version" (zChangelogMode di @hanoman/shared)
  title      String   // judul di daftar: rentang tanggal / nama tag / rentang tag
  params     Json     // parameter pembangkitan apa adanya (zChangelogRequest)
  body       String   // markdown hasil akhir, sudah lewat scrubOutput
  generator  String   // "agent" | "fallback"
  warning    String?  // alasan fallback + catatan cakupan; null = mulus
  itemCount  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
}
```

- [ ] **Step 4: Tulis migration**

Buat `server/prisma/migrations/20260803001000_changelog/migration.sql`:

```sql
-- SPEC-516 · ADR-0105 · changelog naratif per project.
--
-- Ditulis tangan (bukan `migrate dev`). ADITIF murni — satu tabel baru, nol tabel diredefinisi,
-- nol baris disentuh. TANPA kolom `version`: tabel ini LOCAL-only dan tak pernah masuk
-- changefeed sync, persis alasan `LeadFlow` & `WebhookEndpoint`.
CREATE TABLE "Changelog" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "mode"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "params"    JSONB NOT NULL,
    "body"      TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "warning"   TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Changelog_projectId_fkey" FOREIGN KEY ("projectId")
      REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Changelog_projectId_createdAt_idx" ON "Changelog"("projectId", "createdAt");
```

- [ ] **Step 5: Daftarkan di `PG_ORDER`**

Di `cli/src/commands/migrate-pg.ts`, ubah baris 18 dari:

```ts
  "Project", "Spec", "CustomAgent", "Setting", "Notification",
```

menjadi:

```ts
  "Project", "Spec", "CustomAgent", "Setting", "Notification",
  // SPEC-516 · ADR-0105 · Changelog sesudah Project (FK projectId). Tabel ini LOCAL-only dan
  // lazimnya TIDAK ada di sumber Postgres lama — jalur 42P01 memperlakukannya sebagai nol baris.
  "Changelog",
```

- [ ] **Step 6: Bersihkan tabel di `resetDb`**

Di `server/test/factory.ts`, dalam `resetDb()`, tambahkan `prisma.changelog.deleteMany(),` sebagai entri **pertama** di dalam `$transaction([...])` (sebelum `prisma.notification.deleteMany()`) — cascade lewat project sudah mengurusnya, tapi urutan eksplisit membuat test yang tak menyentuh project tetap bersih:

```ts
  await prisma.$transaction([
    prisma.changelog.deleteMany(),   // SPEC-516 · ADR-0105
    prisma.notification.deleteMany(),
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
    prisma.vps.deleteMany(),
  ]);
```

- [ ] **Step 7: Regenerate + migrate, jalankan test**

```bash
cd server && pnpm prisma generate && pnpm prisma migrate deploy && cd ..
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-schema.test.ts
```

Diharapkan: 3 test lulus.

- [ ] **Step 8: Test katalog yang menuntut kelengkapan model**

```bash
pnpm vitest --run cli/test/migrate-pg.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/webhook-catalog-dmmf.test.ts
```

Diharapkan: keduanya lulus. (`cli/test/migrate-pg.test.ts` menuntut `PG_ORDER` **sama persis** dengan daftar model DMMF — inilah gerbang yang menangkap model baru yang lupa didaftarkan.)

- [ ] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260803001000_changelog \
        cli/src/commands/migrate-pg.ts server/test/factory.ts server/test/changelog-schema.test.ts
git commit -m "feat(spec-516): model Changelog LOCAL-only + entri PG_ORDER"
```

---

### Task 3: Kontrak bersama `shared/src/changelog.ts`

**Files:**
- Create: `shared/src/changelog.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/changelog.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `CHANGELOG_MODES`, `zChangelogMode`, `ChangelogMode = "backlog" | "commit" | "version"`
  - `zChangelogRequest`, `ChangelogRequest`
  - `zChangelogView`, `ChangelogView`
  - `ChangelogSources`
  - `DEFAULT_RANGE_DAYS = 30`, `defaultRange(today: Date): { from: string; to: string }`, `dayString(d: Date): string`

- [ ] **Step 1: Tulis test yang gagal**

Buat `shared/src/changelog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zChangelogRequest, defaultRange, dayString, DEFAULT_RANGE_DAYS } from "./changelog";

describe("zChangelogRequest", () => {
  it("mode backlog boleh tanpa rentang (server mengisi default)", () => {
    expect(zChangelogRequest.safeParse({ mode: "backlog" }).success).toBe(true);
  });

  it("menolak from > to", () => {
    const r = zChangelogRequest.safeParse({ mode: "backlog", from: "2026-08-02", to: "2026-08-01" });
    expect(r.success).toBe(false);
  });

  it("menerima from == to (rentang satu hari, inklusif)", () => {
    expect(zChangelogRequest.safeParse({ mode: "backlog", from: "2026-08-01", to: "2026-08-01" }).success).toBe(true);
  });

  it("menolak tanggal yang bukan YYYY-MM-DD", () => {
    expect(zChangelogRequest.safeParse({ mode: "backlog", from: "01/08/2026" }).success).toBe(false);
  });

  it("mode commit menuntut dua revisi", () => {
    expect(zChangelogRequest.safeParse({ mode: "commit", fromSha: "abc1234", toSha: "def5678" }).success).toBe(true);
    expect(zChangelogRequest.safeParse({ mode: "commit", fromSha: "abc1234" }).success).toBe(false);
  });

  it("mode version menuntut toTag; fromTag opsional", () => {
    expect(zChangelogRequest.safeParse({ mode: "version", toTag: "v1.2.0" }).success).toBe(true);
    expect(zChangelogRequest.safeParse({ mode: "version", fromTag: "v1.1.0", toTag: "v1.2.0" }).success).toBe(true);
    expect(zChangelogRequest.safeParse({ mode: "version", fromTag: "v1.1.0" }).success).toBe(false);
  });

  it("mode tak dikenal ditolak", () => {
    expect(zChangelogRequest.safeParse({ mode: "sihir" }).success).toBe(false);
  });
});

describe("defaultRange", () => {
  // Tanggal LOKAL, bukan UTC: `new Date("2026-07-31")` adalah tengah malam UTC dan sebagai
  // batas `to` ia membuang hampir seluruh hari itu di WIB (pelajaran ADR-0090).
  it("30 hari terakhir, inklusif di kedua ujung", () => {
    const r = defaultRange(new Date(2026, 7, 3));   // 3 Agustus 2026 lokal
    expect(r.to).toBe("2026-08-03");
    expect(r.from).toBe("2026-07-05");              // 3 Agt − 29 hari
    expect(DEFAULT_RANGE_DAYS).toBe(30);
  });

  it("dayString memakai komponen LOKAL, bukan toISOString", () => {
    // 23:30 lokal 31 Des — toISOString() di zona timur akan melompat ke tahun berikutnya.
    expect(dayString(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
pnpm vitest --run shared/src/changelog.test.ts
```

Diharapkan: GAGAL — modul `./changelog` tak ada.

- [ ] **Step 3: Tulis modulnya**

Buat `shared/src/changelog.ts`:

```ts
import { z } from "zod";

// SPEC-516 · ADR-0105 · kontrak changelog yang dipakai bersama server & web.

export const CHANGELOG_MODES = ["backlog", "commit", "version"] as const;
export const zChangelogMode = z.enum(CHANGELOG_MODES);
export type ChangelogMode = z.infer<typeof zChangelogMode>;

// Tanggal kalender, bukan timestamp: operator memilih hari di kalendernya sendiri dan batasnya
// diresolve ke awal/akhir hari LOKAL di server (services/date-range.ts, ADR-0090).
const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format tanggal harus YYYY-MM-DD");

export const zChangelogRequest = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("backlog"), from: zDay.optional(), to: zDay.optional() }),
  z.object({ mode: z.literal("commit"), fromSha: z.string().trim().min(4), toSha: z.string().trim().min(4) }),
  z.object({ mode: z.literal("version"), fromTag: z.string().trim().min(1).optional(), toTag: z.string().trim().min(1) }),
]).superRefine((v, ctx) => {
  // Perbandingan string sah untuk YYYY-MM-DD (leksikografis == kronologis) dan tak menyeret
  // satu pun konversi zona waktu ke dalam validasi.
  if (v.mode === "backlog" && v.from && v.to && v.from > v.to)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["from"],
      message: "rentang tanggal terbalik — `from` harus lebih awal atau sama dengan `to`" });
});
export type ChangelogRequest = z.infer<typeof zChangelogRequest>;

export const zChangelogView = z.object({
  id: z.string(),
  projectId: z.string(),
  mode: zChangelogMode,
  title: z.string(),
  params: z.unknown(),
  body: z.string(),
  generator: z.enum(["agent", "fallback"]),
  warning: z.string().nullable(),
  itemCount: z.number().int(),
  createdAt: z.string(),
});
export type ChangelogView = z.infer<typeof zChangelogView>;

/** Bahan yang dibutuhkan form sebelum operator menekan Bangkitkan. `reason` terisi untuk keadaan
 *  SAH yang bukan galat: repo belum ditautkan, repo tanpa tag. */
export type ChangelogSources = {
  hasRepo: boolean;
  tags: string[];
  head: string | null;
  reason: string | null;
  backlog: { doneCount: number; earliest: string | null; latest: string | null };
  defaultRange: { from: string; to: string };
};

export const DEFAULT_RANGE_DAYS = 30;

/** `YYYY-MM-DD` dari komponen LOKAL. `toISOString()` memberi hari UTC dan di WIB itu bisa
 *  meleset satu hari penuh di ujung rentang (pelajaran ADR-0090). */
export function dayString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Rentang wajar saat operator tak mengisi apa pun: 30 hari terakhir, inklusif di kedua ujung. */
export function defaultRange(today: Date): { from: string; to: string } {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DEFAULT_RANGE_DAYS - 1));
  return { from: dayString(from), to: dayString(today) };
}
```

- [ ] **Step 4: Ekspor dari barrel**

Di `shared/src/index.ts`, tambahkan sesudah baris `export * from "./auto-merge";`:

```ts
export * from "./changelog";
```

- [ ] **Step 5: Jalankan test — pastikan HIJAU**

```bash
pnpm vitest --run shared/src/changelog.test.ts
pnpm --filter ./shared typecheck
```

Diharapkan: 10 test lulus; typecheck bersih.

- [ ] **Step 6: Commit**

```bash
git add shared/src/changelog.ts shared/src/changelog.test.ts shared/src/index.ts
git commit -m "feat(spec-516): kontrak changelog bersama (mode, request, view, defaultRange)"
```

---

### Task 4: `scrub.ts` — buang jejak teknis (murni)

**Files:**
- Create: `server/src/services/changelog/scrub.ts`
- Test: `server/test/changelog-scrub.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `scrubSubject(s: string): string` · `scrubBody(s: string): string` · `scrubOutput(md: string): string`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/changelog-scrub.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scrubSubject, scrubBody, scrubOutput } from "../src/services/changelog/scrub";

describe("scrubSubject", () => {
  it("membuang prefix conventional-commit beserta scope-nya", () => {
    expect(scrubSubject("fix(spec-511): seleksi teks terminal mungkin lagi"))
      .toBe("seleksi teks terminal mungkin lagi");
    expect(scrubSubject("feat!: kirim notifikasi harian")).toBe("kirim notifikasi harian");
  });

  it("membuang path berkas", () => {
    expect(scrubSubject("perbaiki server/src/services/pty.ts agar stabil"))
      .toBe("perbaiki agar stabil");
  });

  it("membuang hash commit", () => {
    expect(scrubSubject("balikkan perubahan b89f8fe yang salah"))
      .toBe("balikkan perubahan yang salah");
  });

  it("membuang rujukan internal SPEC/ADR", () => {
    expect(scrubSubject("tutup SPEC-433 sesuai ADR-0091")).toBe("tutup sesuai");
  });

  it("membuang identifier camelCase & snake_case & pemanggilan fungsi", () => {
    expect(scrubSubject("pasang macOptionClickForcesSelection di terminal")).toBe("pasang di terminal");
    expect(scrubSubject("baca model_reasoning_effort dari setelan")).toBe("baca dari setelan");
    expect(scrubSubject("panggil recordCompletion() sekali")).toBe("panggil sekali");
  });

  it("commit merge jadi kosong (bukan butir changelog)", () => {
    expect(scrubSubject("Merge branch 'main' into feature")).toBe("");
    expect(scrubSubject("Merge pull request #12 from a/b")).toBe("");
  });

  // Kontrol negatif — prosa Indonesia biasa TIDAK boleh dirusak.
  it("prosa biasa lewat utuh", () => {
    const s = "Pengguna kini bisa mengunduh laporan bulanan langsung dari halaman ringkasan.";
    expect(scrubSubject(s)).toBe(s);
  });

  it("nama produk ber-kapital tengah yang sah tetap utuh", () => {
    expect(scrubSubject("dukungan untuk macOS dan iOS")).toBe("dukungan untuk macOS dan iOS");
    expect(scrubSubject("integrasi GitHub kini aktif")).toBe("integrasi GitHub kini aktif");
  });

  it("angka biasa tidak dianggap hash", () => {
    expect(scrubSubject("naikkan batas ke 1000000 baris")).toBe("naikkan batas ke 1000000 baris");
  });
});

describe("scrubBody", () => {
  it("hanya mengambil paragraf pertama dan tetap di-scrub", () => {
    const body = "Menambah tombol unduh di halaman laporan.\n\nDetail teknis: server/src/x.ts diubah.";
    expect(scrubBody(body)).toBe("Menambah tombol unduh di halaman laporan.");
  });

  it("membuang trailer Co-Authored-By dan sejenisnya", () => {
    expect(scrubBody("Perbaiki ejaan.\n\nCo-Authored-By: X <x@y>")).toBe("Perbaiki ejaan.");
  });
});

describe("scrubOutput", () => {
  it("membuang blok kode seluruhnya", () => {
    const md = "## Rilis\n\n- Tombol baru\n\n```ts\nconst x = 1;\n```\n\n- Lebih cepat\n";
    const out = scrubOutput(md);
    expect(out).not.toContain("const x");
    expect(out).toContain("Tombol baru");
    expect(out).toContain("Lebih cepat");
  });

  it("membuang inline code, hash, path, dan rujukan internal", () => {
    const out = scrubOutput("- Perbaikan pada `pty.ts` (b89f8fe) sesuai SPEC-511");
    expect(out).not.toMatch(/pty\.ts|b89f8fe|SPEC-511/);
  });

  it("judul & butir markdown tetap berdiri", () => {
    const out = scrubOutput("## Agustus 2026\n\n- Laporan bisa diunduh\n- Notifikasi lebih tenang\n");
    expect(out).toContain("## Agustus 2026");
    expect(out.match(/^- /gm)?.length).toBe(2);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-scrub.test.ts
```

Diharapkan: GAGAL — modul tak ada.

- [ ] **Step 3: Tulis implementasinya**

Buat `server/src/services/changelog/scrub.ts`:

```ts
// SPEC-516 · ADR-0105 · buang jejak teknis dari teks changelog. MURNI — nol I/O, nol Prisma.
//
// Dipakai DUA kali: pada INPUT (sebelum agen melihatnya) dan pada OUTPUT (jaring kedua). Yang
// pertama yang menentukan: cara paling kuat mencegah kebocoran teknis adalah tak pernah
// menyerahkannya. Subject conventional-commit dan objective backlog adalah dua sumber yang
// terbukti memuat nama berkas, hash, dan nomor SPEC.

const MERGE = /^merge\s+(branch|pull request|remote-tracking branch|tag)\b/i;
const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\([^)]*\))?!?:\s*/i;
// `a/b/c.ts`, `internal/docs/README.md` — minimal satu segmen direktori + ekstensi.
const PATH_LIKE = /(?:[\w.@-]+\/)+[\w.-]+\.\w{1,6}/g;
// Hash commit: 7–40 hex. Wajib memuat setidaknya satu DIGIT **dan** satu huruf a–f. Tanpa syarat
// digit, kata seperti "decade" ikut terbuang; tanpa syarat huruf, "1000000" pada "naikkan batas ke
// 1000000 baris" ikut terbuang. Sha 7-karakter yang kebetulan seluruhnya angka atau seluruhnya
// huruf praktis tak ada, dan `scrubOutput` masih jadi jaring keduanya.
const HEX = /\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
const INTERNAL_REF = /\b(?:SPEC|ADR|PR|ISSUE)[-\s]?\d+\b/gi;
// camelCase: butuh ≥2 huruf kecil sebelum kapital DAN ≥2 huruf kecil sesudahnya — "macOS"/"iOS"
// karena itu selamat, "macOptionClickForcesSelection" tidak.
const CAMEL = /\b[a-z]{2,}(?:[A-Z][a-z]{2,})+\b/g;
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi;
const CALL = /\b[A-Za-z_][\w.]*\(\s*\)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const FENCE = /^```[\s\S]*?^```$/gm;
const TRAILER = /^[A-Za-z-]+:\s.*$/gm;   // Co-Authored-By:, Signed-off-by:, Refs:

// Urutan mengikat: kurung yang jadi kosong dibuang DULU, baru spasi dirapatkan — kebalikannya
// meninggalkan spasi ganda di tengah kalimat. Titik/koma sengaja TIDAK ikut dipangkas di ujung
// kanan: kalimat prosa yang sah berakhir dengan titik.
const tidy = (s: string): string =>
  s.replace(/\(\s*\)/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s:;,·—–-]+/, "")
    .replace(/[\s:;,·—–-]+$/, "")
    .trim();

function strip(s: string): string {
  return s
    .replace(INLINE_CODE, " ")
    .replace(PATH_LIKE, " ")
    .replace(CALL, " ")
    .replace(HEX, " ")
    .replace(INTERNAL_REF, " ")
    .replace(CAMEL, " ")
    .replace(SNAKE, " ");
}

/** Satu baris judul (subject commit / judul backlog). Commit merge → string kosong: ia bukan
 *  perubahan yang berarti bagi pemakai, dan pemanggil membuang butir kosong. */
export function scrubSubject(s: string): string {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
  if (!one || MERGE.test(one)) return "";
  return tidy(strip(one.replace(CONVENTIONAL, "")));
}

/** Badan commit / objective backlog: ambil PARAGRAF PERTAMA saja (sisanya lazimnya detail
 *  teknis & trailer), lalu scrub dengan aturan yang sama. */
export function scrubBody(s: string): string {
  const first = (s ?? "").replace(TRAILER, "").split(/\n\s*\n/)[0] ?? "";
  return tidy(strip(first.replace(/\s+/g, " ").trim()));
}

/** Jaring kedua atas markdown keluaran agen. Blok kode dibuang UTUH — sebuah changelog untuk
 *  pemakai tak pernah punya alasan memuatnya — sementara judul & butir dipertahankan. */
export function scrubOutput(md: string): string {
  const noFence = (md ?? "").replace(FENCE, "");
  const lines = noFence.split("\n").map((line) => {
    const m = /^(\s*(?:[-*+]|\d+\.)\s+|\s*#{1,6}\s+|\s*>\s*)?(.*)$/.exec(line);
    const lead = m?.[1] ?? "";
    const rest = m?.[2] ?? line;
    const cleaned = tidy(strip(rest));
    // Baris yang isinya habis di-scrub dibuang seluruhnya berikut penandanya — butir kosong
    // (`- `) atau judul tanpa teks lebih mengganggu daripada tak ada baris sama sekali.
    return cleaned ? `${lead}${cleaned}` : "";
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
```

- [ ] **Step 4: Jalankan test — pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-scrub.test.ts
```

Diharapkan: 14 test lulus. Bila ada yang merah, perbaiki **regex**-nya (bukan test-nya) — kontrol negatif ada justru untuk mencegah scrub yang terlalu rakus.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/changelog/scrub.ts server/test/changelog-scrub.test.ts
git commit -m "feat(spec-516): scrub jejak teknis untuk changelog (murni, dua jaring)"
```

---

### Task 5: `render.ts` — draf deterministik + prompt agen (murni)

**Files:**
- Create: `server/src/services/changelog/render.ts`
- Test: `server/test/changelog-render.test.ts`

**Interfaces:**
- Consumes: `scrubSubject` (Task 4) — tidak dipanggil di sini, teks masuk sudah bersih; `ChangelogMode` (Task 3)
- Produces:
  - `type ChangelogItem = { label: string; detail: string }`
  - `type ChangelogInput = { mode: ChangelogMode; title: string; items: ChangelogItem[]; notes: string[] }`
  - `fallbackMarkdown(input: ChangelogInput): string`
  - `changelogPrompt(input: ChangelogInput, budgetMs: number): string`
  - `MODE_LABEL: Record<ChangelogMode, string>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/changelog-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fallbackMarkdown, changelogPrompt, type ChangelogInput } from "../src/services/changelog/render";

const INPUT: ChangelogInput = {
  mode: "backlog",
  title: "5 Juli – 3 Agustus 2026",
  items: [
    { label: "Laporan bulanan bisa diunduh", detail: "Pemakai mengunduh ringkasan tanpa minta ke admin." },
    { label: "Notifikasi lebih tenang", detail: "" },
  ],
  notes: ["3 item selesai tanpa stempel waktu dan tak ikut dihitung."],
};

describe("fallbackMarkdown", () => {
  it("memuat judul dan satu butir per item", () => {
    const md = fallbackMarkdown(INPUT);
    expect(md).toContain("# Changelog — 5 Juli – 3 Agustus 2026");
    expect(md).toContain("- **Laporan bulanan bisa diunduh** — Pemakai mengunduh");
    expect(md).toContain("- **Notifikasi lebih tenang**");
  });

  it("item tanpa detail tak meninggalkan tanda pisah menggantung", () => {
    expect(fallbackMarkdown(INPUT)).not.toMatch(/Notifikasi lebih tenang\*\* —\s*$/m);
  });

  it("catatan cakupan ikut tercetak", () => {
    expect(fallbackMarkdown(INPUT)).toContain("tanpa stempel waktu");
  });

  it("daftar kosong tetap menghasilkan markdown sah", () => {
    const md = fallbackMarkdown({ ...INPUT, items: [], notes: [] });
    expect(md).toContain("# Changelog —");
    expect(md.trim().length).toBeGreaterThan(0);
  });
});

describe("changelogPrompt", () => {
  const p = changelogPrompt(INPUT, 180_000);

  // Pelajaran SPEC-432, terukur: agen berbatas waktu yang TIDAK diberi tahu batasnya memakai
  // 306 dtk; prompt yang sama + satu paragraf anggaran selesai 101 dtk.
  it("menyebutkan anggaran waktunya sendiri dalam detik", () => {
    expect(p).toContain("180 detik");
  });

  it("melarang jejak teknis secara eksplisit", () => {
    expect(p).toMatch(/nama berkas/i);
    expect(p).toMatch(/nama fungsi/i);
    expect(p).toMatch(/hash commit/i);
  });

  it("meminta bahasa Indonesia dan keluaran markdown saja", () => {
    expect(p).toMatch(/bahasa Indonesia/i);
    expect(p).toMatch(/markdown/i);
  });

  it("membawa setiap item dan judulnya", () => {
    expect(p).toContain("Laporan bulanan bisa diunduh");
    expect(p).toContain("5 Juli – 3 Agustus 2026");
  });

  it("menyebut asal bahannya sesuai mode", () => {
    expect(changelogPrompt(INPUT, 1000)).toMatch(/backlog/i);
    expect(changelogPrompt({ ...INPUT, mode: "version" }, 1000)).toMatch(/versi|rilis/i);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-render.test.ts
```

Diharapkan: GAGAL — modul tak ada.

- [ ] **Step 3: Tulis implementasinya**

Buat `server/src/services/changelog/render.ts`:

```ts
import type { ChangelogMode } from "@hanoman/shared";

// SPEC-516 · ADR-0105 · bentuk akhir changelog. MURNI — nol I/O, nol Prisma, nol spawn.

export type ChangelogItem = { label: string; detail: string };
export type ChangelogInput = {
  mode: ChangelogMode;
  title: string;
  items: ChangelogItem[];
  /** Catatan cakupan yang HARUS sampai ke operator (mis. item tanpa stempel waktu). */
  notes: string[];
};

export const MODE_LABEL: Record<ChangelogMode, string> = {
  backlog: "backlog yang selesai dalam rentang tanggal",
  commit: "riwayat perubahan repo dalam rentang yang dipilih",
  version: "perubahan yang masuk ke versi/rilis itu",
};

const DETAIL_MAX = 240;
const clip = (s: string): string =>
  s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1).trimEnd()}…` : s;

/** Draf deterministik. Dipakai apa adanya saat agen tak tersedia/gagal — operator tetap melihat
 *  sesuatu yang berguna, dan `warning` di barisnya mengatakan mengapa ia belum senaratif
 *  seharusnya. */
export function fallbackMarkdown(input: ChangelogInput): string {
  const lines: string[] = [`# Changelog — ${input.title}`, ""];
  if (input.items.length === 0) {
    lines.push("_Tak ada perubahan yang bisa diringkas untuk rentang ini._", "");
  } else {
    lines.push(`Ringkasan ${input.items.length} perubahan untuk pemakai.`, "");
    for (const it of input.items) {
      const d = clip(it.detail.trim());
      lines.push(d ? `- **${it.label}** — ${d}` : `- **${it.label}**`);
    }
    lines.push("");
  }
  if (input.notes.length) {
    lines.push("---", "");
    for (const n of input.notes) lines.push(`> ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Prompt untuk agen one-shot. Tiga hal yang WAJIB ada dan masing-masing pernah jadi sebab
 * kegagalan nyata di repo ini:
 *
 * 1. **Anggaran waktu disebut.** SPEC-432 mengukurnya: agen berbatas waktu yang tak diberi tahu
 *    batasnya memakai 306 dtk untuk pekerjaan yang, dengan satu paragraf anggaran, selesai dalam
 *    101 dtk. Agen tak bisa menyesuaikan kedalaman terhadap batas yang tak ia ketahui.
 * 2. **Larangan teknis eksplisit.** Scrub adalah jaring, bukan pengganti instruksi.
 * 3. **Bentuk keluaran dikunci.** Satu blok markdown, tanpa pengantar, tanpa blok kode — supaya
 *    hasilnya bisa langsung disimpan & diunduh tanpa parsing.
 */
export function changelogPrompt(input: ChangelogInput, budgetMs: number): string {
  const budget = Math.max(1, Math.round(budgetMs / 1000));
  const items = input.items
    .map((it, i) => `${i + 1}. ${it.label}${it.detail ? ` — ${it.detail}` : ""}`)
    .join("\n");
  return [
    "Kamu menulis changelog untuk PEMAKAI sebuah produk, bukan untuk developer.",
    "",
    `Anggaran waktumu ${budget} detik. Jawab langsung — jangan membaca berkas, jangan memakai tool,`,
    "jangan menyelidiki apa pun. Seluruh bahan sudah ada di bawah.",
    "",
    `Judul rentang: ${input.title}`,
    `Bahan berasal dari ${MODE_LABEL[input.mode]}.`,
    "",
    "Bahan:",
    items || "(tidak ada)",
    "",
    "Aturan:",
    "- Bahasa Indonesia, gaya editorial: tenang, ringkas, kalimat penuh.",
    "- Tulis apa yang berubah BAGI PEMAKAI, bukan apa yang disentuh di dalam kode.",
    "- DILARANG menyebut nama berkas, nama fungsi, nama variabel, hash commit, nomor SPEC/ADR,",
    "  nama branch, atau istilah internal apa pun.",
    "- Gabungkan bahan yang bicara hal yang sama jadi satu butir. 3–10 butir; kurangi bila memang sedikit.",
    "- Jangan mengarang perubahan yang tak ada di bahan.",
    "",
    "Bentuk keluaran — HANYA markdown ini, tanpa kalimat pembuka atau penutup di luarnya,",
    "tanpa blok kode:",
    "",
    `# Changelog — ${input.title}`,
    "",
    "<satu paragraf pembuka, maksimal dua kalimat>",
    "",
    "- **<judul singkat perubahan>** — <satu kalimat manfaatnya bagi pemakai>",
  ].join("\n");
}
```

- [ ] **Step 4: Jalankan test — pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-render.test.ts
```

Diharapkan: 9 test lulus.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/changelog/render.ts server/test/changelog-render.test.ts
git commit -m "feat(spec-516): draf deterministik + prompt changelog beranggaran waktu"
```

---

### Task 6: `collect.ts` mode backlog

**Files:**
- Create: `server/src/services/changelog/collect.ts`
- Test: `server/test/changelog-collect-backlog.test.ts`

**Interfaces:**
- Consumes: `dayStart`/`dayEnd`/`inDayRange` dari `server/src/services/date-range.ts`; `scrubSubject`/`scrubBody` (Task 4); `ChangelogInput` (Task 5)
- Produces:
  - `type CollectResult = { ok: true; input: ChangelogInput } | { ok: false; reason: string }`
  - `collectBacklog(projectId: string, from: string, to: string): Promise<CollectResult>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/changelog-collect-backlog.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { collectBacklog } from "../src/services/changelog/collect";
import { resetDb, makeProject, makeSpec } from "./factory";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
});

describe("collectBacklog", () => {
  it("mengambil item done di dalam rentang, inklusif di kedua ujung", async () => {
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done", title: "Unduh laporan", doneAt: at(2026, 7, 1) });
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "done", title: "Notifikasi tenang", doneAt: at(2026, 7, 31) });
    await makeSpec({ id: "SPEC-3", projectId: "p1", stage: "done", title: "Di luar", doneAt: at(2026, 8, 1) });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toEqual(["Unduh laporan", "Notifikasi tenang"]);
  });

  it("membuang item yang belum done", async () => {
    await makeSpec({ id: "SPEC-4", projectId: "p1", stage: "executing", title: "Belum", doneAt: at(2026, 7, 10) });
    await makeSpec({ id: "SPEC-5", projectId: "p1", stage: "done", title: "Sudah", doneAt: at(2026, 7, 10) });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok && r.input.items.map((i) => i.label)).toEqual(["Sudah"]);
  });

  it("item done tanpa doneAt tak dihitung, tapi dilaporkan sebagai catatan", async () => {
    await makeSpec({ id: "SPEC-6", projectId: "p1", stage: "done", title: "Punya stempel", doneAt: at(2026, 7, 10) });
    await makeSpec({ id: "SPEC-7", projectId: "p1", stage: "done", title: "Tanpa stempel", doneAt: null });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items).toHaveLength(1);
    expect(r.input.notes.join(" ")).toMatch(/1 item .*tanpa stempel/i);
  });

  it("judul & objective ikut sebagai label & detail, sudah di-scrub", async () => {
    await makeSpec({ id: "SPEC-8", projectId: "p1", stage: "done",
      title: "fix(spec-8): unduh laporan di server/src/x.ts",
      objective: "Pemakai bisa mengunduh laporan.\n\nDetail: ubah recordCompletion().",
      doneAt: at(2026, 7, 10) });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items[0]!.label).toBe("unduh laporan di");
    expect(r.input.items[0]!.detail).toBe("Pemakai bisa mengunduh laporan.");
  });

  it("rentang kosong = alasan yang bisa dibaca, bukan lemparan", async () => {
    const r = await collectBacklog("p1", "2026-01-01", "2026-01-31");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/tak ada backlog/i);
  });

  it("item project lain tak ikut", async () => {
    await makeProject({ id: "p2", name: "p2" });
    await makeSpec({ id: "SPEC-9", projectId: "p2", stage: "done", title: "Punya tetangga", doneAt: at(2026, 7, 10) });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-collect-backlog.test.ts
```

Diharapkan: GAGAL — `collectBacklog` tak ada.

- [ ] **Step 3: Tulis implementasinya**

Buat `server/src/services/changelog/collect.ts`:

```ts
import { prisma } from "../../db";
import { dayStart, dayEnd, inDayRange } from "../date-range";
import { scrubSubject, scrubBody } from "./scrub";
import type { ChangelogInput, ChangelogItem } from "./render";

// SPEC-516 · ADR-0105 · kumpulkan bahan changelog per mode. Keadaan SAH yang bukan galat
// (rentang kosong, repo belum ditautkan, tanpa tag, revisi tak dikenal) dipulangkan sebagai
// `{ ok:false, reason }` berbahasa manusia — route menerjemahkannya ke 422, bukan 500.
// Constraint eksplisit brief: "bukan error 500".
export type CollectResult = { ok: true; input: ChangelogInput } | { ok: false; reason: string };

const toItem = (label: string, detail: string): ChangelogItem | null => {
  const l = scrubSubject(label);
  return l ? { label: l, detail: scrubBody(detail) } : null;
};

/** Mode 1 — backlog yang SELESAI dalam rentang tanggal. Stempelnya `Spec.doneAt` (ADR-0105);
 *  `updatedAt` sengaja tak dipakai — mesin sync mem-bump `version` dan overlay stage-live menulis
 *  tiap `GET /specs` dibaca, jadi ia bergerak tanpa ada manusia (ADR-0090). */
export async function collectBacklog(projectId: string, from: string, to: string): Promise<CollectResult> {
  const f = dayStart(from), t = dayEnd(to);
  const rows = await prisma.spec.findMany({
    where: { projectId, stage: "done" },
    select: { title: true, objective: true, doneAt: true },
    orderBy: [{ doneAt: "asc" }, { id: "asc" }],
  });
  const stampless = rows.filter((r) => r.doneAt === null).length;
  const hit = rows.filter((r) => inDayRange(r.doneAt, f, t));
  const items = hit.map((r) => toItem(r.title, r.objective ?? "")).filter((x): x is ChangelogItem => x !== null);
  if (items.length === 0)
    return { ok: false, reason: `tak ada backlog yang selesai antara ${from} dan ${to}` };
  const notes: string[] = [];
  if (stampless > 0)
    notes.push(`${stampless} item selesai tanpa stempel waktu (selesai sebelum stempel ini ada) dan tak ikut dihitung.`);
  return { ok: true, input: { mode: "backlog", title: `${from} – ${to}`, items, notes } };
}
```

- [ ] **Step 4: Jalankan test — pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-collect-backlog.test.ts
```

Diharapkan: 6 test lulus.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/changelog/collect.ts server/test/changelog-collect-backlog.test.ts
git commit -m "feat(spec-516): kumpulkan backlog selesai per rentang tanggal"
```

---

### Task 7: `collect.ts` mode commit & versi (git)

**Files:**
- Modify: `server/src/services/changelog/collect.ts`
- Modify: `server/test/factory.ts` (helper repo bertag)
- Test: `server/test/changelog-collect-git.test.ts`

**Interfaces:**
- Consumes: `CollectResult` (Task 6)
- Produces:
  - `listTags(repoDir: string | null): Promise<{ tags: string[]; head: string | null; reason: string | null }>`
  - `collectCommits(repoDir: string | null, fromSha: string, toSha: string): Promise<CollectResult>`
  - `collectVersions(repoDir: string | null, fromTag: string | undefined, toTag: string): Promise<CollectResult>`
  - `makeRepoWithTags(commitsPerTag: Record<string, string[]>): string` (factory)

- [ ] **Step 1: Tambahkan helper repo bertag di factory**

Di akhir `server/test/factory.ts`, tambahkan:

```ts
// SPEC-516 · repo dengan commit + tag berurutan. Kunci = nama tag, nilai = subject commit yang
// masuk ke tag itu. Tag dibuat annotated supaya `--sort=creatordate` punya tanggal sungguhan.
export function makeRepoWithTags(commitsPerTag: Record<string, string[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-tag-"));
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false"); g("config", "tag.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "awal"); g("add", "-A"); g("commit", "-qm", "awal");
  g("branch", "-M", "main");
  for (const [tag, subjects] of Object.entries(commitsPerTag)) {
    for (const s of subjects) {
      writeFileSync(join(dir, "README.md"), `${s}\n${Math.random()}`);
      g("add", "-A"); g("commit", "-qm", s);
    }
    g("tag", "-a", tag, "-m", tag);
  }
  return dir;
}
```

- [ ] **Step 2: Tulis test yang gagal**

Buat `server/test/changelog-collect-git.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { listTags, collectCommits, collectVersions } from "../src/services/changelog/collect";
import { makeRepoWithTags, makeRepoWithBranches } from "./factory";

const sha = (dir: string, rev: string) =>
  spawnSync("git", ["rev-parse", rev], { cwd: dir, encoding: "utf8" }).stdout.trim();

describe("listTags", () => {
  it("memulangkan tag terbaru lebih dulu", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua"] });
    const r = await listTags(dir);
    expect(r.tags).toEqual(["v1.1.0", "v1.0.0"]);
    expect(r.reason).toBeNull();
  });

  it("repo tanpa tag = alasan yang jelas, bukan lemparan", async () => {
    const r = await listTags(makeRepoWithBranches());
    expect(r.tags).toEqual([]);
    expect(r.reason).toMatch(/belum punya tag/i);
  });

  it("repo belum ditautkan = alasan yang jelas", async () => {
    const r = await listTags(null);
    expect(r.tags).toEqual([]);
    expect(r.reason).toMatch(/belum ditautkan/i);
  });
});

describe("collectCommits", () => {
  it("mengambil commit di antara dua revisi, terbaru lebih dulu", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua", "fitur tiga"] });
    const r = await collectCommits(dir, sha(dir, "v1.0.0"), sha(dir, "v1.1.0"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toEqual(["fitur tiga", "fitur dua"]);
    expect(r.input.mode).toBe("commit");
  });

  it("revisi tak dikenal = alasan menyebut revisinya", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"] });
    const r = await collectCommits(dir, "zzzzzzz", sha(dir, "v1.0.0"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("zzzzzzz");
  });

  it("repo belum ditautkan = alasan yang jelas", async () => {
    const r = await collectCommits(null, "a", "b");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/belum ditautkan/i);
  });

  it("rentang tanpa commit = alasan, bukan changelog kosong", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"] });
    const s = sha(dir, "v1.0.0");
    const r = await collectCommits(dir, s, s);
    expect(r.ok).toBe(false);
  });
});

describe("collectVersions", () => {
  it("satu tag = perubahan sejak tag SEBELUMNYA", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua"] });
    const r = await collectVersions(dir, undefined, "v1.1.0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toEqual(["fitur dua"]);
    expect(r.input.title).toBe("v1.1.0");
    expect(r.input.mode).toBe("version");
  });

  it("dua tag = rentang antar keduanya", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua"], "v1.2.0": ["fitur tiga"] });
    const r = await collectVersions(dir, "v1.0.0", "v1.2.0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toEqual(["fitur tiga", "fitur dua"]);
    expect(r.input.title).toBe("v1.0.0 → v1.2.0");
  });

  it("tag pertama = seluruh riwayat sampai tag itu", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"] });
    const r = await collectVersions(dir, undefined, "v1.0.0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toContain("fitur satu");
  });

  it("tag tak ada = alasan menyebut tagnya", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"] });
    const r = await collectVersions(dir, undefined, "v9.9.9");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("v9.9.9");
  });

  it("repo tanpa tag = alasan yang jelas", async () => {
    const r = await collectVersions(makeRepoWithBranches(), undefined, "v1.0.0");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/belum punya tag/i);
  });
});
```

- [ ] **Step 3: Jalankan test — pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-collect-git.test.ts
```

Diharapkan: GAGAL — `listTags`/`collectCommits`/`collectVersions` tak ada.

- [ ] **Step 4: Tambahkan bagian git di `collect.ts`**

Di `server/src/services/changelog/collect.ts`, tambahkan import di atas:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
```

dan di bawah blok yang sudah ada:

```ts
const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24, encoding: "utf8" as const };
const US = "\x1f";   // pemisah field dalam satu record (cermin git-ide.ts)
const RS = "\x1e";   // pemisah antar-record — badan commit multi-baris

const NO_REPO = "project ini belum ditautkan ke repo di mesin ini";
const NO_TAG = "repo project ini belum punya tag rilis";

const usable = (repoDir: string | null): repoDir is string => !!repoDir && existsSync(repoDir);

/** Daftar tag, terbaru lebih dulu. `reason` terisi untuk keadaan SAH yang bukan galat. */
export async function listTags(repoDir: string | null): Promise<{ tags: string[]; head: string | null; reason: string | null }> {
  if (!usable(repoDir)) return { tags: [], head: null, reason: NO_REPO };
  try {
    const { stdout } = await exec("git", ["tag", "--list", "--sort=-creatordate"], { cwd: repoDir, ...GIT });
    const tags = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    const head = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: repoDir, ...GIT })
      .then((r) => r.stdout.trim()).catch(() => null);
    return { tags, head, reason: tags.length ? null : NO_TAG };
  } catch {
    return { tags: [], head: null, reason: NO_TAG };
  }
}

/** Revisi ada? `--end-of-options` mencegah nilai berawalan `-` dibaca sebagai flag. */
async function revExists(repoDir: string, rev: string): Promise<boolean> {
  return exec("git", ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`], { cwd: repoDir, ...GIT })
    .then(() => true).catch(() => false);
}

async function logRange(repoDir: string, range: string[]): Promise<ChangelogItem[]> {
  const { stdout } = await exec("git",
    ["log", "--no-merges", `--pretty=format:%s${US}%b${RS}`, ...range], { cwd: repoDir, ...GIT });
  return stdout.split(RS)
    .map((rec) => rec.replace(/^\n+/, ""))
    .filter((rec) => rec.trim())
    .map((rec) => { const [subject, body] = rec.split(US); return toItem(subject ?? "", body ?? ""); })
    .filter((x): x is ChangelogItem => x !== null);
}

/** Mode 2 — commit di antara dua revisi. SHA sengaja TIDAK ikut ke dalam bahan: cara terkuat
 *  menjaga changelog bebas hash adalah tak pernah mengumpulkannya. */
export async function collectCommits(repoDir: string | null, fromSha: string, toSha: string): Promise<CollectResult> {
  if (!usable(repoDir)) return { ok: false, reason: NO_REPO };
  for (const rev of [fromSha, toSha])
    if (!await revExists(repoDir, rev)) return { ok: false, reason: `revisi "${rev}" tak dikenal di repo project` };
  try {
    const items = await logRange(repoDir, ["--end-of-options", `${fromSha}..${toSha}`]);
    if (!items.length) return { ok: false, reason: `tak ada perubahan antara "${fromSha}" dan "${toSha}"` };
    const short = (s: string) => s.slice(0, 7);
    return { ok: true, input: { mode: "commit", title: `${short(fromSha)} → ${short(toSha)}`, items, notes: [] } };
  } catch (e) {
    return { ok: false, reason: `git menolak rentang itu: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** Mode 3 — perubahan yang masuk ke sebuah versi. Tanpa `fromTag`, batas bawahnya adalah tag
 *  SEBELUMNYA menurut tanggal pembuatan; bila `toTag` adalah tag pertama, seluruh riwayat sampai
 *  ke sana yang diambil. */
export async function collectVersions(
  repoDir: string | null, fromTag: string | undefined, toTag: string,
): Promise<CollectResult> {
  const { tags, reason } = await listTags(repoDir);
  if (reason) return { ok: false, reason };
  if (!usable(repoDir)) return { ok: false, reason: NO_REPO };
  if (!tags.includes(toTag)) return { ok: false, reason: `tag "${toTag}" tak ada di repo project` };
  if (fromTag && !tags.includes(fromTag)) return { ok: false, reason: `tag "${fromTag}" tak ada di repo project` };
  const prev = fromTag ?? tags[tags.indexOf(toTag) + 1];
  try {
    const items = await logRange(repoDir, ["--end-of-options", prev ? `${prev}..${toTag}` : toTag]);
    if (!items.length) return { ok: false, reason: `tak ada perubahan yang masuk ke "${toTag}"` };
    const title = fromTag ? `${fromTag} → ${toTag}` : toTag;
    return { ok: true, input: { mode: "version", title, items, notes: [] } };
  } catch (e) {
    return { ok: false, reason: `git menolak rentang itu: ${(e as Error).message.split("\n")[0]}` };
  }
}
```

- [ ] **Step 5: Jalankan test — pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-collect-git.test.ts server/test/changelog-collect-backlog.test.ts
```

Diharapkan: 6 + 12 test lulus.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/changelog/collect.ts server/test/changelog-collect-git.test.ts server/test/factory.ts
git commit -m "feat(spec-516): kumpulkan changelog dari rentang SHA & tag rilis"
```

---

### Task 8: `generate.ts` — orkestrasi agen + fallback

**Files:**
- Create: `server/src/services/changelog/generate.ts`
- Test: `server/test/changelog-generate.test.ts`

**Interfaces:**
- Consumes: `collectBacklog`/`collectCommits`/`collectVersions` (Task 6–7) · `changelogPrompt`/`fallbackMarkdown` (Task 5) · `scrubOutput` (Task 4) · `think`/`ThinkOpts` dari `../lead/brain` · `sessionAgentDefaults` dari `../settings` · `resolveRepoDir` dari `../local-binding` · `defaultRange` (Task 3)
- Produces:
  - `type ThinkFn = (prompt: string, o: ThinkOpts) => Promise<string>`
  - `CHANGELOG_TIMEOUT_MS = 180_000`
  - `generateChangelog(projectId, req, deps?): Promise<{ ok: true; row: Changelog } | { ok: false; reason: string }>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/changelog-generate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { generateChangelog, CHANGELOG_TIMEOUT_MS } from "../src/services/changelog/generate";
import { resetDb, makeProject, makeSpec, makeRepoWithTags } from "./factory";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done",
    title: "Laporan bisa diunduh", objective: "Pemakai mengunduh sendiri.", doneAt: at(2026, 7, 10) });
});

describe("generateChangelog", () => {
  it("memakai keluaran agen saat agen berhasil", async () => {
    const think = async () => "# Changelog — Juli\n\n- **Laporan** — bisa diunduh sendiri.\n";
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.generator).toBe("agent");
    expect(r.row.warning).toBeNull();
    expect(r.row.body).toContain("Laporan");
    expect(r.row.itemCount).toBe(1);
    expect(r.row.mode).toBe("backlog");
  });

  it("men-scrub keluaran agen yang masih bocor teknis", async () => {
    const think = async () => "# Changelog\n\n- Perbaikan pada `pty.ts` (b89f8fe) sesuai SPEC-511\n";
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.body).not.toMatch(/pty\.ts|b89f8fe|SPEC-511/);
  });

  it("agen gagal → draf deterministik + warning, BUKAN galat", async () => {
    const think = async () => { throw new Error("lead claude kehabisan waktu 180000 ms"); };
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.generator).toBe("fallback");
    expect(r.row.warning).toContain("kehabisan waktu");
    expect(r.row.body).toContain("Laporan bisa diunduh");
  });

  it("agen memulangkan teks kosong → fallback", async () => {
    const think = async () => "   \n";
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok && r.row.generator).toBe("fallback");
  });

  // Deterministik tanpa membekukan jam: item disemai pada HARI INI, lalu judulnya dibandingkan
  // dengan `defaultRange(new Date())` yang sama. Menyandarkan test pada tanggal tetap (mis. Juli
  // 2026) akan berubah verdict-nya seiring waktu berjalan.
  it("tanpa rentang → memakai 30 hari terakhir", async () => {
    const { defaultRange } = await import("@hanoman/shared");
    const d = defaultRange(new Date());
    await makeSpec({ id: "SPEC-BARU", projectId: "p1", stage: "done",
      title: "Perubahan terbaru", objective: "Terasa langsung.", doneAt: new Date() });
    const think = async () => "# Changelog\n\n- apa saja\n";
    const r = await generateChangelog("p1", { mode: "backlog" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.title).toBe(`${d.from} – ${d.to}`);
  });

  it("catatan cakupan masuk ke warning meski agen berhasil", async () => {
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "done", title: "Tanpa stempel", doneAt: null });
    const think = async () => "# Changelog\n\n- apa saja\n";
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.generator).toBe("agent");
    expect(r.row.warning).toMatch(/tanpa stempel/i);
  });

  it("mode version memakai repo project", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua"] });
    await makeProject({ id: "p2", name: "p2", repoDir: dir });
    const think = async () => "# Changelog — v1.1.0\n\n- **Fitur dua** — tersedia.\n";
    const r = await generateChangelog("p2", { mode: "version", toTag: "v1.1.0" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.mode).toBe("version");
    expect(r.row.title).toBe("v1.1.0");
  });

  it("keadaan sah yang bukan galat dipulangkan sebagai reason", async () => {
    await makeProject({ id: "p3", name: "p3", repoDir: null });
    const r = await generateChangelog("p3", { mode: "commit", fromSha: "aaaa", toSha: "bbbb" }, { think: async () => "x" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/belum ditautkan/i);
  });

  it("anggaran waktu default 180 detik", () => {
    expect(CHANGELOG_TIMEOUT_MS).toBe(180_000);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-generate.test.ts
```

Diharapkan: GAGAL — modul tak ada.

- [ ] **Step 3: Tulis implementasinya**

Buat `server/src/services/changelog/generate.ts`:

```ts
import type { Changelog, Prisma } from "@prisma/client";
import { type ChangelogRequest, defaultRange } from "@hanoman/shared";
import { prisma } from "../../db";
import { resolveRepoDir } from "../local-binding";
import { sessionAgentDefaults } from "../settings";
import { think, type ThinkOpts } from "../lead/brain";
import { collectBacklog, collectCommits, collectVersions, type CollectResult } from "./collect";
import { changelogPrompt, fallbackMarkdown } from "./render";
import { scrubOutput } from "./scrub";

// SPEC-516 · ADR-0105 · orkestrasi: collect → prompt → agen → scrub → simpan.
//
// `think()` DIIMPOR dari `services/lead/brain.ts`, bukan disalin. Itu bukan kenyamanan melainkan
// inti keputusannya: hanoman punya DUA titik spawn agen (`pty.ts` dan `lead/brain.ts`), dan titik
// ketiga akan mengulang SPEC-448 — di sana `rootBypassEnv` ada di `pty.ts` tapi tak pernah
// menyeberang ke `brain.ts`, dan lead gagal 100 % di setiap instance yang servernya jalan sebagai
// root (`User=root` adalah konfigurasi deploy RESMI). `think()` sudah membawa gerbang root,
// `stdin.end()` (SPEC-448), `maxBuffer` 16 MiB, dan `leadFailureReason()` yang membaca KEDUA stream.
export type ThinkFn = (prompt: string, o: ThinkOpts) => Promise<string>;

/** Anggaran waktu satu pembangkitan. Disebutkan DI DALAM prompt (SPEC-432): agen yang tak tahu
 *  batasnya tak bisa menyesuaikan kedalamannya. */
export const CHANGELOG_TIMEOUT_MS = 180_000;

export type GenerateResult = { ok: true; row: Changelog } | { ok: false; reason: string };

async function collect(projectId: string, req: ChangelogRequest): Promise<CollectResult> {
  if (req.mode === "backlog") {
    const d = defaultRange(new Date());
    return collectBacklog(projectId, req.from ?? d.from, req.to ?? d.to);
  }
  const repoDir = await resolveRepoDir(projectId);
  return req.mode === "commit"
    ? collectCommits(repoDir, req.fromSha, req.toSha)
    : collectVersions(repoDir, req.fromTag, req.toTag);
}

export async function generateChangelog(
  projectId: string, req: ChangelogRequest, deps: { think?: ThinkFn } = {},
): Promise<GenerateResult> {
  const got = await collect(projectId, req);
  if (!got.ok) return got;
  const input = got.input;

  const prompt = changelogPrompt(input, CHANGELOG_TIMEOUT_MS);
  const { agent, model, effort } = await sessionAgentDefaults();
  const run = deps.think ?? think;

  let body = "";
  let generator: "agent" | "fallback" = "agent";
  const warnings = [...input.notes];
  try {
    const raw = await run(prompt, { agent, model, effort, timeoutMs: CHANGELOG_TIMEOUT_MS });
    body = scrubOutput(raw ?? "");
    // Agen yang menjawab kosong sama saja dengan agen yang gagal — jangan menyimpan halaman hampa.
    if (!body.trim()) throw new Error("agen tak memulangkan teks apa pun");
  } catch (e) {
    generator = "fallback";
    body = fallbackMarkdown(input);
    warnings.push(`Narasi otomatis tak tersedia — ${(e as Error).message}. Yang tampil adalah draf ringkas.`);
  }

  const row = await prisma.changelog.create({
    data: {
      projectId, mode: input.mode, title: input.title,
      params: req as unknown as Prisma.InputJsonValue,
      body, generator, itemCount: input.items.length,
      warning: warnings.length ? warnings.join(" ") : null,
    },
  });
  return { ok: true, row };
}
```

- [ ] **Step 4: Jalankan test — pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog-generate.test.ts
```

Diharapkan: 9 test lulus.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/changelog/generate.ts server/test/changelog-generate.test.ts
git commit -m "feat(spec-516): pembangkit changelog (agen one-shot + fallback deterministik)"
```

---

### Task 9: Endpoint `/projects/:id/changelog`

**Files:**
- Create: `server/src/routes/changelog.ts`
- Modify: `server/src/app.ts` (import + `api.register`)
- Modify: `server/src/services/agent-capabilities.ts:66` (cabang `sub`)
- Test: `server/test/changelog.route.test.ts`
- Test: `server/test/agent-capabilities.test.ts` (tambah kasus)

**Interfaces:**
- Consumes: `generateChangelog` (Task 8) · `listTags` (Task 7) · `zChangelogRequest`/`defaultRange` (Task 3) · `paginate` · `downloadFormat`/`sendDocDownload`
- Produces: lima endpoint (lihat tabel di spec).

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/changelog.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec, makeRepoWithTags, makeRepoWithBranches } from "./factory";

// Agen tak pernah benar-benar di-spawn dalam test route: `think` distub di titik cekiknya.
vi.mock("../src/services/lead/brain", async (orig) => ({
  ...(await orig<typeof import("../src/services/lead/brain")>()),
  think: vi.fn(async () => "# Changelog — uji\n\n- **Butir** — manfaatnya.\n"),
}));

const app = buildApp({ requireAuth: false });
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done",
    title: "Laporan bisa diunduh", objective: "Pemakai mengunduh sendiri.", doneAt: at(2026, 7, 10) });
});

const gen = (body: unknown, id = "p1") =>
  app.inject({ method: "POST", url: `/api/projects/${id}/changelog`, payload: body });

describe("POST /projects/:id/changelog", () => {
  it("membangkitkan & menyimpan (201)", async () => {
    const res = await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j.mode).toBe("backlog");
    expect(j.generator).toBe("agent");
    expect(j.body).toContain("Butir");
    expect(await prisma.changelog.count()).toBe(1);
  });

  it("from > to ditolak 400 sebelum menyentuh repo", async () => {
    const res = await gen({ mode: "backlog", from: "2026-08-02", to: "2026-08-01" });
    expect(res.statusCode).toBe(400);
  });

  it("rentang kosong = 422 berpesan, bukan 500", async () => {
    const res = await gen({ mode: "backlog", from: "2026-01-01", to: "2026-01-31" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/tak ada backlog/i);
  });

  it("project tanpa repo, mode commit = 422 berpesan", async () => {
    const res = await gen({ mode: "commit", fromSha: "aaaa", toSha: "bbbb" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/belum ditautkan/i);
  });

  it("repo tanpa tag, mode versi = 422 berpesan", async () => {
    await makeProject({ id: "p2", name: "p2", repoDir: makeRepoWithBranches() });
    const res = await gen({ mode: "version", toTag: "v1.0.0" }, "p2");
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/belum punya tag/i);
  });

  it("project tak ada = 404", async () => {
    const res = await gen({ mode: "backlog" }, "entah");
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /projects/:id/changelog", () => {
  it("daftar terbaru lebih dulu, terpaginasi", async () => {
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    const res = await app.inject({ url: "/api/projects/p1/changelog?limit=1&page=1" });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.total).toBe(2);
    expect(j.items).toHaveLength(1);
  });
});

describe("GET /projects/:id/changelog/sources", () => {
  it("repo bertag: daftar tag terbaru lebih dulu + rentang default", async () => {
    await makeProject({ id: "p3", name: "p3", repoDir: makeRepoWithTags({ "v1.0.0": ["a"], "v1.1.0": ["b"] }) });
    const res = await app.inject({ url: "/api/projects/p3/changelog/sources" });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.tags).toEqual(["v1.1.0", "v1.0.0"]);
    expect(j.reason).toBeNull();
    expect(j.defaultRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("repo belum ditautkan: 200 dengan alasan, BUKAN 500", async () => {
    const res = await app.inject({ url: "/api/projects/p1/changelog/sources" });
    expect(res.statusCode).toBe(200);
    expect(res.json().reason).toMatch(/belum ditautkan/i);
    expect(res.json().backlog.doneCount).toBe(1);
  });
});

describe("GET /projects/:id/changelog/:cid", () => {
  it("unduh .md membawa content-disposition dan isi apa adanya", async () => {
    const made = (await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" })).json();
    const res = await app.inject({ url: `/api/projects/p1/changelog/${made.id}?download=md` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toContain("attachment;");
    expect(res.body).toBe(made.body);
  });

  it("tanpa query = JSON", async () => {
    const made = (await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" })).json();
    const res = await app.inject({ url: `/api/projects/p1/changelog/${made.id}` });
    expect(res.json().id).toBe(made.id);
  });

  it("id tak ada = 404", async () => {
    expect((await app.inject({ url: "/api/projects/p1/changelog/entah" })).statusCode).toBe(404);
  });
});

describe("DELETE /projects/:id/changelog/:cid", () => {
  it("menghapus (204) lalu 404", async () => {
    const made = (await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" })).json();
    const url = `/api/projects/p1/changelog/${made.id}`;
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(404);
  });
});
```

Tambahkan juga di `server/test/agent-capabilities.test.ts` (di dalam `describe` yang sudah ada):

```ts
  // SPEC-516 · ADR-0105 · changelog adalah DOKUMEN, sejajar docs/prds — bukan `projects`, yang
  // akan menuntut agen dipercaya menyunting & menghapus project hanya untuk membaca changelog.
  it("changelog project → domain docs", () => {
    expect(capabilityForRoute("GET", "/api/projects/p1/changelog")).toBe("docs:read");
    expect(capabilityForRoute("GET", "/api/projects/p1/changelog/sources")).toBe("docs:read");
    expect(capabilityForRoute("POST", "/api/projects/p1/changelog")).toBe("docs:write");
    expect(capabilityForRoute("DELETE", "/api/projects/p1/changelog/abc")).toBe("docs:write");
  });
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog.route.test.ts server/test/agent-capabilities.test.ts
```

Diharapkan: GAGAL — route 404 dan capability masih `projects:read`.

- [ ] **Step 3: Petakan capability ke domain `docs`**

Di `server/src/services/agent-capabilities.ts`, ubah baris 66 dari:

```ts
    if (sub === "docs" || sub === "prds") return rw("docs");
```

menjadi:

```ts
    // SPEC-516 · ADR-0105 · changelog adalah DOKUMEN, sejajar docs/prds. Tanpa baris ini ia jatuh
    // ke `rw("projects")` di bawah — artinya agen harus dipercaya menyunting & menghapus project
    // hanya untuk membaca changelog-nya.
    if (sub === "docs" || sub === "prds" || sub === "changelog") return rw("docs");
```

- [ ] **Step 4: Tulis route-nya**

Buat `server/src/routes/changelog.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { zChangelogRequest, defaultRange } from "@hanoman/shared";
import { prisma } from "../db";
import { resolveRepoDir } from "../services/local-binding";
import { paginate } from "../services/paginate";
import { downloadFormat, sendDocDownload } from "../services/doc-export";
import { listTags } from "../services/changelog/collect";
import { generateChangelog } from "../services/changelog/generate";

// SPEC-516 · ADR-0105 · changelog per project. Capability domain `docs` (agent-capabilities.ts).
//
// Keadaan SAH yang bukan galat — rentang kosong, repo belum ditautkan, repo tanpa tag, revisi tak
// dikenal — dijawab **422 + pesan**, tak pernah 500 (constraint eksplisit brief).

const view = (c: {
  id: string; projectId: string; mode: string; title: string; params: unknown; body: string;
  generator: string; warning: string | null; itemCount: number; createdAt: Date;
}) => ({ ...c, createdAt: c.createdAt.toISOString() });

export default async function (app: FastifyInstance) {
  // `sources` adalah segmen STATIS dan karena itu menang atas `:cid` di router radix Fastify —
  // tapi ia tetap didaftarkan lebih dulu supaya urutannya terbaca di berkas ini juga.
  app.get("/projects/:id/changelog/sources", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!await prisma.project.findUnique({ where: { id } })) return reply.code(404).send({ error: "not found" });
    const { tags, head, reason } = await listTags(await resolveRepoDir(id));
    const done = await prisma.spec.findMany({
      where: { projectId: id, stage: "done", doneAt: { not: null } },
      select: { doneAt: true }, orderBy: { doneAt: "asc" },
    });
    return {
      hasRepo: reason === null || tags.length > 0,
      tags, head, reason,
      backlog: {
        doneCount: done.length,
        earliest: done[0]?.doneAt?.toISOString() ?? null,
        latest: done[done.length - 1]?.doneAt?.toISOString() ?? null,
      },
      defaultRange: defaultRange(new Date()),
    };
  });

  app.get("/projects/:id/changelog", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!await prisma.project.findUnique({ where: { id } })) return reply.code(404).send({ error: "not found" });
    const { page, limit } = req.query as { page?: string; limit?: string };
    const rows = await prisma.changelog.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
    return paginate(rows.map(view), page, limit);
  });

  app.get("/projects/:id/changelog/:cid", async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const row = await prisma.changelog.findFirst({ where: { id: cid, projectId: id } });
    if (!row) return reply.code(404).send({ error: "not found" });
    // SPEC-361 · ADR-0078 · unduh .md mentah / .pdf lewat helper yang sama dengan dokumen lain.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendDocDownload(reply, fmt, {
      content: row.body, name: `${row.title}.md`, prefix: `${id}-changelog`,
      eyebrow: `hanoman · ${id} · changelog`, path: row.title,
    });
    return view(row);
  });

  app.post("/projects/:id/changelog", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!await prisma.project.findUnique({ where: { id } })) return reply.code(404).send({ error: "not found" });
    const parsed = zChangelogRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const r = await generateChangelog(id, parsed.data);
    if (!r.ok) return reply.code(422).send({ error: r.reason });
    return reply.code(201).send(view(r.row));
  });

  app.delete("/projects/:id/changelog/:cid", async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const { count } = await prisma.changelog.deleteMany({ where: { id: cid, projectId: id } });
    return count ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
  });
}
```

- [ ] **Step 5: Daftarkan di `app.ts`**

Di `server/src/app.ts`, tambahkan import setelah baris `import lead from "./routes/lead";`:

```ts
import changelog from "./routes/changelog";
```

dan register setelah baris `await api.register(webhooks);`:

```ts
    await api.register(changelog);    // SPEC-516 · ADR-0105 · changelog per project (capability `docs`)
```

- [ ] **Step 6: Jalankan test — pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/changelog.route.test.ts server/test/agent-capabilities.test.ts
pnpm --filter ./server typecheck
```

Diharapkan: 14 test route + seluruh test capability lulus; typecheck bersih.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/changelog.ts server/src/app.ts server/src/services/agent-capabilities.ts \
        server/test/changelog.route.test.ts server/test/agent-capabilities.test.ts
git commit -m "feat(spec-516): endpoint changelog per project (capability docs)"
```

---

### Task 10: Panel Changelog di dashboard

**Files:**
- Modify: `shared/src/api.ts` (`paths`)
- Modify: `src/src/api/client.ts`
- Create: `src/src/screens/ChangelogPanel.tsx`
- Modify: `src/src/screens/ProjectDetailScreen.tsx`
- Test: `src/src/screens/ChangelogPanel.test.tsx`

**Interfaces:**
- Consumes: `ChangelogView`/`ChangelogSources`/`ChangelogRequest` (Task 3); endpoint Task 9
- Produces: `api.listChangelogs` · `api.changelogSources` · `api.generateChangelog` · `api.deleteChangelog` · `paths.changelog(id)` · `paths.changelogItem(id, cid)` · `paths.changelogSources(id)` · komponen `<ChangelogPanel p={...} onToast={...} />`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/src/screens/ChangelogPanel.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangelogPanel } from "./ChangelogPanel";

const sources = {
  hasRepo: true, tags: ["v1.1.0", "v1.0.0"], head: "abc1234", reason: null,
  backlog: { doneCount: 3, earliest: null, latest: null },
  defaultRange: { from: "2026-07-05", to: "2026-08-03" },
};

vi.mock("../api/client", () => ({
  api: {
    changelogSources: vi.fn(async () => sources),
    listChangelogs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 0 })),
    generateChangelog: vi.fn(async () => ({
      id: "c1", projectId: "p1", mode: "backlog", title: "Juli", params: {},
      body: "# Changelog — Juli\n\n- **Butir** — manfaatnya.\n",
      generator: "agent", warning: null, itemCount: 1, createdAt: "2026-08-03T00:00:00.000Z",
    })),
    deleteChangelog: vi.fn(async () => undefined),
  },
}));

const props = { p: { id: "p1", name: "p1" } as never, onToast: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe("ChangelogPanel", () => {
  it("mode backlog terpilih awal, rentang terisi default dari sources", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Dari tanggal")).toHaveValue("2026-07-05"));
    expect(screen.getByLabelText("Sampai tanggal")).toHaveValue("2026-08-03");
  });

  it("mode SHA menampilkan dua kolom revisi", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Rentang commit" }));
    fireEvent.click(screen.getByRole("button", { name: "Rentang commit" }));
    expect(screen.getByLabelText("Dari revisi")).toBeInTheDocument();
    expect(screen.getByLabelText("Sampai revisi")).toBeInTheDocument();
  });

  it("mode versi menawarkan tag dari sources", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Versi rilis" }));
    fireEvent.click(screen.getByRole("button", { name: "Versi rilis" }));
    await waitFor(() => expect(screen.getByLabelText("Versi")).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "v1.1.0" })).toBeInTheDocument();
  });

  it("Bangkitkan merender hasil beserta tombol salin & unduh", async () => {
    const { api } = await import("../api/client");
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: /Bangkitkan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bangkitkan/ }));
    await waitFor(() => expect(api.generateChangelog).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Butir")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unduh .md" })).toBeInTheDocument();
  });

  it("warning dari server tampil ke operator", async () => {
    const { api } = await import("../api/client");
    (api.generateChangelog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "c2", projectId: "p1", mode: "backlog", title: "Juli", params: {},
      body: "# Changelog — Juli\n", generator: "fallback",
      warning: "Narasi otomatis tak tersedia — agen kehabisan waktu.",
      itemCount: 1, createdAt: "2026-08-03T00:00:00.000Z",
    });
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: /Bangkitkan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bangkitkan/ }));
    await waitFor(() => expect(screen.getByText(/Narasi otomatis tak tersedia/)).toBeInTheDocument());
  });

  it("repo tanpa tag: mode versi menjelaskan alasannya, tanpa tombol mati tanpa sebab", async () => {
    const { api } = await import("../api/client");
    (api.changelogSources as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...sources, tags: [], reason: "repo project ini belum punya tag rilis",
    });
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Versi rilis" }));
    fireEvent.click(screen.getByRole("button", { name: "Versi rilis" }));
    await waitFor(() => expect(screen.getByText(/belum punya tag rilis/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/src/screens/ChangelogPanel.test.tsx
```

Diharapkan: GAGAL — komponen tak ada.

- [ ] **Step 3: Tambahkan path & metode klien**

Di `shared/src/api.ts`, di dalam objek `paths`, sesudah baris `githubIssues:`:

```ts
  // SPEC-516 · ADR-0105 · changelog per project
  changelog: (id: string) => `${API}/projects/${encodeURIComponent(id)}/changelog`,
  changelogSources: (id: string) => `${API}/projects/${encodeURIComponent(id)}/changelog/sources`,
  changelogItem: (id: string, cid: string) =>
    `${API}/projects/${encodeURIComponent(id)}/changelog/${encodeURIComponent(cid)}`,
```

Di `src/src/api/client.ts`, tambahkan `ChangelogView`, `ChangelogSources`, `ChangelogRequest` ke daftar `import type { … } from "@hanoman/shared"` di baris 1, lalu tambahkan metode sesudah blok `rejectGithubIssue`/`unlinkGithubIssue`:

```ts
  // SPEC-516 · ADR-0105 · changelog per project (capability `docs`).
  changelogSources: (projectId: string) =>
    j<ChangelogSources>(paths.changelogSources(projectId)),
  listChangelogs: (projectId: string, p: { page?: number; limit?: number } = {}) =>
    j<Paginated<ChangelogView>>(paths.changelog(projectId) + qs({ page: p.page, limit: p.limit })),
  generateChangelog: (projectId: string, req: ChangelogRequest) =>
    j<ChangelogView>(paths.changelog(projectId), { method: "POST", ...body(req) }),
  deleteChangelog: (projectId: string, id: string) =>
    j<void>(paths.changelogItem(projectId, id), { method: "DELETE" }),
```

- [ ] **Step 4: Tulis komponennya**

Buat `src/src/screens/ChangelogPanel.tsx`:

```tsx
/* ChangelogPanel (SPEC-516 · ADR-0105) — bangkitkan changelog naratif per project lewat tiga
   mode. Panggilan agen bisa puluhan detik, jadi statusnya eksplisit: tombol berubah teks dan
   nonaktif, bukan spinner bisu. */
import React from "react";
import { Card, Button, Badge, Input, Select, Field, MarkdownView, Callout } from "../ds";
import { api } from "../api/client";
import { paths } from "@hanoman/shared";
import type { ChangelogView, ChangelogSources, ChangelogRequest } from "@hanoman/shared";
import type { ProjectVM } from "./types";

type Mode = "backlog" | "commit" | "version";
const MODE_TABS: Array<{ mode: Mode; label: string; hint: string }> = [
  { mode: "backlog", label: "Rentang tanggal", hint: "backlog yang selesai di rentang itu" },
  { mode: "commit", label: "Rentang commit", hint: "perubahan repo antara dua revisi" },
  { mode: "version", label: "Versi rilis", hint: "perubahan yang masuk ke sebuah versi" },
];

export function ChangelogPanel({ p, onToast }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [mode, setMode] = React.useState<Mode>("backlog");
  const [src, setSrc] = React.useState<ChangelogSources | null>(null);
  const [from, setFrom] = React.useState(""); const [to, setTo] = React.useState("");
  const [fromSha, setFromSha] = React.useState(""); const [toSha, setToSha] = React.useState("");
  const [fromTag, setFromTag] = React.useState(""); const [toTag, setToTag] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ChangelogView | null>(null);
  const [saved, setSaved] = React.useState<ChangelogView[]>([]);

  const reloadSaved = React.useCallback(async () => {
    try { setSaved((await api.listChangelogs(p.id, { limit: 10 })).items); } catch { /* daftar opsional */ }
  }, [p.id]);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await api.changelogSources(p.id);
        if (!alive) return;
        setSrc(s);
        setFrom(s.defaultRange.from); setTo(s.defaultRange.to);
        if (s.tags[0]) setToTag(s.tags[0]);
        if (s.head) { setToSha(s.head); }
      } catch { /* form tetap bisa diisi manual */ }
    })();
    void reloadSaved();
    return () => { alive = false; };
  }, [p.id, reloadSaved]);

  const request = (): ChangelogRequest =>
    mode === "backlog" ? { mode, from: from || undefined, to: to || undefined }
      : mode === "commit" ? { mode, fromSha, toSha }
        : { mode, fromTag: fromTag || undefined, toTag };

  const ready = mode === "backlog" ? true
    : mode === "commit" ? fromSha.trim().length >= 4 && toSha.trim().length >= 4
      : toTag.trim().length > 0;

  async function generate() {
    setBusy(true);
    try {
      const r = await api.generateChangelog(p.id, request());
      setResult(r);
      onToast(r.generator === "agent" ? "Changelog dibangkitkan" : "Changelog dibangkitkan (draf ringkas)",
        r.generator === "agent" ? "ok" : "warn", "file-text");
      await reloadSaved();
    } catch (e) {
      onToast((e as Error).message || "Gagal membangkitkan changelog", "err", "x-circle");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Hapus changelog ini?")) return;
    try {
      await api.deleteChangelog(p.id, id);
      if (result?.id === id) setResult(null);
      await reloadSaved();
      onToast("Changelog dihapus", "ok", "trash-2");
    } catch { onToast("Gagal menghapus changelog", "err", "x-circle"); }
  }

  const tagsMissing = mode === "version" && src !== null && src.tags.length === 0;
  const repoMissing = mode === "commit" && src !== null && !!src.reason && src.tags.length === 0;

  return (
    <Card eyebrow="changelog" title="Ringkasan perubahan untuk pemakai"
      actions={result && (
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => {
            void navigator.clipboard?.writeText(result.body); onToast("Changelog disalin", "ok", "copy");
          }}>Salin</Button>
          <Button as="a" size="sm" variant="ghost" leftIcon="download" download
            href={`${paths.changelogItem(p.id, result.id)}?download=md`}
            aria-label="Unduh .md">Unduh .md</Button>
        </div>
      )}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Teks pendek berorientasi pemakai — apa yang berubah bagi mereka, bukan apa yang disentuh di dalam kode.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {MODE_TABS.map((t) => (
          <Button key={t.mode} size="sm" variant={mode === t.mode ? "primary" : "ghost"}
            onClick={() => setMode(t.mode)} title={t.hint}>{t.label}</Button>
        ))}
      </div>

      {/* `Input`/`Select` design system TAK punya prop `label` — keduanya menyebar `...rest` ke
          elemen native, jadi nama aksesibilitasnya dipasang lewat `aria-label` dan label yang
          TERLIHAT lewat `Field`. `Select` juga menerima `options`, bukan `children` <option>:
          anak JSX akan diabaikan senyap. */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
        {mode === "backlog" && (
          <>
            <Field label="Dari tanggal">
              <Input aria-label="Dari tanggal" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Sampai tanggal">
              <Input aria-label="Sampai tanggal" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
        {mode === "commit" && (
          <>
            <Field label="Dari revisi">
              <Input aria-label="Dari revisi" mono placeholder="mis. v1.0.0 atau 4f2a1c9" value={fromSha}
                onChange={(e) => setFromSha(e.target.value)} />
            </Field>
            <Field label="Sampai revisi">
              <Input aria-label="Sampai revisi" mono placeholder="mis. HEAD atau 9d3b77e" value={toSha}
                onChange={(e) => setToSha(e.target.value)} />
            </Field>
          </>
        )}
        {mode === "version" && (
          <>
            <Field label="Sejak versi">
              <Select aria-label="Sejak versi" value={fromTag} onChange={(e) => setFromTag(e.target.value)}
                options={[{ value: "", label: "versi sebelumnya" }, ...(src?.tags ?? []).map((t) => ({ value: t, label: t }))]} />
            </Field>
            <Field label="Versi">
              <Select aria-label="Versi" value={toTag} onChange={(e) => setToTag(e.target.value)}
                options={(src?.tags ?? []).map((t) => ({ value: t, label: t }))} />
            </Field>
          </>
        )}
        <Button leftIcon="sparkles" onClick={() => void generate()} disabled={busy || !ready || tagsMissing || repoMissing}>
          {busy ? "Membangkitkan…" : "Bangkitkan"}
        </Button>
      </div>

      {(tagsMissing || repoMissing) && (
        <Callout tone="warn">{src?.reason}</Callout>
      )}

      {result && (
        <div style={{ marginTop: 8 }}>
          {result.warning && <Callout tone="warn">{result.warning}</Callout>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <Badge tone={result.generator === "agent" ? "ok" : "warn"} size="sm">
              {result.generator === "agent" ? "naratif" : "draf ringkas"}
            </Badge>
            <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{result.itemCount} perubahan</span>
          </div>
          <MarkdownView text={result.body} name="changelog.md" />
        </div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Tersimpan</div>
          {saved.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <Button size="sm" variant="ghost" onClick={() => setResult(c)}>{c.title}</Button>
              <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{c.mode}</span>
              <div style={{ flex: 1 }} />
              <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${c.title}`}
                onClick={() => void remove(c.id)} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 5: Pasang di detail project**

Di `src/src/screens/ProjectDetailScreen.tsx`, tambahkan import di dekat import `AutoMergeCard`:

```tsx
import { ChangelogPanel } from "./ChangelogPanel";
```

dan sisipkan komponen tepat sesudah `<AutoMergeCard … />`:

```tsx
      {/* SPEC-516 · ADR-0105 · changelog naratif per project (tiga mode). */}
      <ChangelogPanel p={p} onToast={onToast} />
```

- [ ] **Step 6: Jalankan test — pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/src/screens/ChangelogPanel.test.tsx
pnpm --filter ./src typecheck
```

Diharapkan: 6 test lulus; typecheck bersih.

- [ ] **Step 7: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/src/screens/ChangelogPanel.tsx \
        src/src/screens/ChangelogPanel.test.tsx src/src/screens/ProjectDetailScreen.tsx
git commit -m "feat(spec-516): panel Changelog di detail project"
```

---

### Task 11: ADR-0105 + docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0105-changelog-per-project.md`
- Modify: `internal/docs/README.md` (daftar adr)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `docs/agent-integration.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: seluruh keputusan Task 1–10
- Produces: dokumentasi Source of Truth yang tertaut di index

- [ ] **Step 1: Pastikan nomor ADR belum diklaim branch/worktree lain**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
git worktree list
git for-each-ref --format='%(refname)' | while read r; do git ls-tree -r --name-only "$r" -- internal/docs/adr 2>/dev/null; done | grep -oE '0[0-9]{3}-' | sort -u | tail -5
cd -
```

Diharapkan: nomor tertinggi `0104`. Bila sudah ada `0105` di branch lain, **pakai nomor berikutnya yang bebas** dan ganti semua rujukan `0105` di seluruh berkas (`rtk proxy grep -rn "0105" .`).

- [ ] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0105-changelog-per-project.md` dengan bagian: Status (Diterima, 2026-08-03) · Konteks · Keputusan · Konsekuensi · Alternatif yang ditolak · Gotcha. Isi wajib memuat, masing-masing satu paragraf:

1. **`Spec.doneAt` sebagai kolom, ditulis di `recordCompletion` saja.** Arahnya sama dengan ADR-0090 dan berlawanan dengan ADR-0018/0019: waktu lahir/selesai sebuah baris tak bisa dihitung ulang dari sumber lain. Penulisnya satu karena efek samping yang disalin ke tiga call site adalah kelas bug SPEC-431/448/475 dan efek samping tak punya tipe yang memaksanya konsisten.
2. **Tulis-sekali & tak dibatalkan revert.** Cermin idempotensi `recordCompletion` (ADR-0033) dan `startedAt` (ADR-0090).
3. **Backfill dari notifikasi `done:<specId>`** — sumber yang sama yang dipakai sweep auto-merge ADR-0103; item pra-SPEC-180 tetap null dan dilaporkan sebagai catatan.
4. **`Changelog` LOCAL-only** (tanpa `version`), cermin `LeadFlow`/`WebhookEndpoint`/`Project.autoMerge`.
5. **`think()` diimpor, bukan disalin** — titik spawn agen ketiga akan mengulang SPEC-448.
6. **Gagal agen ≠ galat** — draf deterministik + `warning`.
7. **Scrub di dua sisi, yang menentukan adalah sisi INPUT.**
8. **Capability `docs`, bukan `projects`.**
9. **Non-goal:** tanpa tool MCP (ADR-0099), tanpa peristiwa webhook (ADR-0100), tanpa sync, tanpa penjadwalan, tanpa terbit ke luar.
10. **Gotcha wajib:** (a) `PG_ORDER` harus memuat model baru — `cli/test/migrate-pg.test.ts` menuntutnya sama persis dengan DMMF, dan pelanggarannya adalah satu-satunya gerbang; (b) `doneAt` wajib di `FIELDS.spec` **dan** `DATE_FIELDS.spec`, sebab `upsert` yang tak menyebut sebuah kolom tetap berhasil; (c) batas hari harus LOKAL, bukan UTC (`new Date("2026-07-31")` = tengah malam UTC); (d) regex scrub camelCase wajib menuntut ≥2 huruf kecil di kedua sisi kapital, tanpa itu `macOS`/`iOS` ikut terbuang.

- [ ] **Step 3: Taut di kedua index**

Di `internal/docs/README.md`, di bawah `## adr`, tambahkan sebagai baris **pertama** daftar:

```markdown
- [0105 — Changelog per project: `Spec.doneAt` berkolom, hasil tersimpan LOCAL-only, narasi agen ber-fallback](adr/0105-changelog-per-project.md)
```

Di `internal/docs/adr/README.md`, tambahkan entri narasi mengikuti format entri 0104 yang sudah ada di berkas itu.

- [ ] **Step 4: Perbarui data-model & api-contract**

Di `internal/docs/architecture/data-model.md`, bagian `## Spec`, tambahkan butir `doneAt`; tambahkan sub-bagian `## Changelog` baru yang menyebut LOCAL-only + FK cascade + index.

Di `internal/docs/architecture/api-contract.md`, tambahkan bagian changelog dengan kelima endpoint, kode status (201/400/404/422), dan capability `docs:read`/`docs:write`.

- [ ] **Step 5: Perbarui panduan agen & skill**

Di `docs/agent-integration.md`, tambahkan satu bagian singkat "Changelog project" berisi contoh `POST /api/projects/<id>/changelog` untuk ketiga mode + catatan bahwa hasilnya bisa diunduh `?download=md`. **Jangan** memuat token nyata (dijaga `agent-doc-contract.test.ts`).

Di `internal/skills/hanoman/SKILL.md`, di bawah "Aturan Arsitektur", tambahkan satu butir ringkas SPEC-516/ADR-0105 yang menyebut: `doneAt` satu penulis, `Changelog` LOCAL-only, `think()` diimpor, scrub dua sisi, capability `docs`, dan keempat gotcha.

- [ ] **Step 6: Verifikasi integritas index + test kontrak dokumen**

```bash
pnpm --filter ./cli exec node -e "0" 2>/dev/null || true
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/agent-doc-contract.test.ts server/test/guide-file.test.ts
```

Diharapkan: lulus. Lalu:

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli build && node cli/dist/index.js docs index --check
```

Diharapkan: index bersih (bila perintah ini tak tersedia di worktree tanpa build, lewati dan pastikan tautan manual sudah benar).

- [ ] **Step 7: Commit**

```bash
git add internal/docs/adr/0105-changelog-per-project.md internal/docs/README.md \
        internal/docs/adr/README.md internal/docs/architecture/data-model.md \
        internal/docs/architecture/api-contract.md docs/agent-integration.md \
        internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-516): ADR-0105 changelog per project + data-model/api-contract/panduan agen"
```

---

### Task 12: Verifikasi menyeluruh & smoke endpoint nyata

**Files:** —

**Interfaces:**
- Consumes: seluruh task
- Produces: bukti bahwa perubahan ini hijau di scope yang tersentuh

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Diharapkan: semua lulus. **Pastikan berkas test-nya memang berjalan** — `--changed` menyalakan `passWithNoTests`, jadi "no test files" bukan bukti hijau. Hitung jumlah berkas yang dijalankan dan bandingkan dengan test yang ditulis plan ini (minimal: `changelog-*.test.ts` × 7, `spec-done-at`, `agent-capabilities`, `ChangelogPanel`, `migrate-pg`, `shared/src/changelog`).

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck
pnpm --filter ./server typecheck
pnpm --filter ./src typecheck
pnpm --filter ./cli typecheck
```

Diharapkan: keempatnya bersih. (Perluasan ke empat paket disengaja: `shared/src/changelog.ts` diimpor server **dan** web, dan `PG_ORDER` hidup di `cli`.)

- [ ] **Step 3: Smoke endpoint nyata (sekali, di akhir)**

```bash
export HANOMAN_HOME="$(mktemp -d)"
cd server && pnpm prisma migrate deploy && cd ..
# boot server di latar, lalu:
curl -s "http://127.0.0.1:8787/api/projects/<id>/changelog/sources" | head -40
curl -s -X POST "http://127.0.0.1:8787/api/projects/<id>/changelog" \
  -H 'content-type: application/json' -d '{"mode":"backlog"}' | head -40
curl -s "http://127.0.0.1:8787/api/projects/<id>/changelog/<cid>?download=md" -D - | head -20
```

Diharapkan: `sources` menjawab 200 (dengan `reason` bila project belum ditautkan); POST menjawab 201 atau 422 berpesan — **tidak pernah 500**; unduh membawa `content-type: text/markdown` + `content-disposition`.

**`HANOMAN_HOME` khusus wajib** — smoke jangan memakai DB test bersama; run sesi tetangga menghapusnya di tengah jalan.

Matikan server dengan **PID**, bukan pola:

```bash
lsof -ti:8787 | xargs -r kill
```

Jangan pernah `pkill -f node` / `pkill -f vitest`: prompt tiap sesi hidup di ARGV agennya dan pola itu membunuh agen sesi TETANGGA (SPEC-402).

- [ ] **Step 4: Centang seluruh kotak plan ini**

Pastikan tak ada `- [ ]` tersisa di berkas ini — hanoman menahan backlog di `executing` selama masih ada satu pun.

- [ ] **Step 5: Commit akhir & push**

```bash
git add -A docs/superpowers/plans
git commit -m "docs(spec-516): centang plan"
git push origin HEAD:refs/heads/hanoman/spec-516
```
