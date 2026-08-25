# SPEC-945 — Fondasi Tim: entity `Task` & `Member` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Dua entity baru — `Member` (direktori orang, global) dan `Task` (kartu kerja manusia) — yang ikut sync penuh, punya route CRUD ber-zod, dan satu topik realtime berparameter. Tanpa UI.

**Architecture:** Model Prisma baru + migration tulis-tangan, lalu pendaftaran di delapan daftar tulis-tangan yang mengelilingi mesin sync (`SYNCED`/`DELEGATE`/`FIELDS`/`DATE`/`NUMBER`/`BOOLEAN`/`PARENTS`/`BOOTSTRAP_ORDER`) plus `PG_ORDER` di CLI. Kontrak murni (zod + view) hidup di `shared/src/team.ts` supaya server, topik siar, dan UI item B memakai satu sumber. `buildTasksPage` di `services/tasks-list.ts` dipakai bersama oleh `GET /api/tasks` dan topik `tasks` — cermin `tickets-list.ts`.

**Tech Stack:** TypeScript strict, Fastify, Prisma 6 (SQLite), zod, vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-spec-945-fondasi-tim-design.md`
**Induk:** `docs/superpowers/specs/2026-08-25-tim-kanban-gantt-design.md` (item A dari lima)

## Global Constraints

- Bahasa komentar & pesan error: **Indonesia**, mengikuti berkas sekitarnya.
- TypeScript strict. Tak ada `any` baru.
- **Test server WAJIB pakai DB terisolasi**: setiap perintah vitest diawali `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan diakhiri `--no-file-parallelism`. Tanpa keduanya suite gagal ramai 404/P2022 karena worktree tetangga menghapus DB bersama di tengah run (SPEC-479).
- Migration **ditulis tangan**, bukan `prisma migrate dev` — `migrate dev` me-reset DB saat ada drift worktree. Sesudah menulis `migration.sql`, jalankan `pnpm db:generate` supaya `Prisma.dmmf` & client memuat model baru.
- `internal/docs` yang tersentuh diperbarui **dalam commit yang sama** dan ditautkan di `internal/docs/README.md`.
- Nomor ADR final dikonfirmasi saat commit (nomor pernah bertabrakan antar-worktree). Rencana ini memakai **ADR-0150**.
- **`GROUPS` di `server/src/services/events.ts` TIDAK BOLEH disentuh.** Papan tim adalah topik berparameter di `events-topics.ts`, bukan grup global ke-11.
- **`shared/src/webhook.ts` TIDAK BOLEH disentuh.** Termasuk `cascade` pada entri `project` — alasannya di spec, bagian "Yang sengaja TIDAK diubah".
- **`clientRouteAllowed` dan `capabilityForRoute` TIDAK BOLEH ditambahi entri.** Keduanya deny-by-default; yang ditambahkan hanya **test** yang membuktikannya.

### Penyimpangan yang disengaja dari dokumen induk

Dokumen induk menulis `priority String @default("normal")`. Repo ini sudah punya satu kosakata prioritas: `zPriority = z.enum(["tinggi","sedang","rendah"])` (`shared/src/enums.ts:9`), dipakai `Spec`, PRD, dan tiket. `"normal"` bukan anggotanya. Rencana ini **memakai `zPriority` dengan default `"sedang"`** — kartu tim duduk bersebelahan dengan backlog item di layar yang sama, dan dua kosakata untuk satu konsep adalah cara keduanya mulai berbeda. Dicatat di ADR-0150 sebagai amandemen kecil atas dokumen induk.

## File Structure

| Berkas | Tanggung jawab | Status |
|---|---|---|
| `server/prisma/schema.prisma` | model `Member` + `Task`, relasi `Project.tasks` | ubah |
| `server/prisma/migrations/20260825120000_team_member_task/migration.sql` | dua `CREATE TABLE` + indeks | **baru** |
| `cli/src/commands/migrate-pg.ts` | `PG_ORDER` memuat `Member` & `Task` | ubah |
| `shared/src/team.ts` | kontrak murni: `TASK_STATUSES`, `memberId()`, zod create/patch, `MemberView`/`TaskView` | **baru** |
| `shared/src/index.ts` | re-export `./team` | ubah |
| `shared/src/api.ts` | entri `paths` untuk members & tasks | ubah |
| `shared/src/dto.ts` | `EventTopic`, `zTopicParams.tasks`, varian `EventMsg` `tasks` | ubah |
| `server/src/services/sync.ts` | delapan daftar pendaftaran entity | ubah |
| `server/src/services/tasks-list.ts` | `taskView`, `buildTasksPage` — dipakai route DAN topik | **baru** |
| `server/src/services/events-topics.ts` | entri `TOPICS.tasks` | ubah |
| `server/src/routes/members.ts` | CRUD `/api/members` | **baru** |
| `server/src/routes/tasks.ts` | CRUD `/api/tasks` | **baru** |
| `server/src/app.ts` | dua `api.register` | ubah |
| `server/test/factory.ts` | `resetDb()` menyapu `task` & `member` | ubah |
| `server/test/team-schema.test.ts` | kontrak skema + sync + PG_ORDER | **baru** |
| `server/test/members.route.test.ts` | route members | **baru** |
| `server/test/tasks.route.test.ts` | route tasks | **baru** |
| `server/test/team-topic.test.ts` | topik realtime `tasks` | **baru** |
| `server/test/sync-exclusions.test.ts` | snapshot `SYNCED` diperbarui | ubah |
| `server/test/client-route-allowed.test.ts` | dua path baru ikut daftar tertutup | ubah |
| `server/test/agent-capabilities.test.ts` | dua path baru cookie-only bagi agent token | ubah |
| `shared/src/team.test.ts` | unit kontrak murni | **baru** |
| `internal/docs/adr/0150-fondasi-papan-tim-task-member.md` | ADR | **baru** |
| `internal/docs/architecture/data-model.md` | seksi `Member`/`Task` | ubah |
| `internal/docs/architecture/api-contract.md` | seksi route Tim | ubah |
| `internal/docs/README.md` | tautan ADR-0150 | ubah |

---

### Task 1: Skema Prisma, migration, dan `PG_ORDER`

**Files:**
- Modify: `server/prisma/schema.prisma` (tambah dua model; tambah `tasks Task[]` ke `Project`)
- Create: `server/prisma/migrations/20260825120000_team_member_task/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts:16-54` (`PG_ORDER`)
- Modify: `server/test/factory.ts:149-156` (`resetDb`)
- Test: `server/test/team-schema.test.ts` (bagian skema)

**Interfaces:**
- Produces: model Prisma `Member` & `Task`, delegate `prisma.member` & `prisma.task`. Dipakai Task 3, 4, 5, 6.
- Produces: `PG_ORDER` memuat `"Member"` sebelum `"Task"`, keduanya sesudah `"Project"`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/team-schema.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";
import { resetDb, makeProject } from "./factory";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const colsOf = (n: string) => new Set(models.get(n)!.fields.filter((f) => f.kind !== "object").map((f) => f.name));

describe("SPEC-945 · ADR-0150 · model Member & Task", () => {
  it("Member punya kolom yang dijanjikan spec, termasuk `version` (ikut sync)", () => {
    expect(colsOf("Member")).toEqual(
      new Set(["id", "name", "email", "role", "active", "version", "createdAt", "updatedAt"]));
  });

  it("Task punya kolom yang dijanjikan spec, termasuk `version` (ikut sync)", () => {
    expect(colsOf("Task")).toEqual(new Set([
      "id", "projectId", "title", "detail", "status", "priority", "memberId",
      "startDate", "dueDate", "order", "specId", "version", "createdAt", "updatedAt"]));
  });

  // ADR-0090 · stage backlog TIDAK disimpan di Task — ia dihitung saat baca lewat join specId.
  // Kolom kedua hanya menciptakan dua kebenaran yang bisa drift.
  it("Task TIDAK punya kolom stage maupun doneAt", () => {
    const c = colsOf("Task");
    expect(c.has("stage")).toBe(false);
    expect(c.has("doneAt")).toBe(false);
  });

  // Cermin Ticket.specId (ADR-0062): changefeed bisa memancarkan Task sebelum Spec-nya mendarat
  // (kelas SPEC-382) dan FK akan menolaknya.
  it("Task.specId TANPA relasi FK", () => {
    const rel = models.get("Task")!.fields.filter((f) => f.kind === "object");
    expect(rel.flatMap((f) => f.relationFromFields ?? [])).toEqual(
      expect.arrayContaining(["projectId", "memberId"]));
    expect(rel.flatMap((f) => f.relationFromFields ?? [])).not.toContain("specId");
  });

  it("PG_ORDER memuat Member sebelum Task, keduanya sesudah Project", () => {
    expect(PG_ORDER).toContain("Member");
    expect(PG_ORDER).toContain("Task");
    expect(PG_ORDER.indexOf("Member")).toBeLessThan(PG_ORDER.indexOf("Task"));
    expect(PG_ORDER.indexOf("Task")).toBeGreaterThan(PG_ORDER.indexOf("Project"));
  });

  it("task ikut terhapus saat project-nya dihapus (cascade)", async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await prisma.task.create({ data: { id: "t1", projectId: "p1", title: "Desain", status: "backlog" } });
    await prisma.project.delete({ where: { id: "p1" } });
    expect(await prisma.task.count()).toBe(0);
  });

  // onDelete: SetNull — menghapus anggota TIDAK ikut menghapus pekerjaannya.
  it("task jadi belum-ditugaskan saat anggotanya dihapus (SetNull)", async () => {
    await resetDb();
    await prisma.member.create({ data: { id: "a@x.id", name: "A", email: "a@x.id" } });
    await prisma.task.create({ data: { id: "t1", title: "Nego", status: "doing", memberId: "a@x.id" } });
    await prisma.member.delete({ where: { id: "a@x.id" } });
    const t = await prisma.task.findUnique({ where: { id: "t1" } });
    expect(t).not.toBeNull();
    expect(t!.memberId).toBeNull();
  });

  // projectId nullable = tugas internal tim, tanpa project.
  it("task boleh tanpa project", async () => {
    await resetDb();
    const t = await prisma.task.create({ data: { id: "t9", title: "Rapat internal", status: "backlog" } });
    expect(t.projectId).toBeNull();
    expect(t.priority).toBe("sedang");
    expect(t.order).toBe(0);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/team-schema.test.ts
```

Expected: FAIL — `Cannot read properties of undefined (reading 'fields')` pada `models.get("Member")!` (model belum ada di DMMF).

- [x] **Step 3: Tambah model ke `schema.prisma`**

Di `server/prisma/schema.prisma`, pada `model Project` tambahkan satu baris relasi di antara `portalChats` dan penutup blok:

```prisma
  tasks        Task[]                // SPEC-945 · ADR-0150 · kartu kerja manusia di project ini
```

Lalu tambahkan dua model **sesudah** `model CustomAgent` (yang polanya ditiru):

```prisma
// SPEC-945 · ADR-0150 · direktori orang untuk papan tim. GLOBAL, bukan per project: Task boleh
// tanpa project, jadi direktori orang tak bisa digantung pada project — dan orang yang sama lazim
// melintasi beberapa project.
//
// `id` DETERMINISTIK dari email ternormalisasi (lowercase + trim) ditulis aplikasi, bukan default
// DB — alasan yang sama dengan CustomAgent (ADR-0094): dengan id acak, dua mesin yang sama-sama
// membuat "Dena" melahirkan dua baris yang keduanya menyeberang changefeed, dan salah satunya
// lenyap tanpa jejak begitu papan menyaring per-assignee.
//
// Konsekuensinya `email` IMMUTABLE, ditegakkan di boundary route: ganti email = hapus + buat baru.
// `@unique` di sini bukan redundansi terhadap PK — id menyimpan bentuk ternormalisasi, kolom ini
// menyimpan yang diketik operator.
model Member {
  id        String   @id
  name      String
  email     String   @unique
  role      String?  // label bebas: "desainer", "backend" — BUKAN RBAC
  active    Boolean  @default(true)
  version   Int      @default(0) // SPEC-213 · version-stamp sync (ADR-0045)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tasks     Task[]
}

// SPEC-945 · ADR-0150 · satuan kerja MANUSIA. Bukan Spec: kolomnya milik manusia dan bebas
// di-drag, sementara `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024).
//
// `specId` sengaja TANPA FK (cermin Ticket.specId, ADR-0062): changefeed bisa memancarkan Task
// sebelum Spec-nya mendarat (kelas SPEC-382) dan FK akan menolaknya.
//
// TIDAK ada kolom `stage`: cermin stage backlog dihitung saat baca lewat join specId → Spec.stage.
// Aturan ADR-0090 bukan "selalu simpan" melainkan bisakah dihitung ulang dari sumber lain; di sini
// bisa, jadi kolom kedua hanya menciptakan dua kebenaran yang bisa drift.
//
// TIDAK ada `doneAt` dan tak ada stempel transisi kolom: Gantt yang dipilih rencana-saja, jadi
// tanggal aktual belum punya pembaca. Dihilangkan dengan sengaja, bukan terlupa.
//
// `order` Float, bukan Int: drop di antara dua kartu menulis titik tengah tetangganya — tak ada
// reindex seluruh kolom, dan dua mesin yang menulis bersamaan menghasilkan nilai yang tetap
// terurut. Seri dipecah oleh `id`.
model Task {
  id        String    @id @default(cuid())
  projectId String?   // null = tugas internal tim, tanpa project
  title     String
  detail    String?
  status    String    // backlog | doing | review | done (zTaskStatus)
  priority  String    @default("sedang") // zPriority — kosakata yang sama dengan Spec
  memberId  String?   // null = belum ditugaskan
  startDate DateTime?
  dueDate   DateTime?
  order     Float     @default(0)
  specId    String?   // soft-link Spec hasil eskalasi (item C)
  version   Int       @default(0) // SPEC-213 · version-stamp sync (ADR-0045)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  project   Project?  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  member    Member?   @relation(fields: [memberId], references: [id], onDelete: SetNull)

  @@index([projectId, status])
  @@index([memberId])
}
```

- [x] **Step 4: Tulis migration tangan**

Buat `server/prisma/migrations/20260825120000_team_member_task/migration.sql`:

```sql
-- SPEC-945 · ADR-0150 · fondasi papan tim: direktori orang + kartu kerja manusia.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — dua tabel BARU, tak ada tabel diredefinisi, tanpa backfill.
--
-- `Member.id` deterministik (email ternormalisasi) ditulis aplikasi, bukan default DB: itulah yang
-- mencegah dua mesin melahirkan dua baris untuk orang yang sama (pola CustomAgent, ADR-0094).
-- `Task.specId` sengaja TANPA FOREIGN KEY, cermin Ticket.specId: changefeed bisa memancarkan Task
-- sebelum Spec-nya mendarat (kelas SPEC-382), dan FK akan menolaknya.
CREATE TABLE "Member" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "name"      TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "role"      TEXT,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "version"   INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Member_email_key" ON "Member" ("email");

CREATE TABLE "Task" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "title"     TEXT NOT NULL,
    "detail"    TEXT,
    "status"    TEXT NOT NULL,
    "priority"  TEXT NOT NULL DEFAULT 'sedang',
    "memberId"  TEXT,
    "startDate" DATETIME,
    "dueDate"   DATETIME,
    "order"     REAL NOT NULL DEFAULT 0,
    "specId"    TEXT,
    "version"   INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_memberId_fkey" FOREIGN KEY ("memberId")
        REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Task_projectId_status_idx" ON "Task" ("projectId", "status");
CREATE INDEX "Task_memberId_idx" ON "Task" ("memberId");
```

- [x] **Step 5: Tambah ke `PG_ORDER`**

Di `cli/src/commands/migrate-pg.ts`, sesudah baris `"GithubIssue",` (±:51) sisipkan:

```ts
  // SPEC-945 · ADR-0150 · Member SEBELUM Task (FK memberId, SetNull) dan Task sesudah Project
  // (FK projectId, cascade). `Task.specId` memang tanpa FK, tapi urutan tabel tetap harus
  // mencerminkan arah tautannya bagi pembaca berikutnya.
  "Member", "Task",
```

- [x] **Step 6: `resetDb()` menyapu tabel baru**

Di `server/test/factory.ts`, di dalam `prisma.$transaction([...])` pada `resetDb()`, tambahkan **sebelum** `prisma.spec.deleteMany()`:

```ts
    prisma.task.deleteMany(),     // SPEC-945 · ADR-0150 · sebelum member (FK memberId)
    prisma.member.deleteMany(),
```

- [x] **Step 7: Generate client & jalankan test**

```bash
pnpm db:generate
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/team-schema.test.ts cli/test/migrate-pg.test.ts
```

Expected: PASS semua. `cli/test/migrate-pg.test.ts` membuktikan `PG_ORDER` memuat setiap model DMMF tepat sekali dan urutan FK-nya sah.

- [x] **Step 8: Commit**

```bash
git add server/prisma cli/src/commands/migrate-pg.ts server/test/factory.ts server/test/team-schema.test.ts
git commit -m "feat(945): model Member & Task + migration + PG_ORDER"
```

---

### Task 2: Kontrak murni `shared/src/team.ts`

**Files:**
- Create: `shared/src/team.ts`
- Create: `shared/src/team.test.ts`
- Modify: `shared/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `zPriority` dari `./enums`, `zStage` dari `./enums`.
- Produces:
  - `TASK_STATUSES: readonly ["backlog","doing","review","done"]`, `type TaskStatus`, `zTaskStatus`
  - `memberId(email: string): string`
  - `zCreateMember`, `zPatchMember`, `type MemberView`
  - `zCreateTask`, `zPatchTask`, `type TaskView`
  - Dipakai Task 4, 5, 6, 7.

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/team.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { memberId, zCreateMember, zPatchMember, zCreateTask, zPatchTask, TASK_STATUSES } from "./team";

describe("SPEC-945 · memberId deterministik", () => {
  it("menormalkan kapitalisasi & spasi tepi", () => {
    expect(memberId("  Dena@Nafanesia.ID ")).toBe("dena@nafanesia.id");
  });
  it("dua ejaan email yang sama menghasilkan id yang sama", () => {
    expect(memberId("A@B.id")).toBe(memberId("a@b.id "));
  });
});

describe("zCreateMember", () => {
  it("menerima nama, email, role opsional", () => {
    const r = zCreateMember.safeParse({ name: "Dena", email: " Dena@X.id " });
    expect(r.success).toBe(true);
    expect(r.success && r.data.email).toBe("Dena@X.id");   // trim, TANPA lowercase — id yang menormalkan
  });
  it("menolak email cacat", () => {
    expect(zCreateMember.safeParse({ name: "D", email: "bukan-email" }).success).toBe(false);
  });
  it("menolak nama kosong", () => {
    expect(zCreateMember.safeParse({ name: "  ", email: "a@b.id" }).success).toBe(false);
  });
});

describe("zPatchMember", () => {
  // ADR-0094 keputusan 2 · id diturunkan dari email; rename yang mengubah id meninggalkan baris
  // yatim di setiap mesin lain. Lapis kedua (penolakan eksplisit di route) ada di Task 5.
  it("TIDAK punya field email — ganti email = hapus + buat baru", () => {
    const r = zPatchMember.safeParse({ email: "baru@x.id" });
    expect(r.success).toBe(true);
    expect(r.success && "email" in r.data).toBe(false);
  });
  it("semua field opsional", () => {
    expect(zPatchMember.safeParse({}).success).toBe(true);
    expect(zPatchMember.safeParse({ name: "D", role: null, active: false }).success).toBe(true);
  });
});

describe("zCreateTask", () => {
  it("hanya title yang wajib; status default backlog", () => {
    const r = zCreateTask.safeParse({ title: "Desain landing" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.status).toBe("backlog");
    expect(r.success && r.data.priority).toBe("sedang");
  });
  it("empat kolom papan, tak lebih", () => {
    expect(TASK_STATUSES).toEqual(["backlog", "doing", "review", "done"]);
    expect(zCreateTask.safeParse({ title: "x", status: "executing" }).success).toBe(false);
  });
  it("tanggal diterima sebagai ISO string", () => {
    const r = zCreateTask.safeParse({ title: "x", startDate: "2026-09-01T00:00:00.000Z" });
    expect(r.success).toBe(true);
  });
  it("menolak tanggal yang bukan tanggal", () => {
    expect(zCreateTask.safeParse({ title: "x", dueDate: "besok" }).success).toBe(false);
  });
  // specId TIDAK bisa diset lewat CRUD: tautan itu lahir dari eskalasi (item C), bukan ketikan.
  it("specId bukan field yang bisa ditulis", () => {
    const r = zCreateTask.safeParse({ title: "x", specId: "SPEC-1" });
    expect(r.success && "specId" in r.data).toBe(false);
  });
});

describe("zPatchTask", () => {
  it("semua field opsional, termasuk status & order untuk drop kanban", () => {
    expect(zPatchTask.safeParse({ status: "doing", order: 1.5 }).success).toBe(true);
    expect(zPatchTask.safeParse({}).success).toBe(true);
  });
  it("memberId & projectId boleh dikosongkan eksplisit", () => {
    const r = zPatchTask.safeParse({ memberId: null, projectId: null });
    expect(r.success).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run shared/src/team.test.ts
```

Expected: FAIL — `Failed to resolve import "./team"`.

- [x] **Step 3: Tulis `shared/src/team.ts`**

```ts
import { z } from "zod";
import { zPriority, zStage } from "./enums";

// SPEC-945 · ADR-0150 · kontrak murni papan tim. Nol I/O: dipakai server (validasi route +
// serialisasi), topik siar, dan UI (bentuk form) dari satu sumber.

/**
 * Empat kolom papan, tetap. Milik MANUSIA — beda dari `Spec.stage` yang diturunkan dari fase sesi
 * (ADR-0008/0024) dan karena itu hampir seluruhnya menolak drag.
 */
export const TASK_STATUSES = ["backlog", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const zTaskStatus = z.enum(TASK_STATUSES);

/**
 * ADR-0094 · id deterministik dari email ternormalisasi. Dengan id acak, dua mesin yang sama-sama
 * membuat orang yang sama melahirkan dua baris yang keduanya menyeberang changefeed, dan salah
 * satunya lenyap tanpa jejak begitu papan menyaring per-assignee.
 */
export const memberId = (email: string): string => email.trim().toLowerCase();

const zEmail = z.string().trim().min(3).max(200).email();
const zName = z.string().trim().min(1).max(120);
/** ISO 8601 yang benar-benar bisa di-`new Date()`. `z.coerce.date()` menerima "besok" sebagai Invalid Date. */
const zIso = z.string().datetime({ offset: true });

export const zCreateMember = z.object({
  name: zName,
  email: zEmail,
  role: z.string().trim().max(60).nullable().optional(),
});
export type CreateMember = z.infer<typeof zCreateMember>;

// `email` sengaja DI LUAR skema patch: id diturunkan darinya, dan changefeed sync tak punya
// operasi rename — id yang berubah meninggalkan baris yatim di setiap mesin lain (ADR-0094
// keputusan 2). Ditolak EKSPLISIT di route juga; `.omit()` sendirian membuangnya senyap.
export const zPatchMember = zCreateMember.omit({ email: true }).partial().extend({
  active: z.boolean().optional(),
});
export type PatchMember = z.infer<typeof zPatchMember>;

export type MemberView = {
  id: string; name: string; email: string; role: string | null; active: boolean;
  createdAt: string; updatedAt: string;
};

export const zCreateTask = z.object({
  title: z.string().trim().min(1).max(300),
  detail: z.string().max(20_000).nullable().optional(),
  projectId: z.string().max(120).nullable().optional(),
  status: zTaskStatus.default("backlog"),
  priority: zPriority.default("sedang"),
  memberId: z.string().max(200).nullable().optional(),
  startDate: zIso.nullable().optional(),
  dueDate: zIso.nullable().optional(),
  order: z.number().finite().optional(),
});
export type CreateTask = z.infer<typeof zCreateTask>;

// `specId` TIDAK ada di sini maupun di patch: tautan ke backlog lahir dari eskalasi (item C),
// bukan dari ketikan operator. CRUD yang bisa mengarangnya berarti kartu bisa mengaku tertaut
// pada Spec yang tak pernah menyetujuinya.
export const zPatchTask = zCreateTask.partial();
export type PatchTask = z.infer<typeof zPatchTask>;

/** Cermin backlog, BACA-SAJA — dihitung saat baca lewat join `specId`, tak pernah ditulis balik. */
export type TaskSpecMirror = { id: string; stage: z.infer<typeof zStage>; priority: string };

export type TaskView = {
  id: string; projectId: string | null; title: string; detail: string | null;
  status: TaskStatus; priority: string; memberId: string | null;
  startDate: string | null; dueDate: string | null; order: number;
  /** Tetap terisi meski `spec` null — bedanya itulah yang membuat UI bisa merender "tautan putus". */
  specId: string | null;
  spec: TaskSpecMirror | null;
  createdAt: string; updatedAt: string;
};
```

- [x] **Step 4: Re-export dari index**

Di `shared/src/index.ts`, tambahkan sesudah `export * from "./presence";`:

```ts
export * from "./team";
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/team.test.ts
```

Expected: PASS (16 test).

- [x] **Step 6: Commit**

```bash
git add shared/src/team.ts shared/src/team.test.ts shared/src/index.ts
git commit -m "feat(945): kontrak murni papan tim di shared/src/team.ts"
```

---

### Task 3: Pendaftaran sync lengkap

**Files:**
- Modify: `server/src/services/sync.ts:17` (`SYNCED`), `:26-35` (`DELEGATE`), `:40-83` (`FIELDS`), `:85-92` (`DATE_FIELDS`), `:102-108` (`PARENTS`), `:115-118` (`NUMBER_FIELDS`/`BOOLEAN_FIELDS`), `:352-355` (`BOOTSTRAP_ORDER`)
- Modify: `server/test/sync-exclusions.test.ts:20-27`
- Test: `server/test/team-schema.test.ts` (bagian sync — ditambahkan ke berkas Task 1)

**Interfaces:**
- Consumes: model `Member`/`Task` dari Task 1.
- Produces: `Entity` union memuat `"member" | "task"`. Dipakai Task 5 & 6 (`notifySynced`/`deleteSynced`).

- [x] **Step 1: Tulis test yang gagal**

Di `server/test/team-schema.test.ts`, tambahkan **satu baris ke blok impor di kepala berkas** (bukan di akhir — impor yang tercecer di bawah kode terbaca seperti kekeliruan meski ESM meng-hoist-nya):

```ts
import { SYNCED, PARENTS, BOOTSTRAP_ORDER, __FIELDS, __DATE_FIELDS } from "../src/services/sync";
```

Lalu tambahkan ke **akhir** berkas:

```ts
// Kolom bermakna — `id` (PK, di where) & `version` (stempel mekanisme sync) dikecualikan.
// Dibandingkan dengan `toEqual` atas himpunan DMMF, bukan `toContain` per kolom: yang terakhir
// lolos untuk kolom yang belum pernah terpikirkan, dan kolom yang terlewat di FIELDS mendarat
// sebagai null palsu di tiap client TANPA satu pun error (kelas ADR-0090/0093/0105).
const meaningful = (model: string): string[] =>
  [...colsOf(model)].filter((c) => c !== "id" && c !== "version").sort();

describe("SPEC-945 · member & task ikut record-sync", () => {
  it("keduanya terdaftar di SYNCED", () => {
    expect(SYNCED as readonly string[]).toContain("member");
    expect(SYNCED as readonly string[]).toContain("task");
  });

  it("FIELDS.member = SETIAP kolom bermakna Member, tak lebih tak kurang", () => {
    expect([...__FIELDS.member].sort()).toEqual(meaningful("Member"));
  });

  it("FIELDS.task = SETIAP kolom bermakna Task, tak lebih tak kurang", () => {
    expect([...__FIELDS.task].sort()).toEqual(meaningful("Task"));
  });

  it("DATE_FIELDS memuat setiap kolom DateTime kedua model", () => {
    expect([...__DATE_FIELDS.member].sort()).toEqual(["createdAt", "updatedAt"]);
    expect([...__DATE_FIELDS.task].sort()).toEqual(["createdAt", "dueDate", "startDate", "updatedAt"]);
  });

  it("PARENTS.task memuat KEDUA induknya", () => {
    expect(PARENTS.task).toEqual(expect.arrayContaining([
      { field: "projectId", entity: "project" },
      { field: "memberId", entity: "member" },
    ]));
  });

  it("member TIDAK punya induk — direktori orang global, bukan anak project", () => {
    expect(PARENTS.member).toBeUndefined();
  });

  // Kelas SPEC-885 "lupa vps": urutan yang salah bootstrap SUKSES tanpa error, tapi assignee kosong.
  it("BOOTSTRAP_ORDER menaruh member SEBELUM task", () => {
    expect(BOOTSTRAP_ORDER.indexOf("member")).toBeGreaterThanOrEqual(0);
    expect(BOOTSTRAP_ORDER.indexOf("member")).toBeLessThan(BOOTSTRAP_ORDER.indexOf("task"));
  });
});
```

Perbarui juga `server/test/sync-exclusions.test.ts:20-27` — snapshot literalnya akan merah:

```ts
  it("SYNCED is exactly the authoritative entities (SPEC-272: +ticketAttachment; SPEC-384: −errorGroup; SPEC-450: +customAgent; SPEC-471: +githubIssue; SPEC-945: +member, +task)", () => {
    // SPEC-450 · ADR-0094 · `customAgent` ikut menyeberang: katalog persona adalah pengetahuan
    // bersama, dan id-nya deterministik justru supaya dua mesin yang membuat nama sama bertemu
    // sebagai SATU baris di sini, bukan dua yang saling menelan di objek JSON berkunci nama.
    // SPEC-471 · ADR-0095 · `githubIssue` mengikuti pola yang sama: cermin issue + keputusan
    // triase-nya adalah pengetahuan bersama, id-nya deterministik "<projectId>:<slug>#<n>".
    // SPEC-945 · ADR-0150 · `member` & `task` ikut: papan tim adalah pengetahuan bersama, dan
    // `Member.id` deterministik dari email dengan alasan yang sama persis.
    expect([...SYNCED].sort()).toEqual(
      ["customAgent", "githubIssue", "member", "project", "sessionResult", "spec", "task", "ticket", "ticketAttachment", "vps"],
    );
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/team-schema.test.ts server/test/sync-exclusions.test.ts
```

Expected: FAIL — `expected [ … ] to contain 'member'` dan `__FIELDS.member` `undefined`.

- [x] **Step 3: Daftarkan di `sync.ts`**

**a.** `SYNCED` (`:17`) — tambahkan komentar di atasnya lalu dua entri:

```ts
// SPEC-945 · ADR-0150 · `member` & `task` ikut menyeberang: papan kerja tim adalah pengetahuan
// bersama, bukan setelan mesin. `Member.id` deterministik (email ternormalisasi) justru supaya dua
// mesin yang mencatat orang yang sama bertemu sebagai SATU baris di sini.
export const SYNCED = ["project", "spec", "vps", "sessionResult", "ticket", "ticketAttachment", "customAgent", "githubIssue", "member", "task"] as const;
```

**b.** `DELEGATE` (`:26-35`) — dua entri sesudah `githubIssue`:

```ts
  member: prisma.member as unknown as Delegate,
  task: prisma.task as unknown as Delegate,
```

**c.** `FIELDS` (`:40-83`) — sesudah entri `githubIssue`:

```ts
  // SPEC-945 · ADR-0150 · SELURUH kolom bermakna ikut menyeberang. `active` wajib ada: `upsert`
  // yang tak menyebut kolom ber-default TETAP berhasil, jadi anggota nonaktif akan hidup lagi di
  // setiap mesin lain tanpa satu pun error (kelas ADR-0090/0093/0105). `email` ikut meski id sudah
  // diturunkan darinya — id menyimpan bentuk ternormalisasi, kolom ini yang diketik operator.
  member: ["name", "email", "role", "active", "createdAt", "updatedAt"],
  // `specId` ikut: tautan eskalasi adalah bagian keadaan yang harus dilihat sama oleh semua mesin —
  // tanpa itu satu mesin bisa mengeskalasi ulang kartu yang di mesin lain sudah jadi backlog
  // (cermin githubIssue.specId). `order` ikut supaya urutan kolom tidak acak di mesin lain.
  task: ["projectId", "title", "detail", "status", "priority", "memberId", "startDate", "dueDate",
    "order", "specId", "createdAt", "updatedAt"],
```

**d.** `DATE_FIELDS` (`:85-92`) — dua entri:

```ts
  member: ["createdAt", "updatedAt"],
  task: ["startDate", "dueDate", "createdAt", "updatedAt"],
```

**e.** `PARENTS` (`:102-108`) — satu entri (`member` sengaja absen, ia tak punya FK):

```ts
  // SPEC-945 · ADR-0150 · DUA induk. `projectId` nullable (cermin customAgent) dan `memberId`
  // nullable juga — `parentTombstoned` melewati nilai kosong, jadi nullable aman apa adanya.
  // `member` sendiri sengaja ABSEN: direktori orang global, tanpa satu pun FK keluar.
  task: [{ field: "projectId", entity: "project" }, { field: "memberId", entity: "member" }],
```

**f.** `NUMBER_FIELDS` & `BOOLEAN_FIELDS` (`:115-118`):

```ts
const NUMBER_FIELDS = new Set([
  "vps:port", "ticket:number", "ticketAttachment:size", "githubIssue:number",
  // SPEC-945 · tanpa ini urutan kartu di kolom jadi acak di mesin lain.
  "task:order",
]);
const BOOLEAN_FIELDS = new Set(["vps:hardened", "customAgent:enabled", "member:active"]);
```

**g.** `BOOTSTRAP_ORDER` (`:352-355`) — `member` sebelum `task`:

```ts
export const BOOTSTRAP_ORDER: Entity[] = [
  "project", "spec", "ticket", "customAgent", "githubIssue", "ticketAttachment",
  // SPEC-945 · ADR-0150 · `member` WAJIB mendahului `task` (FK memberId). Urutan yang salah
  // bootstrap SUKSES tanpa error tapi assignee kosong — kelas SPEC-885 "lupa vps".
  "member", "task",
  "vps", "sessionResult",
];
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/team-schema.test.ts server/test/sync-exclusions.test.ts \
  server/test/sync-parents-dmmf.test.ts server/test/sync-bootstrap.test.ts
```

Expected: PASS semua empat berkas.

- [x] **Step 5: Typecheck**

```bash
pnpm --filter ./server typecheck
```

Expected: nol error. (`DELEGATE`/`FIELDS`/`DATE_FIELDS` ber-`Record<Entity,…>`, jadi entri yang terlewat justru ditangkap di sini.)

- [x] **Step 6: Commit**

```bash
git add server/src/services/sync.ts server/test/team-schema.test.ts server/test/sync-exclusions.test.ts
git commit -m "feat(945): daftarkan member & task ke mesin sync"
```

---

### Task 4: `services/tasks-list.ts` — view & halaman, dipakai bersama

**Files:**
- Create: `server/src/services/tasks-list.ts`
- Test: `server/test/tasks.route.test.ts` (dibuat di Task 6; di sini hanya dipanggil langsung)

**Interfaces:**
- Consumes: `TaskView`, `TaskStatus` dari `@hanoman/shared` (Task 2); `paginate` dari `./paginate`.
- Produces:
  - `taskView(t: Task, spec: TaskSpecMirror | null): TaskView`
  - `buildTasksPage(f: { projectId?: string; status?: string; memberId?: string; page?: number; limit?: number }): Promise<Paginated<TaskView>>`
  - Dipakai Task 6 (route) dan Task 7 (topik).

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/tasks-list.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { buildTasksPage } from "../src/services/tasks-list";
import { resetDb, makeProject, makeSpec } from "./factory";

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "executing", priority: "tinggi" });
  await prisma.member.create({ data: { id: "a@x.id", name: "A", email: "a@x.id" } });
  await prisma.task.create({ data: { id: "t1", projectId: "p1", title: "Desain", status: "backlog", order: 2 } });
  await prisma.task.create({ data: { id: "t2", projectId: "p1", title: "Deploy", status: "doing", order: 1, memberId: "a@x.id", specId: "SPEC-1" } });
  await prisma.task.create({ data: { id: "t3", title: "Rapat", status: "backlog", order: 0 } });
});

describe("buildTasksPage", () => {
  it("mengurutkan menaik menurut `order`, seri dipecah id", async () => {
    const p = await buildTasksPage({});
    expect(p.items.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
    expect(p.total).toBe(3);
  });

  it("filter projectId; tugas tanpa project tidak ikut", async () => {
    const p = await buildTasksPage({ projectId: "p1" });
    expect(p.items.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("filter status & memberId", async () => {
    expect((await buildTasksPage({ status: "doing" })).items.map((t) => t.id)).toEqual(["t2"]);
    expect((await buildTasksPage({ memberId: "a@x.id" })).items.map((t) => t.id)).toEqual(["t2"]);
  });

  // Cermin backlog dihitung saat baca — tak ada kolom `stage` di Task (ADR-0090).
  it("menyertakan cermin spec hasil join specId", async () => {
    const t2 = (await buildTasksPage({ status: "doing" })).items[0]!;
    expect(t2.specId).toBe("SPEC-1");
    expect(t2.spec).toEqual({ id: "SPEC-1", stage: "executing", priority: "tinggi" });
  });

  it("task tanpa specId punya spec null", async () => {
    const t1 = (await buildTasksPage({ status: "backlog", projectId: "p1" })).items[0]!;
    expect(t1.specId).toBeNull();
    expect(t1.spec).toBeNull();
  });

  // Tautan putus: specId TETAP terisi, spec null. Bedanya itulah yang membuat UI bisa merender
  // "tautan putus" alih-alih diam (item C).
  it("specId yang menunjuk Spec terhapus → spec null, specId tetap terisi", async () => {
    await prisma.spec.delete({ where: { id: "SPEC-1" } });
    const t2 = (await buildTasksPage({ status: "doing" })).items[0]!;
    expect(t2.specId).toBe("SPEC-1");
    expect(t2.spec).toBeNull();
  });

  it("paginasi ADR-0107: tanpa limit → seluruh item satu halaman", async () => {
    const all = await buildTasksPage({});
    expect(all).toMatchObject({ page: 1, pageSize: 3, total: 3 });
    const p2 = await buildTasksPage({ page: 2, limit: 2 });
    expect(p2.items.map((t) => t.id)).toEqual(["t1"]);
    expect(p2).toMatchObject({ page: 2, pageSize: 2, total: 3 });
  });

  it("tanggal disajikan ISO string, bukan Date", async () => {
    await prisma.task.update({ where: { id: "t1" }, data: { dueDate: new Date("2026-09-01T00:00:00.000Z") } });
    const t1 = (await buildTasksPage({ projectId: "p1", status: "backlog" })).items[0]!;
    expect(t1.dueDate).toBe("2026-09-01T00:00:00.000Z");
    expect(t1.startDate).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks-list.test.ts
```

Expected: FAIL — `Cannot find module '../src/services/tasks-list'`.

- [x] **Step 3: Tulis `server/src/services/tasks-list.ts`**

```ts
import type { Task } from "@prisma/client";
import type { Paginated, TaskSpecMirror, TaskStatus, TaskView } from "@hanoman/shared";
import { prisma } from "../db";
import { paginate } from "./paginate";

// SPEC-945 · ADR-0150 · satu definisi untuk GET /tasks dan topik siar `tasks`. Menyalinnya ke hub
// berarti dua serializer yang bisa berselisih diam-diam (pelajaran SPEC-908 · tickets-list.ts).

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const taskView = (t: Task, spec: TaskSpecMirror | null): TaskView => ({
  id: t.id, projectId: t.projectId, title: t.title, detail: t.detail,
  status: t.status as TaskStatus, priority: t.priority, memberId: t.memberId,
  startDate: iso(t.startDate), dueDate: iso(t.dueDate), order: t.order,
  // `specId` tetap disajikan meski `spec` null: bedanya itulah yang membedakan "tak pernah
  // dieskalasi" dari "tautannya putus", dan yang kedua harus terlihat, bukan diam.
  specId: t.specId, spec,
  createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
});

export type TasksFilter = {
  projectId?: string; status?: string; memberId?: string; page?: number; limit?: number;
};

const str = (v: number | undefined): string | undefined => (v === undefined ? undefined : String(v));

export async function buildTasksPage(f: TasksFilter): Promise<Paginated<TaskView>> {
  const where: { projectId?: string; status?: string; memberId?: string } = {};
  if (f.projectId) where.projectId = f.projectId;
  if (f.status) where.status = f.status;
  if (f.memberId) where.memberId = f.memberId;
  // `order` menaik = urutan dalam kolom; `id` memecah seri supaya dua mesin yang menulis nilai
  // yang sama tetap menghasilkan urutan yang identik di mana pun.
  const rows = await prisma.task.findMany({ where, orderBy: [{ order: "asc" }, { id: "asc" }] });

  // `specId` TANPA FK, jadi tak ada `include` Prisma yang bisa dipakai. Satu query untuk seluruh
  // himpunan — bukan satu per kartu (N+1) — lalu dipetakan di memori.
  const specIds = [...new Set(rows.map((t) => t.specId).filter((s): s is string => !!s))];
  const specs = specIds.length
    ? await prisma.spec.findMany({
        where: { id: { in: specIds } }, select: { id: true, stage: true, priority: true },
      })
    : [];
  const byId = new Map(specs.map((s) => [s.id, s as TaskSpecMirror]));

  return paginate(rows.map((t) => taskView(t, t.specId ? byId.get(t.specId) ?? null : null)),
    str(f.page), str(f.limit));
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks-list.test.ts
```

Expected: PASS (8 test).

- [x] **Step 5: Commit**

```bash
git add server/src/services/tasks-list.ts server/test/tasks-list.test.ts
git commit -m "feat(945): buildTasksPage — halaman task + cermin spec baca-saja"
```

---

### Task 5: Route `/api/members`

**Files:**
- Create: `server/src/routes/members.ts`
- Modify: `server/src/app.ts` (import + `api.register`)
- Test: `server/test/members.route.test.ts`

**Interfaces:**
- Consumes: `zCreateMember`, `zPatchMember`, `memberId`, `MemberView` (Task 2); `notifySynced`/`deleteSynced` (sudah ada); `paginate`.
- Produces: route `GET|POST /api/members`, `PATCH|DELETE /api/members/:id`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/members.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => { await resetDb(); });

const create = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/members", payload });

describe("POST /members", () => {
  it("membuat anggota dengan id DETERMINISTIK dari email ternormalisasi", async () => {
    const res = await create({ name: "Dena", email: "  Dena@Nafanesia.ID " });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("dena@nafanesia.id");
    expect(res.json().email).toBe("Dena@Nafanesia.ID");   // apa yang diketik operator
    expect(res.json().active).toBe(true);
    expect(res.json().role).toBeNull();
  });

  // Inti id deterministik: dua ejaan yang sama TIDAK boleh melahirkan dua baris.
  it("menolak 409 untuk email yang sama walau beda kapitalisasi", async () => {
    await create({ name: "Dena", email: "dena@x.id" });
    const res = await create({ name: "Dena Lagi", email: "DENA@X.ID" });
    expect(res.statusCode).toBe(409);
    expect(res.json().id).toBe("dena@x.id");
    expect(await prisma.member.count()).toBe(1);
  });

  it("menolak 400 email cacat & nama kosong", async () => {
    expect((await create({ name: "D", email: "bukan" })).statusCode).toBe(400);
    expect((await create({ name: " ", email: "a@b.id" })).statusCode).toBe(400);
  });

  it("mencatat version-stamp sync (baris menyeberang)", async () => {
    await create({ name: "Dena", email: "dena@x.id" });
    const log = await prisma.syncLog.findFirst({ where: { entity: "member", recordId: "dena@x.id" } });
    expect(log).not.toBeNull();
  });
});

describe("GET /members", () => {
  beforeEach(async () => {
    await create({ name: "Zain", email: "z@x.id" });
    await create({ name: "Adi", email: "a@x.id" });
    await create({ name: "Budi", email: "b@x.id" });
    await app.inject({ method: "PATCH", url: "/api/members/z@x.id", payload: { active: false } });
  });

  it("aktif dulu, lalu nama asc", async () => {
    const res = await app.inject({ method: "GET", url: "/api/members" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((m: { name: string }) => m.name)).toEqual(["Adi", "Budi", "Zain"]);
  });

  it("beramplop Paginated; tanpa limit → seluruh item satu halaman (ADR-0107)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/members" });
    expect(res.json()).toMatchObject({ total: 3, page: 1, pageSize: 3 });
  });

  it("?active=true menyaring yang nonaktif", async () => {
    const res = await app.inject({ method: "GET", url: "/api/members?active=true" });
    expect(res.json().items.map((m: { name: string }) => m.name)).toEqual(["Adi", "Budi"]);
  });
});

describe("PATCH /members/:id", () => {
  beforeEach(async () => { await create({ name: "Dena", email: "dena@x.id" }); });

  it("mengubah nama, role, active", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/members/dena@x.id",
      payload: { name: "Dena M", role: "desainer", active: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Dena M", role: "desainer", active: false });
  });

  // ADR-0094 keputusan 2 · ditolak EKSPLISIT, bukan diabaikan senyap: "ganti email diterima lalu
  // tak terjadi apa-apa" adalah bug yang tak terlihat operator.
  it("MENOLAK 400 bila body membawa email", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/members/dena@x.id",
      payload: { name: "X", email: "baru@x.id" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/email/i);
    expect((await prisma.member.findUnique({ where: { id: "dena@x.id" } }))!.name).toBe("Dena");
  });

  it("404 untuk id yang tak ada", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/members/hantu@x.id", payload: { name: "X" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /members/:id", () => {
  it("task-nya jatuh ke belum-ditugaskan, tidak ikut terhapus (SetNull)", async () => {
    await create({ name: "Dena", email: "dena@x.id" });
    await prisma.task.create({ data: { id: "t1", title: "Nego", status: "doing", memberId: "dena@x.id" } });
    const res = await app.inject({ method: "DELETE", url: "/api/members/dena@x.id" });
    expect(res.statusCode).toBe(204);
    const t = await prisma.task.findUnique({ where: { id: "t1" } });
    expect(t!.memberId).toBeNull();
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/members/hantu@x.id" })).statusCode).toBe(404);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/members.route.test.ts
```

Expected: FAIL — seluruh request menjawab `404` (route belum terdaftar).

- [x] **Step 3: Tulis `server/src/routes/members.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Member } from "@prisma/client";
import { zCreateMember, zPatchMember, memberId, type MemberView } from "@hanoman/shared";
import { prisma } from "../db";
import { notifySynced } from "../services/sync-notify";
import { deleteSynced } from "../services/sync-delete";
import { paginate } from "../services/paginate";

// SPEC-945 · ADR-0150 · direktori orang untuk papan tim. GLOBAL, bukan per project.
//
// Tak ada entri di `capabilityForRoute`: top-segment yang tak terdaftar jatuh ke `null`, dan
// `checkAgentCapability` memperlakukannya sama dengan COOKIE_ONLY. Papan tim adalah permukaan
// manusia, jadi tertutupnya bagi agent token adalah default yang benar — bukan kelalaian.

const view = (m: Member): MemberView => ({
  id: m.id, name: m.name, email: m.email, role: m.role, active: m.active,
  createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  app.get("/members", async (req) => {
    const { active, page, limit } = req.query as Record<string, string | undefined>;
    const rows = await prisma.member.findMany({
      where: active === "true" ? { active: true } : {},
      // Nonaktif TETAP terlihat, cuma di bawah: kartu lama yang ditugaskan padanya harus tetap
      // punya nama, dan menyembunyikannya membuat assignee-nya terbaca sebagai id mentah.
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return paginate(rows.map(view), page, limit);
  });

  app.post("/members", async (req, reply) => {
    const parsed = zCreateMember.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    const id = memberId(p.email);
    if (await prisma.member.findUnique({ where: { id } }))
      return reply.code(409).send({ error: "email sudah terdaftar", id });

    const row = await prisma.member.create({
      data: { id, name: p.name, email: p.email, role: p.role ?? null },
    });
    await notifySynced("member", id);
    return reply.code(201).send(view(row));
  });

  app.patch("/members/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // `email` sengaja DI LUAR skema patch (ADR-0094 keputusan 2): id diturunkan darinya, dan
    // changefeed tak punya operasi rename — id yang berubah meninggalkan baris yatim di setiap
    // mesin lain. Ditolak eksplisit, bukan diabaikan: `.omit()` sendirian membuangnya SENYAP.
    const body = (req.body ?? {}) as Record<string, unknown>;
    if ("email" in body)
      return reply.code(400).send({ error: "email tak bisa diubah — hapus lalu buat baru" });

    const parsed = zPatchMember.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await prisma.member.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "not found" });

    const row = await prisma.member.update({ where: { id }, data: parsed.data });
    await notifySynced("member", id);
    return view(row);
  });

  app.delete("/members/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // `onDelete: SetNull` — task-nya jadi "belum ditugaskan", tidak ikut terhapus. Penerima sync
    // melakukan hal yang sama lewat cascade DB-nya sendiri.
    if (!(await deleteSynced("member", id))) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });
}
```

- [x] **Step 4: Daftarkan di `app.ts`**

Import, sesudah `import customAgents from "./routes/custom-agents";` (`:40`):

```ts
import members from "./routes/members";
```

Register, sesudah `await api.register(clientAccounts);` (±`:261`):

```ts
    await api.register(members);      // SPEC-945 · ADR-0150 · direktori orang papan tim (cookie-only)
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/members.route.test.ts
```

Expected: PASS (12 test).

- [x] **Step 6: Commit**

```bash
git add server/src/routes/members.ts server/src/app.ts server/test/members.route.test.ts
git commit -m "feat(945): route CRUD /api/members, email immutable"
```

---

### Task 6: Route `/api/tasks`

**Files:**
- Create: `server/src/routes/tasks.ts`
- Modify: `server/src/app.ts` (import + `api.register`)
- Test: `server/test/tasks.route.test.ts`

**Interfaces:**
- Consumes: `zCreateTask`, `zPatchTask`, `TaskView` (Task 2); `buildTasksPage`, `taskView` (Task 4); `notifySynced`/`deleteSynced`.
- Produces: route `GET|POST /api/tasks`, `PATCH|DELETE /api/tasks/:id`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/tasks.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "executing", priority: "tinggi" });
  await prisma.member.create({ data: { id: "a@x.id", name: "Adi", email: "a@x.id" } });
});

const create = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/tasks", payload });

describe("POST /tasks", () => {
  it("membuat kartu; hanya title yang wajib", async () => {
    const res = await create({ title: "Rapat internal" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: "Rapat internal", projectId: null, memberId: null,
      status: "backlog", priority: "sedang", order: 0, specId: null, spec: null,
    });
  });

  it("menerima project, assignee, tanggal, prioritas", async () => {
    const res = await create({
      title: "Desain landing", projectId: "p1", memberId: "a@x.id", priority: "tinggi",
      startDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-09-08T00:00:00.000Z", order: 1.5,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      projectId: "p1", memberId: "a@x.id", priority: "tinggi",
      startDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-09-08T00:00:00.000Z", order: 1.5,
    });
  });

  it("menolak 400 status di luar empat kolom", async () => {
    expect((await create({ title: "x", status: "executing" })).statusCode).toBe(400);
  });

  // FK ada, tapi pesan Prisma P2003 bukan jawaban yang bisa dibaca UI.
  it("menolak 400 memberId yang tak ada, menyebut nilainya", async () => {
    const res = await create({ title: "x", memberId: "hantu@x.id" });
    expect(res.statusCode).toBe(400);
    expect(res.json().memberId).toBe("hantu@x.id");
  });

  it("menolak 400 projectId yang tak ada, menyebut nilainya", async () => {
    const res = await create({ title: "x", projectId: "hantu" });
    expect(res.statusCode).toBe(400);
    expect(res.json().projectId).toBe("hantu");
  });

  it("mencatat version-stamp sync", async () => {
    const id = (await create({ title: "x" })).json().id;
    expect(await prisma.syncLog.findFirst({ where: { entity: "task", recordId: id } })).not.toBeNull();
  });
});

describe("GET /tasks", () => {
  beforeEach(async () => {
    await create({ title: "Desain", projectId: "p1", order: 2 });
    await create({ title: "Deploy", projectId: "p1", status: "doing", memberId: "a@x.id", order: 1 });
    await create({ title: "Rapat", order: 0 });
    await prisma.task.updateMany({ where: { title: "Deploy" }, data: { specId: "SPEC-1" } });
  });

  it("beramplop Paginated, urut `order` menaik", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((t: { title: string }) => t.title)).toEqual(["Rapat", "Deploy", "Desain"]);
    expect(res.json()).toMatchObject({ total: 3, page: 1, pageSize: 3 });
  });

  it("menyaring projectId, status, memberId", async () => {
    const byProject = await app.inject({ method: "GET", url: "/api/tasks?projectId=p1" });
    expect(byProject.json().total).toBe(2);
    const byStatus = await app.inject({ method: "GET", url: "/api/tasks?status=doing" });
    expect(byStatus.json().items.map((t: { title: string }) => t.title)).toEqual(["Deploy"]);
    const byMember = await app.inject({ method: "GET", url: "/api/tasks?memberId=a%40x.id" });
    expect(byMember.json().total).toBe(1);
  });

  it("memaginasi (ADR-0107)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks?page=2&limit=2" });
    expect(res.json()).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(res.json().items).toHaveLength(1);
  });

  // Cermin backlog BACA-SAJA, dihitung saat baca (ADR-0090) — tak ada kolom stage di Task.
  it("menyertakan cermin spec { id, stage, priority }", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks?status=doing" });
    expect(res.json().items[0].spec).toEqual({ id: "SPEC-1", stage: "executing", priority: "tinggi" });
  });

  it("tautan putus: specId tetap terisi, spec null", async () => {
    await prisma.spec.delete({ where: { id: "SPEC-1" } });
    const res = await app.inject({ method: "GET", url: "/api/tasks?status=doing" });
    expect(res.json().items[0]).toMatchObject({ specId: "SPEC-1", spec: null });
  });
});

describe("PATCH /tasks/:id", () => {
  it("memindahkan kolom & urutan (drop kanban)", async () => {
    const id = (await create({ title: "Desain", projectId: "p1" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`,
      payload: { status: "review", order: 3.25 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "review", order: 3.25 });
  });

  it("boleh mengosongkan assignee & project eksplisit", async () => {
    const id = (await create({ title: "x", projectId: "p1", memberId: "a@x.id" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`,
      payload: { memberId: null, projectId: null } });
    expect(res.json()).toMatchObject({ memberId: null, projectId: null });
  });

  it("menolak 400 memberId yang tak ada", async () => {
    const id = (await create({ title: "x" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`, payload: { memberId: "hantu@x.id" } });
    expect(res.statusCode).toBe(400);
  });

  // specId lahir dari eskalasi (item C), bukan dari ketikan: kartu tak boleh mengaku tertaut
  // pada Spec yang tak pernah menyetujuinya.
  it("MENGABAIKAN specId di body — bukan field yang bisa ditulis CRUD", async () => {
    const id = (await create({ title: "x" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`, payload: { specId: "SPEC-1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().specId).toBeNull();
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "PATCH", url: "/api/tasks/hantu", payload: { title: "x" } })).statusCode).toBe(404);
  });
});

describe("DELETE /tasks/:id", () => {
  it("menghapus & menulis tombstone sync", async () => {
    const id = (await create({ title: "x" })).json().id;
    expect((await app.inject({ method: "DELETE", url: `/api/tasks/${id}` })).statusCode).toBe(204);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.syncTombstone.findFirst({ where: { entity: "task", recordId: id } })).not.toBeNull();
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/tasks/hantu" })).statusCode).toBe(404);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks.route.test.ts
```

Expected: FAIL — seluruh request `404`.

- [x] **Step 3: Tulis `server/src/routes/tasks.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { zCreateTask, zPatchTask } from "@hanoman/shared";
import { prisma } from "../db";
import { notifySynced } from "../services/sync-notify";
import { deleteSynced } from "../services/sync-delete";
import { buildTasksPage, taskView } from "../services/tasks-list";

// SPEC-945 · ADR-0150 · CRUD kartu kerja MANUSIA. Bukan backlog: `status` di sini milik manusia dan
// bebas dipindah, sementara `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024).
//
// Tak ada entri di `capabilityForRoute` maupun `clientRouteAllowed` — keduanya deny-by-default,
// jadi route ini tertutup bagi agent token DAN role `client` tanpa satu baris pun (ADR-0110).

/** Rujukan tanpa pesan yang bisa dibaca: P2003 Prisma menyebut nama constraint, bukan nilainya. */
async function refProblem(
  projectId: string | null | undefined, memberId: string | null | undefined,
): Promise<{ error: string; projectId?: string; memberId?: string } | null> {
  if (projectId && !(await prisma.project.findUnique({ where: { id: projectId } })))
    return { error: "project tak ditemukan", projectId };
  if (memberId && !(await prisma.member.findUnique({ where: { id: memberId } })))
    return { error: "anggota tak ditemukan", memberId };
  return null;
}

const dateOf = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

export default async function (app: FastifyInstance) {
  app.get("/tasks", async (req) => {
    const { projectId, status, memberId, page, limit } = req.query as Record<string, string | undefined>;
    // SPEC-908 · satu definisi dipakai bersama topik siar `tasks` (services/tasks-list.ts).
    return buildTasksPage({
      projectId, status, memberId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  });

  app.post("/tasks", async (req, reply) => {
    const parsed = zCreateTask.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    const bad = await refProblem(p.projectId, p.memberId);
    if (bad) return reply.code(400).send(bad);

    const row = await prisma.task.create({ data: {
      title: p.title, detail: p.detail ?? null, projectId: p.projectId ?? null,
      status: p.status, priority: p.priority, memberId: p.memberId ?? null,
      startDate: dateOf(p.startDate) ?? null, dueDate: dateOf(p.dueDate) ?? null,
      order: p.order ?? 0,
    } });
    await notifySynced("task", row.id);
    // Kartu baru tak pernah punya tautan backlog: `specId` lahir dari eskalasi (item C).
    return reply.code(201).send(taskView(row, null));
  });

  app.patch("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPatchTask.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not found" });

    const bad = await refProblem(p.projectId, p.memberId);
    if (bad) return reply.code(400).send(bad);

    // Hanya field yang BENAR-BENAR dikirim yang ditulis: `undefined` di Prisma berarti "jangan
    // sentuh", sementara `null` berarti "kosongkan" — dan keduanya harus tetap berbeda supaya
    // PATCH {status} tak diam-diam menghapus tanggal yang sudah diisi.
    const row = await prisma.task.update({ where: { id }, data: {
      title: p.title, detail: p.detail, projectId: p.projectId,
      status: p.status, priority: p.priority, memberId: p.memberId,
      startDate: dateOf(p.startDate), dueDate: dateOf(p.dueDate), order: p.order,
    } });
    await notifySynced("task", id);
    const spec = row.specId
      ? await prisma.spec.findUnique({ where: { id: row.specId }, select: { id: true, stage: true, priority: true } })
      : null;
    return taskView(row, spec);
  });

  app.delete("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deleteSynced("task", id))) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });
}
```

- [x] **Step 4: Daftarkan di `app.ts`**

Import, sesudah `import members from "./routes/members";`:

```ts
import tasks from "./routes/tasks";
```

Register, tepat sesudah baris `members`:

```ts
    await api.register(tasks);        // SPEC-945 · ADR-0150 · kartu kerja manusia (cookie-only)
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks.route.test.ts
```

Expected: PASS (17 test).

- [x] **Step 6: Commit**

```bash
git add server/src/routes/tasks.ts server/src/app.ts server/test/tasks.route.test.ts
git commit -m "feat(945): route CRUD /api/tasks + cermin spec baca-saja"
```

---

### Task 7: Topik realtime `tasks`

**Files:**
- Modify: `shared/src/dto.ts:733` (`EventTopic`), `:742-764` (`zTopicParams`), `:794+` (`EventMsg`)
- Modify: `server/src/services/events-topics.ts:20-36` (`TOPICS`)
- Test: `server/test/team-topic.test.ts`

**Interfaces:**
- Consumes: `buildTasksPage` (Task 4), `TaskView` (Task 2).
- Produces: topik `"tasks"` dengan `everyTicks: 3`; frame `{ t: "tasks"; key: string; data: Paginated<TaskView> }`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/team-topic.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { TOPICS, TOPIC_NAMES, isTopic, parseParams } from "../src/services/events-topics";
import { prisma } from "../src/db";
import { resetDb, makeProject } from "./factory";

describe("SPEC-945 · ADR-0150 · topik `tasks`", () => {
  it("terdaftar di TOPICS", () => {
    expect(TOPIC_NAMES).toContain("tasks");
    expect(isTopic("tasks")).toBe(true);
  });

  // Papan tim sedikit penonton & banyak parameter, jadi ia topik BERPARAMETER — bukan grup global
  // ke-11 di `GROUPS`, yang di-recompute untuk SETIAP klien yang terhubung tiap N detik.
  it("everyTicks 3 — kadens yang sama dengan tickets", () => {
    expect(TOPICS.tasks.everyTicks).toBe(3);
  });

  it("parameter dijepit plafon ADR-0107", () => {
    expect(parseParams("tasks", { page: 1, limit: 50 })).toEqual({ page: 1, limit: 50 });
    expect(parseParams("tasks", { page: 1, limit: 500 })).toBeUndefined();
    expect(parseParams("tasks", { page: 0, limit: 10 })).toBeUndefined();
    // `.strict()` — parameter asing menolak entri ITU, bukan seluruh frame.
    expect(parseParams("tasks", { page: 1, limit: 10, aneh: 1 })).toBeUndefined();
  });

  it("menerima filter opsional projectId/status/memberId", () => {
    expect(parseParams("tasks", { projectId: "p1", status: "doing", memberId: "a@x.id", page: 1, limit: 20 }))
      .toEqual({ projectId: "p1", status: "doing", memberId: "a@x.id", page: 1, limit: 20 });
  });

  it("build mengembalikan BADAN frame tanpa t/key", async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await prisma.task.create({ data: { id: "t1", projectId: "p1", title: "Desain", status: "backlog" } });
    const body = await TOPICS.tasks.build({ projectId: "p1", page: 1, limit: 10 });
    expect(Object.keys(body)).toEqual(["data"]);
    expect(body.data.items.map((t) => t.id)).toEqual(["t1"]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/team-topic.test.ts
```

Expected: FAIL — tsc/vitest menolak `TOPICS.tasks` (properti tak ada di tipe).

- [ ] **Step 3: Tambah topik di `shared/src/dto.ts`**

**a.** `EventTopic` (`:733`):

```ts
export type EventTopic = "schedulerState" | "schedulerQueue" | "tickets" | "lead" | "git" | "tasks";
```

**b.** `zTopicParams` (`:742-764`) — entri sesudah `git`:

```ts
  // SPEC-945 · ADR-0150 · papan tim. Berparameter (project × status × assignee × halaman), bukan
  // grup global: biayanya hanya lahir untuk parameter yang benar-benar ada yang menonton.
  tasks: z.object({
    projectId: z.string().max(120).optional(),
    status: z.string().max(40).optional(),
    memberId: z.string().max(200).optional(),
    page: zSubPage, limit: zSubLimit,
  }).strict(),
```

**c.** `EventMsg` — varian sesudah `tickets`:

```ts
  | { t: "tasks"; key: string; data: Paginated<TaskView> }
```

Dan tambahkan `TaskView` ke impor tipe di kepala berkas bila `dto.ts` belum mengimpornya:

```ts
import type { TaskView } from "./team";
```

- [ ] **Step 4: Tambah entri `TOPICS`**

Di `server/src/services/events-topics.ts`, impor:

```ts
import { buildTasksPage } from "./tasks-list";
```

lalu entri sesudah `git`:

```ts
  // SPEC-945 · ADR-0150 · papan tim. Kadens sama dengan `tickets`: daftar yang dibaca manusia,
  // bukan aliran terminal.
  tasks: { everyTicks: 3, build: async (p) => ({ data: await buildTasksPage(p) }) },
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/team-topic.test.ts
pnpm --filter ./server typecheck && pnpm --filter ./shared typecheck
```

Expected: PASS (5 test), typecheck nol error.

- [ ] **Step 6: Pastikan `GROUPS` tak tersentuh**

```bash
git diff --stat "$HANOMAN_BASE_SHA" -- server/src/services/events.ts
```

Expected: keluaran KOSONG. Bila ada isinya, kembalikan berkas itu — papan tim tak boleh jadi grup global.

- [ ] **Step 7: Commit**

```bash
git add shared/src/dto.ts server/src/services/events-topics.ts server/test/team-topic.test.ts
git commit -m "feat(945): topik realtime berparameter tasks (everyTicks 3)"
```

---

### Task 8: Gerbang akses & registry path

**Files:**
- Modify: `shared/src/api.ts` (entri `paths`)
- Modify: `server/test/client-route-allowed.test.ts`
- Modify: `server/test/agent-capabilities.test.ts`

**Interfaces:**
- Produces: `paths.members`, `paths.member(id)`, `paths.tasks`, `paths.task(id)` — dipakai UI item B.
- Tidak ada perubahan produksi pada gerbang: keduanya deny-by-default. Yang ditambahkan hanya buktinya.

- [ ] **Step 1: Tulis test yang gagal**

Di `server/test/client-route-allowed.test.ts`, dalam array `paths` pada test `"seluruh permukaan operator tertutup"`, tambahkan:

```ts
      "/api/members", "/api/members/a@x.id",   // SPEC-945 · ADR-0150
      "/api/tasks", "/api/tasks/t1",
```

Di `server/test/agent-capabilities.test.ts`, tambahkan blok baru di akhir berkas:

```ts
// SPEC-945 · ADR-0150 · papan tim adalah permukaan MANUSIA. Tak ada entri di `capabilityForRoute`,
// jadi ia jatuh ke `null` → cookie-only. Ini keputusan, bukan kelalaian — dan test ini yang
// membuatnya tetap begitu bila suatu hari seseorang menambahkan cabang tanpa memikirkannya.
describe("papan tim tertutup bagi agent token", () => {
  for (const p of ["/api/members", "/api/members/a@x.id", "/api/tasks", "/api/tasks/t1"])
    for (const m of ["GET", "POST", "PATCH", "DELETE"])
      it(`${m} ${p} → cookie-only`, () => {
        expect(capabilityForRoute(m, p)).toBeNull();
        const r = checkAgentCapability(["backlog:write", "support:write"], m, p);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toBe("cookie-only");
      });
});
```

- [ ] **Step 2: Jalankan test, pastikan LULUS langsung**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/client-route-allowed.test.ts server/test/agent-capabilities.test.ts
```

Expected: PASS. Ini test **karakterisasi**: ia mendokumentasikan perilaku deny-by-default yang sudah benar, dan akan merah bila seseorang membukanya tanpa sengaja. Bila `agent-capabilities.test.ts` belum mengimpor `checkAgentCapability`, tambahkan ke impor di kepala berkas.

- [ ] **Step 3: Tambah entri `paths`**

Di `shared/src/api.ts`, sesudah entri `customAgent: (id) => …`:

```ts
  // SPEC-945 · ADR-0150 · papan tim. `members` GLOBAL (bukan per project) — task boleh tanpa
  // project, jadi direktori orang tak bisa digantung pada project.
  members: `${API}/members`,
  member: (id: string) => `${API}/members/${encodeURIComponent(id)}`,
  tasks: `${API}/tasks`,
  task: (id: string) => `${API}/tasks/${encodeURIComponent(id)}`,
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter ./shared typecheck
```

Expected: nol error.

- [ ] **Step 5: Commit**

```bash
git add shared/src/api.ts server/test/client-route-allowed.test.ts server/test/agent-capabilities.test.ts
git commit -m "test(945): buktikan papan tim tertutup bagi client & agent token"
```

---

### Task 9: ADR-0150 & dokumentasi Source of Truth

**Files:**
- Create: `internal/docs/adr/0150-fondasi-papan-tim-task-member.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/README.md`

**Interfaces:** tak ada kode.

- [ ] **Step 1: Konfirmasi nomor ADR belum dipakai**

```bash
ls internal/docs/adr/ | grep '^0150' || echo "0150 bebas"
```

Expected: `0150 bebas`. Bila terisi, naikkan ke nomor berikutnya yang kosong dan **perbarui setiap rujukan `ADR-0150`** di kode, spec, dan plan ini.

- [ ] **Step 2: Tulis ADR-0150**

Buat `internal/docs/adr/0150-fondasi-papan-tim-task-member.md` dengan struktur yang sama dengan ADR tetangga (Konteks → Keputusan → Konsekuensi → Alternatif yang ditolak). Isi wajib:

1. **`Task` adalah entity BARU, bukan kolom di `Spec`.** Kolom papan tim milik manusia; `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024) dan hampir seluruhnya menolak drag. Larangan estimasi/tenggat di `Spec` (SPEC-162) tetap berlaku utuh — yang dilonggarkan hanya untuk pekerjaan manusia, di tabel yang berbeda.
2. **`Member.id` deterministik dari email ternormalisasi** — memperluas ADR-0094. Konsekuensi: `email` immutable, ditegakkan dua lapis di boundary route.
3. **`Member` GLOBAL, bukan per project** — Task boleh tanpa project.
4. **Stage backlog TIDAK disimpan** — menegakkan ADR-0090: aturannya "bisakah dihitung ulang", dan di sini bisa.
5. **`Task.specId` tanpa FK** — cermin ADR-0062/`Ticket.specId`, kelas SPEC-382.
6. **Tak ada `doneAt`/stempel transisi** — Gantt rencana-saja; dihilangkan sengaja.
7. **`order` Float** — sisip di titik tengah, tanpa reindex; seri dipecah `id`.
8. **Ikut sync penuh** (ADR-0045/0067/0119), dengan tabel delapan tempat pendaftaran dan kelas gagal-senyapnya masing-masing. Sebut `PG_ORDER` sebagai tempat kesembilan yang berada di luar `sync.ts`.
9. **Topik berparameter, bukan grup global** — menegakkan ADR-0145/0039; alasan biaya `GROUPS`.
10. **Deny-by-default dua arah** — menegakkan ADR-0110 (`clientRouteAllowed`) & ADR-0065 (`capabilityForRoute` → `null` = cookie-only). Nol entri baru; yang ditambahkan hanya test.
11. **Webhook sengaja tidak disentuh**, berikut konsekuensi `cascade` pada `project.deleted` yang kurang melaporkan task — dinyatakan, bukan terlupa.
12. **Amandemen kecil atas dokumen induk:** `priority` memakai `zPriority` (`tinggi|sedang|rendah`, default `sedang`), bukan `"normal"` yang bukan anggota kosakata repo ini.

- [ ] **Step 3: Seksi `Member` & `Task` di `data-model.md`**

Sisipkan **sesudah** seksi `## GithubIssue` (±:828-856), sebelum `## Changelog`:

```markdown
## Member / Task (SPEC-945 · [ADR-0150](../adr/0150-fondasi-papan-tim-task-member.md))

Lapisan kerja **manusia** di sekitar pekerjaan agen: desain, meeting klien, deploy, nego, tulis
konten, urusan internal tim. Sengaja **bukan** `Spec` — kolom papan di sini milik manusia dan bebas
dipindah, sementara `Spec.stage` diturunkan dari fase sesi ([ADR-0008](../adr/0008-stage-mirrors-run.md)/[ADR-0024](../adr/0024-sesi-interaktif-menggantikan-run.md))
dan hampir seluruhnya menolak drag. Larangan estimasi & tenggat di `Spec` (SPEC-162) tetap berlaku
utuh: yang dilonggarkan hanya untuk pekerjaan manusia, di tabel yang berbeda.

`Member` — direktori orang, **GLOBAL** (bukan per project: `Task` boleh tanpa project, dan orang
yang sama lazim melintasi beberapa project):

| Kolom | Arti |
|---|---|
| `id` | **DETERMINISTIK**: email ternormalisasi `lowercase + trim`. Pola `CustomAgent` ([ADR-0094](../adr/0094-custom-agent-katalog-materialisasi-native.md)) |
| `name` | bebas diedit |
| `email` | **IMMUTABLE** — ganti email = hapus + buat baru. `@unique`; menyimpan yang diketik operator, bukan bentuk ternormalisasi |
| `role` | label bebas ("desainer", "backend") — **BUKAN RBAC** |
| `active` | nonaktif tetap terlihat, cuma di urutan bawah: kartu lama yang ditugaskan padanya harus tetap punya nama |
| `version` | version-stamp sync ([ADR-0045](../adr/0045-skema-sync-synclog-version-stamp.md)) |

`Task` — satuan kerja manusia:

| Kolom | Arti |
|---|---|
| `projectId` | **NULLABLE**. `null` = tugas internal tim, tanpa project. FK `onDelete: Cascade` |
| `status` | `backlog` · `doing` · `review` · `done` — empat kolom papan, tetap |
| `priority` | kosakata yang SAMA dengan `Spec`: `tinggi` · `sedang` · `rendah` (default `sedang`) |
| `memberId` | `null` = belum ditugaskan. FK `onDelete: **SetNull**` — menghapus anggota tak menghapus pekerjaannya |
| `startDate` / `dueDate` | rencana yang diisi manusia; batang Gantt. **Tak ada tanggal aktual** |
| `order` | `Float`. Drop di antara dua kartu menulis titik tengah tetangganya — tak ada reindex kolom, dan dua mesin yang menulis bersamaan tetap menghasilkan urutan yang sama. Seri dipecah `id` |
| `specId` | soft-link hasil eskalasi, **TANPA FK** (cermin `Ticket.specId`, [ADR-0062](../adr/0062-help-center-tiket-publik-triase.md)): changefeed bisa memancarkan `Task` sebelum `Spec`-nya mendarat (kelas SPEC-382) dan FK akan menolaknya. **Tak bisa ditulis lewat CRUD** |

Indeks: `[projectId, status]` (papan per project) dan `[memberId]` ("tugas saya").

**Tak ada kolom `stage`.** Cermin stage backlog dihitung **saat baca** lewat join `specId → Spec.stage`.
Aturan [ADR-0090](../adr/0090-stempel-waktu-backlog-created-started.md) bukan "selalu simpan" melainkan *bisakah
dihitung ulang dari sumber lain*; di sini bisa, jadi kolom kedua hanya menciptakan dua kebenaran
yang bisa drift.

**Tak ada `doneAt` dan tak ada stempel transisi kolom.** Gantt yang dipilih rencana-saja, jadi
tanggal aktual belum punya pembaca. Dihilangkan dengan sengaja, bukan terlupa — menambahkannya
nanti adalah migration additif biasa.

**"Tugas saya" tanpa menautkan tabel:** `Member.email` dicocokkan dengan `User.email` akun yang
login. String, bukan FK — jadi tak ada masalah `User` yang LOCAL-only dan tak perlu role baru.

**Sync.** Keduanya **ikut menyeberang** (`SYNCED`), dengan seluruh kolom bermakna di `FIELDS`
(`version` tak pernah ikut — ia stempel mekanismenya sendiri), `task:order` di `NUMBER_FIELDS`,
`member:active` di `BOOLEAN_FIELDS`, `PARENTS.task` menunjuk **dua** induk (`project` & `member`),
dan `BOOTSTRAP_ORDER` menaruh `member` **sebelum** `task` — urutan yang salah bootstrap sukses
tanpa error tapi assignee kosong (kelas SPEC-885). `Member` sendiri tak punya induk.

**Webhook keluar sengaja tidak memancarkan keduanya**: `WEBHOOK_ENTITIES` adalah registry eksplisit.
Konsekuensinya `data.cascade` pada `project.deleted` **kurang melaporkan** task yang ikut terhapus —
dinyatakan, bukan terlupa (lihat ADR-0150).
```

- [ ] **Step 4: Seksi route di `api-contract.md`**

Sisipkan seksi baru mengikuti gaya berkas itu (blok kode berisi path + komentar `#`), diletakkan sesudah seksi tiket/triase:

```markdown
## Papan tim (SPEC-945 · [ADR-0150](../adr/0150-fondasi-papan-tim-task-member.md)) — **COOKIE_ONLY**

# Tak ada entri di `capabilityForRoute` maupun `clientRouteAllowed` — KEDUANYA deny-by-default
# (ADR-0065 · ADR-0110), jadi papan tim tertutup bagi agent token DAN role `client` tanpa satu
# baris pun. Itu keputusan, bukan kelalaian; ditegakkan test, bukan diasumsikan.

GET    /members?active&page&limit   -> Paginated<MemberView>
#   Urutan: aktif dulu, lalu nama asc. Nonaktif TETAP terlihat — kartu lama yang ditugaskan
#   padanya harus tetap punya nama, dan menyembunyikannya membuat assignee terbaca sebagai id.
#   Beramplop `Paginated` seperti daftar lain (ADR-0107); tanpa `limit` ia satu halaman berisi
#   semuanya (pageSize = total), jadi pemilih assignee tetap dapat daftar penuh.
#   MemberView = { id, name, email, role, active, createdAt, updatedAt }
POST   /members       { name, email, role? }  -> 201 MemberView
#   `id` DITURUNKAN dari email ternormalisasi (lowercase+trim), bukan dikirim klien — pola
#   CustomAgent (ADR-0094). 409 { error, id } bila email itu sudah terdaftar, TERMASUK bila
#   ejaannya beda kapitalisasi: dua baris untuk satu orang adalah persis yang dicegah id ini.
#   400 email cacat / nama kosong.
PATCH  /members/:id   { name?, role?, active? }  -> MemberView
#   `email` DITOLAK 400 secara eksplisit, bukan diabaikan: id diturunkan darinya dan changefeed
#   tak punya operasi rename, jadi id yang berubah meninggalkan baris yatim di setiap mesin lain
#   (ADR-0094 keputusan 2). "Diterima lalu tak terjadi apa-apa" adalah bug yang tak terlihat
#   operator — itu sebabnya penolakannya lapis kedua di ATAS `.omit()` skemanya. 404 id tak ada.
DELETE /members/:id   -> 204
#   Task-nya JATUH ke memberId: null (onDelete: SetNull), tidak ikut terhapus. 404 id tak ada.

GET    /tasks?projectId&status&memberId&page&limit  -> Paginated<TaskView>
#   Urut `order` menaik, seri dipecah `id`. Berhalaman (ADR-0107).
#   TaskView = { id, projectId, title, detail, status, priority, memberId,
#                startDate, dueDate, order, specId, spec, createdAt, updatedAt }
#   `spec` = { id, stage, priority } | null — hasil join `specId`, BACA-SAJA, tak pernah ditulis
#   balik ke Task. Stage backlog tak disimpan di Task (ADR-0090): kolom kedua hanya menciptakan
#   dua kebenaran yang bisa drift. `specId` TANPA FK, jadi join-nya satu query terpisah untuk
#   seluruh halaman — bukan satu per kartu.
#   `specId` terisi DENGAN `spec: null` = TAUTAN PUTUS (Spec-nya dihapus). Keadaan itu jujur dan
#   murah untuk ditampilkan; ia sengaja tidak disamarkan jadi "tak pernah dieskalasi".
POST   /tasks   { title, projectId?, detail?, status?, priority?, memberId?, startDate?, dueDate?, order? }
#   -> 201 TaskView. Hanya `title` yang wajib; status default "backlog", priority default "sedang".
#   400 { error, memberId } / { error, projectId } bila rujukannya tak ada — FK memang ada, tapi
#   P2003 Prisma menyebut nama constraint, bukan nilai yang salah. 400 status di luar empat kolom.
PATCH  /tasks/:id  { …semua field di atas, semuanya opsional }  -> TaskView
#   Termasuk { status, order } untuk drop kanban. Field yang TIDAK dikirim tak tersentuh; `null`
#   eksplisit mengosongkan (memberId/projectId/tanggal) — keduanya harus tetap berbeda supaya
#   PATCH {status} tak diam-diam menghapus tanggal yang sudah diisi. 404 id tak ada.
DELETE /tasks/:id  -> 204   # menulis tombstone sync (ADR-0119). 404 id tak ada.

# `specId` TIDAK ada di body create maupun patch: tautan ke backlog lahir dari eskalasi
# (POST /tasks/:id/escalate, SPEC berikutnya), bukan dari ketikan. CRUD yang bisa mengarangnya
# berarti kartu bisa mengaku tertaut pada Spec yang tak pernah menyetujuinya.

# Realtime: topik BERPARAMETER `tasks` di /events/ws (ADR-0145), everyTicks 3 — bukan grup global
# ke-11 di GROUPS. `GROUPS` di-recompute untuk SETIAP klien tiap N detik; papan tim punya sedikit
# penonton dan banyak parameter, jadi biayanya harus lahir hanya untuk yang benar-benar ditonton.
# params: { projectId?, status?, memberId?, page, limit } — sama dengan query GET /tasks.
```

- [ ] **Step 5: Tautkan di index**

Di `internal/docs/README.md`, tambahkan di **puncak** daftar `## adr` (nomor menurun):

```markdown
- [0150 — Fondasi papan tim: `Task` & `Member` sebagai entity tersync, stage backlog dihitung saat baca](adr/0150-fondasi-papan-tim-task-member.md) — memperluas 0094 (id deterministik) & 0045/0067/0119 (sync); menegakkan 0090 (tanpa kolom kedua yang bisa drift), 0062 (`specId` tanpa FK), 0145/0039 (topik berparameter, bukan grup global), 0110 & 0065 (deny-by-default dua arah); mengamandemen kecil dokumen induk pada kosakata `priority` (SPEC-945)
```

Dan di bagian `## architecture`, satu butir yang menautkan `data-model` + `api-contract` untuk fitur ini, mengikuti gaya butir-butir tebal di sana.

- [ ] **Step 6: Periksa integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli build && node cli/dist/index.js docs index --check
```

Expected: tak ada dokumen baru yang tak ter-link. Bila CLI belum ter-build dan build-nya mahal, cukup verifikasi manual bahwa berkas ADR baru muncul di `internal/docs/README.md`.

- [ ] **Step 7: Commit**

```bash
git add internal/docs
git commit -m "docs(945): ADR-0150 + data-model, api-contract, index"
```

---

### Task 10: Verifikasi menyeluruh

**Files:** tak ada perubahan kode kecuali perbaikan yang muncul.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u DATABASE_URL \
  pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: hijau. **Jangan menerima "no test files" sebagai bukti** — `--changed` menyalakan `passWithNoTests`. Pastikan berkas `team-schema`, `team-topic`, `tasks-list`, `tasks.route`, `members.route`, `sync-*`, `cli/test/migrate-pg` benar-benar berjalan dan hitungannya masuk akal.

Gagal palsu yang sudah dikenal dan **bukan** regresi dari task ini: `404`/`P2022` ramai (DB tetangga terhapus — pastikan `TEST_DATABASE_URL` terpasang), `listChatSessions is not a function` di test portal (merah di base), dan tiga `<Input type="number">` di `placeholder-contract` (merah di base).

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck
```

Expected: nol error di ketiganya. **Bukan** `pnpm -r typecheck` — itu satu proses tsc per paket sekaligus.

- [ ] **Step 3: Buktikan `GROUPS` & webhook tak tersentuh**

```bash
git diff --name-only "$HANOMAN_BASE_SHA" | grep -E 'services/events\.ts|webhook' || echo "bersih"
```

Expected: `bersih`.

- [ ] **Step 4: Smoke endpoint nyata di local**

Task ini menyentuh endpoint, jadi sekali di akhir — bukan tiap task. Pakai HANOMAN_HOME khusus supaya tak menyentuh DB dev nyata:

```bash
export HANOMAN_HOME="$(mktemp -d)"
export DATABASE_URL="file:$HANOMAN_HOME/smoke.db"
pnpm --filter ./server exec prisma migrate deploy --schema prisma/schema.prisma
NODE_ENV=development HANOMAN_REQUIRE_AUTH=0 pnpm --filter ./server exec tsx src/server.ts &
SRV=$!
until curl -sf localhost:3001/api/health >/dev/null; do sleep 1; done

curl -s -X POST localhost:3001/api/members -H 'content-type: application/json' \
  -d '{"name":"Dena","email":"  Dena@Nafanesia.ID "}'
curl -s -X POST localhost:3001/api/members -H 'content-type: application/json' \
  -d '{"name":"Dobel","email":"DENA@NAFANESIA.ID"}'         # harap 409
curl -s -X PATCH localhost:3001/api/members/dena@nafanesia.id -H 'content-type: application/json' \
  -d '{"email":"x@y.id"}'                                    # harap 400
curl -s -X POST localhost:3001/api/tasks -H 'content-type: application/json' \
  -d '{"title":"Desain landing","memberId":"dena@nafanesia.id","dueDate":"2026-09-08T00:00:00.000Z"}'
curl -s 'localhost:3001/api/tasks?page=1&limit=10'
curl -s -X POST localhost:3001/api/tasks -H 'content-type: application/json' \
  -d '{"title":"x","memberId":"hantu@x.id"}'                 # harap 400 menyebut memberId

kill "$SRV"
```

Expected berurutan: `201` dengan `"id":"dena@nafanesia.id"` · `409` · `400` menyebut email · `201` kartu · amplop `{items,total,page,pageSize}` · `400` menyebut `memberId`.

Port sesuaikan bila `HANOMAN_PORT` berbeda. **Jangan** membunuh proses dengan `pkill -f` — matikan per-PID seperti di atas.

- [ ] **Step 5: Diff bersih & push**

```bash
git status --porcelain           # harus kosong
git diff --stat "$HANOMAN_BASE_SHA"...HEAD
git push origin HEAD:refs/heads/hanoman/spec-945
```

- [ ] **Step 6: Centang seluruh kotak plan ini**

Pastikan tak ada `- [ ]` tersisa di berkas ini sebelum menulis `Execute done` ke `$HANOMAN_PHASE_FILE`.
