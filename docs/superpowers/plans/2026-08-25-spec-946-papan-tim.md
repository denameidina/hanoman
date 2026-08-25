# SPEC-946 — Papan Tim: layar `Tim`, mode Papan, modal Anggota — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Layar `Tim` — papan kanban empat kolom untuk kerja MANUSIA di atas entity `Task`/`Member` yang sudah mendarat di SPEC-945, dengan drag HTML5 native, aksi eksplisit di tiap kartu, toolbar dua baris cermin `BacklogScreen`, dan modal kelola Anggota.

**Architecture:** UI murni di atas API yang sudah jadi, ditambah **satu** parameter server (`q`). Papan memasang **satu langganan `/events/ws` per KOLOM** (empat, masing-masing `limit: 200`) karena `zSubLimit` menjepit `limit` ke 200 dan `order` bermakna DI DALAM kolom — satu langganan untuk seluruh papan memotong himpunan gabungan empat kolom di titik yang sewenang-wenang. Berkas dipecah sejak awal: aturan murni (`team-rules.ts`) ↔ render (`team-board.tsx`) ↔ orkestrasi (`TeamScreen.tsx`) ↔ modal (`TaskModal.tsx`, `MembersPanel.tsx`).

**Tech Stack:** React 18 + TypeScript strict (Vite), zod, vitest + @testing-library/react (jsdom), Fastify + Prisma 6 (SQLite) di sisi server.

**Spec:** `docs/superpowers/specs/2026-08-25-spec-946-papan-tim-design.md`
**Induk:** `docs/superpowers/specs/2026-08-25-tim-kanban-gantt-design.md` (item **B** dari lima)
**Sebelumnya:** SPEC-945 / ADR-0150 (fondasi data — sudah mendarat)

## Global Constraints

- Bahasa komentar, label UI, dan pesan galat: **Indonesia**, mengikuti berkas sekitarnya.
- TypeScript strict. Tak ada `any` baru.
- **Test server WAJIB pakai DB terisolasi**: setiap perintah vitest yang menyentuh `server/test/**` diawali `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan diakhiri `--no-file-parallelism`. Tanpa keduanya suite gagal ramai 404/P2022 karena worktree tetangga menghapus DB bersama di tengah run (SPEC-479).
- **Env sesi mencemari suite** (SPEC-903): jalankan vitest lewat `env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u DATABASE_URL -u NODE_ENV`. `HANOMAN_CONTROL_ORIGINS` membuat SELURUH `/api` dijawab 404 sebelum satu pun route dinilai; `NODE_ENV=production` warisan shell menjatuhkan tiap test WebSocket jadi 401.
- **Nama ikon lucide wajib diverifikasi ada sebelum dipakai** (SPEC-906): nama yang salah jatuh ke `Circle` tanpa satu pun error. Yang dipakai plan ini sudah diverifikasi ada: `users`, `user`, `user-plus`, `kanban`, `plus`, `trash-2`, `link`, `unlink`, `filter`, `search`, `check`, `rotate-ccw`, dan `x-circle` (lewat peta `LEGACY` → `CircleX`).
- **Setiap key `HN_NAV` WAJIB punya cabang `section === "<key>"` di `App.tsx`.** Tanpa itu App merender kosong dan sidebar ikut lenyap — pengguna terjebak sampai reload. Dijaga `src/test/changelog-nav.test.tsx`.
- **`GROUPS` di `server/src/services/events.ts` TIDAK BOLEH disentuh.** Papan tim adalah topik berparameter (ADR-0150 keputusan 6).
- **`capabilityForRoute`, `clientRouteAllowed`, `shared/src/webhook.ts`, `server/prisma/schema.prisma`, dan seluruh daftar sync TIDAK BOLEH disentuh.** Semuanya sudah selesai & benar di SPEC-945.
- **Nol kolom baru di `Spec`.** Larangan estimasi & tenggat di `Spec` (SPEC-162) tetap utuh.
- `internal/docs` yang tersentuh diperbarui **dalam commit yang sama** dan ditautkan di `internal/docs/README.md`.
- Nomor ADR final dikonfirmasi saat commit (nomor pernah bertabrakan antar-worktree). Rencana ini memakai **ADR-0151**.

## File Structure

| Berkas | Tanggung jawab | Status |
|---|---|---|
| `server/src/services/tasks-list.ts` | `TasksFilter.q` + penyaring substring case-insensitive sebelum paginasi | ubah |
| `shared/src/dto.ts` | `zTopicParams.tasks.q` | ubah |
| `shared/src/team.ts` | ekspor tipe **input** zod (`CreateTaskInput`, dst.) untuk dipakai klien tanpa membundel zod | ubah |
| `server/test/tasks-list.test.ts` | kasus `q` | ubah |
| `server/test/team-topic.test.ts` | `q` diterima `zTopicParams.tasks` | ubah |
| `src/src/screens/team-rules.ts` | fungsi **MURNI**: `TEAM_COLUMNS`, `emptyBoard`, `canDropTask`, `nextOrder`, `moveCard`, `replaceCard`, `dateInputValue`, `dateInputToIso` | **baru** |
| `src/src/api/client.ts` | delapan fungsi `api.*` untuk `/tasks` & `/members` | ubah |
| `src/src/screens/team-board.tsx` | `TeamBoard` + `TaskCard` — render & event drag | **baru** |
| `src/src/screens/TaskModal.tsx` | form buat/ubah/hapus satu kartu | **baru** |
| `src/src/screens/MembersPanel.tsx` | modal kelola anggota | **baru** |
| `src/src/screens/TeamScreen.tsx` | toolbar, fetch per kolom, langganan per kolom, toggle view, mutasi optimistis | **baru** |
| `src/src/app.css:220-227` | kelas responsif `.hn-team-*` ikut ke grup selector toolbar yang sudah ada | ubah |
| `src/src/ds/shell.tsx` | entri nav `team` sesudah `backlog` | ubah |
| `src/src/App.tsx` | cabang `section === "team"` | ubah |
| `src/test/team-rules.test.ts` | unit fungsi murni | **baru** |
| `src/test/team-board.test.tsx` | render jsdom + drag kartu sungguhan | **baru** |
| `src/test/team-screen.test.tsx` | toolbar, penyaring, plafon kolom, modal Anggota | **baru** |
| `internal/docs/adr/0151-papan-tim-langganan-per-kolom.md` | ADR | **baru** |
| `internal/docs/frontend/frontend-implementation.md` | seksi "Tim — papan kerja manusia" | ubah |
| `internal/docs/architecture/api-contract.md` | `q` pada `GET /api/tasks` | ubah |
| `internal/docs/README.md` | tautan ADR-0151 | ubah |

---

### Task 1: Parameter `q` di server

**Files:**
- Modify: `server/src/services/tasks-list.ts:23-30` (tipe `TasksFilter` + `buildTasksPage`)
- Modify: `shared/src/dto.ts:767-772` (`zTopicParams.tasks`)
- Test: `server/test/tasks-list.test.ts`, `server/test/team-topic.test.ts`

**Interfaces:**
- Consumes: `buildTasksPage(f: TasksFilter)` yang sudah ada.
- Produces: `TasksFilter` bertambah `q?: string`; `zTopicParams.tasks` menerima `q` opsional (≤200 karakter). Klien (Task 6) mengirim `q` lewat `api.listTasks` dan lewat `params` langganan.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `describe("buildTasksPage", …)` pada `server/test/tasks-list.test.ts`:

```ts
  // Cermin `buildTicketsPage`: disaring DI MEMORI, bukan lewat `contains` Prisma — `contains` di
  // SQLite peka huruf besar-kecil untuk non-ASCII dan `mode: "insensitive"` tak didukung provider
  // ini. Disaring SEBELUM paginasi, jadi pencarian menjangkau seluruh tabel, bukan halaman.
  it("q mencocoki judul, tak peka huruf besar-kecil", async () => {
    expect((await buildTasksPage({ q: "desain" })).items.map((t) => t.id)).toEqual(["t1"]);
    expect((await buildTasksPage({ q: "DESAIN" })).items.map((t) => t.id)).toEqual(["t1"]);
  });

  it("q mencocoki detail", async () => {
    await prisma.task.update({ where: { id: "t3" }, data: { detail: "bahas ANGGARAN kuartal" } });
    expect((await buildTasksPage({ q: "anggaran" })).items.map((t) => t.id)).toEqual(["t3"]);
  });

  it("q disaring sebelum paginasi — total = jumlah yang cocok, bukan jumlah tabel", async () => {
    const p = await buildTasksPage({ q: "de", page: 1, limit: 1 });
    expect(p.total).toBe(2);              // Desain + Deploy
    expect(p.items).toHaveLength(1);
  });

  it("q tanpa kecocokan mengembalikan halaman kosong, bukan seluruh tabel", async () => {
    const p = await buildTasksPage({ q: "tidak-ada-ini" });
    expect(p.items).toEqual([]);
    expect(p.total).toBe(0);
  });
```

Tambahkan di `server/test/team-topic.test.ts`, di dalam `describe` yang sama:

```ts
  // SPEC-946 · pencarian papan tim menyeberang sebagai parameter langganan supaya plafon 200
  // berlaku pada HASIL pencarian, bukan pada potongan pertama tabel.
  it("menerima q opsional", () => {
    expect(parseParams("tasks", { q: "desain", page: 1, limit: 20 }))
      .toEqual({ q: "desain", page: 1, limit: 20 });
    expect(parseParams("tasks", { q: "x".repeat(201), page: 1, limit: 20 })).toBeUndefined();
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u DATABASE_URL -u NODE_ENV \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/tasks-list.test.ts server/test/team-topic.test.ts
```

Diharapkan: GAGAL. `buildTasksPage({ q: … })` menolak properti `q` di tipe (`Object literal may only specify known properties`), dan `parseParams("tasks", { q: … })` mengembalikan `undefined` karena `.strict()`.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/tasks-list.ts`, tambahkan `q` ke tipe:

```ts
export type TasksFilter = {
  projectId?: string; status?: string; memberId?: string; q?: string; page?: number; limit?: number;
};
```

lalu di `buildTasksPage`, tepat SESUDAH `const rows = await prisma.task.findMany(...)`, ganti `const rows` menjadi `let rows` dan sisipkan:

```ts
  // Cermin `buildTicketsPage`: disaring di MEMORI, bukan lewat `contains` Prisma — `contains` di
  // SQLite peka huruf besar-kecil untuk non-ASCII, dan `mode: "insensitive"` tak didukung provider
  // ini. Di SINI, sebelum `paginate`, supaya plafon halaman berlaku pada HASIL pencarian: menyaring
  // sesudahnya membuat pencarian buta terhadap baris di luar potongan pertama.
  if (f.q) {
    const n = f.q.toLowerCase();
    rows = rows.filter((t) => `${t.title} ${t.detail ?? ""}`.toLowerCase().includes(n));
  }
```

Di `shared/src/dto.ts`, di dalam `zTopicParams.tasks`, tambahkan satu baris sesudah `memberId`:

```ts
    // SPEC-946 · pencarian papan tim. Cermin `tickets` di atas — disaring server SEBELUM paginasi.
    q: z.string().max(200).optional(),
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u DATABASE_URL -u NODE_ENV \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/tasks-list.test.ts server/test/team-topic.test.ts server/test/tasks.route.test.ts
```

Diharapkan: seluruhnya PASS.

- [x] **Step 5: Typecheck server & shared**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```

Diharapkan: nol galat.

- [x] **Step 6: Commit**

```bash
git add server/src/services/tasks-list.ts shared/src/dto.ts server/test/tasks-list.test.ts server/test/team-topic.test.ts
git commit -m "feat(946): q pada GET /api/tasks dan topik tasks"
```

---

### Task 2: `team-rules.ts` — aturan papan sebagai fungsi murni

**Files:**
- Create: `src/src/screens/team-rules.ts`
- Modify: `shared/src/team.ts` (ekspor tipe input zod)
- Test: `src/test/team-rules.test.ts`

**Interfaces:**
- Consumes: `TASK_STATUSES`, `TaskStatus`, `TaskView` dari `@hanoman/shared`.
- Produces:
  - `TEAM_COLUMNS: { key: TaskStatus; label: string }[]`
  - `type Board = Record<TaskStatus, TaskView[]>`
  - `emptyBoard(): Board`
  - `canDropTask(from: TaskStatus, to: TaskStatus): boolean`
  - `nextOrder(items: { order: number }[]): number`
  - `moveCard(board, id, from, to): { board: Board; patch: { status: TaskStatus; order: number } } | null`
  - `replaceCard(board: Board, task: TaskView): Board`
  - `dateInputValue(iso: string | null): string`
  - `dateInputToIso(v: string): string | null`
  - dari `@hanoman/shared`: `CreateTaskInput`, `PatchTaskInput`, `CreateMemberInput`, `PatchMemberInput`

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/team-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { TaskView } from "@hanoman/shared";
import {
  TEAM_COLUMNS, emptyBoard, canDropTask, nextOrder, moveCard, replaceCard,
  dateInputValue, dateInputToIso,
} from "../src/screens/team-rules";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p", title: "Desain", detail: null, status: "backlog",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
  ...over,
});

describe("TEAM_COLUMNS", () => {
  it("empat kolom, urutannya TASK_STATUSES", () => {
    expect(TEAM_COLUMNS.map((c) => c.key)).toEqual(["backlog", "doing", "review", "done"]);
    expect(TEAM_COLUMNS.map((c) => c.label)).toEqual(["Backlog", "Dikerjakan", "Review", "Selesai"]);
  });
});

/* Di board Backlog `canDrop` MENYEMPIT — `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024).
   Di sini aturannya berbalik: `Task.status` milik manusia. */
describe("canDropTask", () => {
  it("semua kolom saling menerima", () => {
    expect(canDropTask("backlog", "done")).toBe(true);
    expect(canDropTask("done", "backlog")).toBe(true);
    expect(canDropTask("review", "doing")).toBe(true);
  });
  it("kolom asal ditolak — itu bukan perpindahan", () => {
    expect(canDropTask("doing", "doing")).toBe(false);
  });
});

describe("nextOrder", () => {
  it("kolom kosong mulai dari 0", () => {
    expect(nextOrder([])).toBe(0);
  });
  it("max + 1, tak peduli urutan masukan", () => {
    expect(nextOrder([{ order: 3 }, { order: 1 }, { order: 7 }])).toBe(8);
  });
  it("nilai negatif tetap menghasilkan urutan yang naik", () => {
    expect(nextOrder([{ order: -4 }])).toBe(-3);
  });
});

describe("moveCard", () => {
  it("memindahkan kartu antar-larik dan menghitung order tujuan", () => {
    const board = emptyBoard();
    board.backlog = [task({ id: "a" })];
    board.doing = [task({ id: "b", status: "doing", order: 5 })];
    const r = moveCard(board, "a", "backlog", "doing")!;
    expect(r.patch).toEqual({ status: "doing", order: 6 });
    expect(r.board.backlog).toEqual([]);
    expect(r.board.doing.map((t) => t.id)).toEqual(["b", "a"]);
    // Kartu yang berpindah membawa nilai BARU-nya, bukan nilai lama: papan optimistis dan
    // muatan PATCH lahir dari satu fungsi supaya keduanya tak bisa berselisih.
    expect(r.board.doing[1]!.status).toBe("doing");
    expect(r.board.doing[1]!.order).toBe(6);
  });
  it("papan asal tak dimutasi", () => {
    const board = emptyBoard();
    board.backlog = [task({ id: "a" })];
    moveCard(board, "a", "backlog", "review");
    expect(board.backlog.map((t) => t.id)).toEqual(["a"]);
  });
  it("null untuk kolom yang sama, dan untuk id yang tak ada", () => {
    const board = emptyBoard();
    board.backlog = [task({ id: "a" })];
    expect(moveCard(board, "a", "backlog", "backlog")).toBeNull();
    expect(moveCard(board, "hantu", "backlog", "doing")).toBeNull();
  });
});

describe("replaceCard", () => {
  it("mengganti kartu di kolomnya sendiri tanpa memindahkannya", () => {
    const board = emptyBoard();
    board.doing = [task({ id: "a", status: "doing" }), task({ id: "b", status: "doing" })];
    const next = replaceCard(board, task({ id: "a", status: "doing", memberId: "x@y.id" }));
    expect(next.doing.map((t) => t.id)).toEqual(["a", "b"]);
    expect(next.doing[0]!.memberId).toBe("x@y.id");
  });
});

/* `<input type="date">` memancarkan YYYY-MM-DD; `zCreateTask` menuntut ISO 8601 BER-OFFSET.
   Mengirim nilai input apa adanya dijawab 400 oleh route — tanpa satu pun petunjuk di layar. */
describe("konversi tanggal", () => {
  it("iso → nilai input", () => {
    expect(dateInputValue("2026-09-12T12:00:00.000Z")).toBe("2026-09-12");
    expect(dateInputValue(null)).toBe("");
  });
  it("nilai input → iso ber-offset", () => {
    expect(dateInputToIso("2026-09-12")).toBe("2026-09-12T12:00:00.000Z");
  });
  it("bolak-balik tak menggeser tanggal", () => {
    expect(dateInputValue(dateInputToIso("2026-09-12"))).toBe("2026-09-12");
  });
  it("kosong & bentuk asing jadi null, bukan Invalid Date", () => {
    expect(dateInputToIso("")).toBeNull();
    expect(dateInputToIso("besok")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/team-rules.test.ts
```

Diharapkan: GAGAL — `Failed to resolve import "../src/screens/team-rules"`.

- [x] **Step 3: Implementasi**

Buat `src/src/screens/team-rules.ts`:

```ts
import { TASK_STATUSES, type TaskStatus, type TaskView } from "@hanoman/shared";

// SPEC-946 · aturan papan tim sebagai fungsi MURNI: nol React, nol I/O, jadi ia bisa diuji tanpa
// jsdom dan tak bisa diam-diam menumbuhkan state. Dipisah karena `from`/`to` yang tertukar LOLOS
// dari unit test aturannya sendiri — yang menangkapnya render test yang men-drag kartu sungguhan
// (`src/test/team-board.test.tsx`), dan itu hanya bisa ditulis kalau aturannya punya nama.

/** Label kolom. `Record<TaskStatus, …>` supaya status baru = galat kompilasi, bukan kolom tanpa
    judul. Kolomnya lahir dari `TASK_STATUSES`, BUKAN daftar literal baru: `COLUMNS` milik
    `BacklogScreen` sudah jadi cermin kedua, dan yang ketiga akan drift. */
const COLUMN_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog", doing: "Dikerjakan", review: "Review", done: "Selesai",
};

export const TEAM_COLUMNS: { key: TaskStatus; label: string }[] =
  TASK_STATUSES.map((key) => ({ key, label: COLUMN_LABEL[key] }));

export type Board = Record<TaskStatus, TaskView[]>;

export const emptyBoard = (): Board =>
  Object.fromEntries(TASK_STATUSES.map((s) => [s, [] as TaskView[]])) as Board;

/**
 * Berbeda dari `canDrop` board Backlog, yang MENYEMPIT karena `Spec.stage` diturunkan dari fase
 * sesi (ADR-0008/0024) dan UI yang menulisnya membuat `executing`/`done` tercapai tanpa sesi yang
 * benar-benar berjalan. `Task.status` milik manusia, jadi keempat kolom saling menerima.
 *
 * Yang tersisa satu larangan: drop ke kolom asal bukan perpindahan. Menerimanya berarti satu PATCH
 * yang menulis nilai yang sudah ada, satu baris `SyncLog`, dan satu siaran ke tiap device — biaya
 * baris yang lahir tanpa pembaca sudah terukur di ADR-0131.
 */
export const canDropTask = (from: TaskStatus, to: TaskStatus): boolean => from !== to;

/** `order` bagi kartu yang mendarat di UJUNG kolom tujuan. Kolom kosong mulai dari 0. */
export const nextOrder = (items: { order: number }[]): number =>
  items.reduce((max, t) => (t.order > max ? t.order : max), -1) + 1;

/**
 * Pemindahan OPTIMISTIS. Mengembalikan papan baru berikut muatan PATCH-nya — keduanya lahir dari
 * satu fungsi supaya `order` yang ditampilkan dan yang disimpan tak bisa berselisih.
 *
 * `null` = tak ada yang berubah (tujuannya kolomnya sendiri, atau kartunya tak ada di kolom asal).
 */
export function moveCard(board: Board, id: string, from: TaskStatus, to: TaskStatus):
  { board: Board; patch: { status: TaskStatus; order: number } } | null {
  if (!canDropTask(from, to)) return null;
  const card = board[from].find((t) => t.id === id);
  if (!card) return null;
  const patch = { status: to, order: nextOrder(board[to]) };
  const next: Board = { ...board };
  next[from] = board[from].filter((t) => t.id !== id);
  next[to] = [...board[to], { ...card, ...patch }];
  return { board: next, patch };
}

/** Mengganti satu kartu di tempatnya — dipakai mutasi yang TIDAK memindahkan kolom (assignee). */
export function replaceCard(board: Board, task: TaskView): Board {
  const next: Board = { ...board };
  next[task.status] = board[task.status].map((t) => (t.id === task.id ? task : t));
  return next;
}

/**
 * `<input type="date">` memancarkan `YYYY-MM-DD`, sedangkan `zCreateTask` menuntut ISO 8601
 * BER-OFFSET (`z.string().datetime({ offset: true })`) — mengirim nilai input apa adanya dijawab
 * `400` oleh route. Konversinya duduk di SATU tempat; dua salinan adalah cara keduanya mulai
 * berbeda.
 */
export const dateInputValue = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

/** Tengah hari UTC, bukan tengah malam: `T00:00:00Z` mundur ke tanggal sebelumnya di zona waktu
    barat, dan tanggal yang bergeser sehari saat dibaca kembali adalah bug yang tak memunculkan
    satu pun error. */
export const dateInputToIso = (v: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00.000Z` : null;
```

Tambahkan di akhir `shared/src/team.ts` (tipe INPUT zod — dipakai klien untuk membentuk body tanpa membundel zod ke frontend; `z.infer` memberi tipe KELUARAN yang menjadikan `status`/`priority` wajib gara-gara `.default()`):

```ts
// Tipe MASUKAN zod — bentuk yang dikirim pemanggil, bukan bentuk sesudah `.default()` diterapkan.
// Klien memakainya supaya `status`/`priority` tetap opsional dan tak ada cermin bentuk keempat.
export type CreateTaskInput = z.input<typeof zCreateTask>;
export type PatchTaskInput = z.input<typeof zPatchTask>;
export type CreateMemberInput = z.input<typeof zCreateMember>;
export type PatchMemberInput = z.input<typeof zPatchMember>;
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/team-rules.test.ts
```

Diharapkan: PASS, 14 test.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/team-rules.ts src/test/team-rules.test.ts shared/src/team.ts
git commit -m "feat(946): aturan papan tim sebagai fungsi murni"
```

---

### Task 3: Fungsi `api.*` untuk `/tasks` & `/members`

**Files:**
- Modify: `src/src/api/client.ts:1` (impor tipe) dan objek `api` (sesudah blok tiket, `:568`)
- Test: `src/test/api-client.test.ts`

**Interfaces:**
- Consumes: `paths.tasks`, `paths.task(id)`, `paths.members`, `paths.member(id)` (`shared/src/api.ts:215-218`); `CreateTaskInput`/`PatchTaskInput`/`CreateMemberInput`/`PatchMemberInput` dari Task 2.
- Produces:
  - `api.listTasks(p?: { projectId?; status?; memberId?; q?; page?; limit? }): Promise<Paginated<TaskView>>`
  - `api.createTask(b: CreateTaskInput): Promise<TaskView>`
  - `api.patchTask(id: string, b: PatchTaskInput): Promise<TaskView>`
  - `api.deleteTask(id: string): Promise<void>`
  - `api.listMembers(p?: { active?: boolean; page?: number; limit?: number }): Promise<Paginated<MemberView>>`
  - `api.createMember(b: CreateMemberInput): Promise<MemberView>`
  - `api.patchMember(id: string, b: PatchMemberInput): Promise<MemberView>`
  - `api.deleteMember(id: string): Promise<void>`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan `describe` baru di akhir `src/test/api-client.test.ts` (ikuti pola stub `fetch` yang sudah dipakai berkas itu — baca 20 baris pertamanya lebih dulu dan pakai helper yang sama):

```ts
describe("SPEC-946 · papan tim", () => {
  it("listTasks membuang penyaring kosong dari query", async () => {
    const f = stubFetch({ items: [], total: 0, page: 1, pageSize: 0 });
    await api.listTasks({ projectId: "p1", status: "doing", q: "", page: 1, limit: 200 });
    expect(f.mock.calls[0]![0]).toBe("/api/tasks?projectId=p1&status=doing&page=1&limit=200");
  });

  it("createTask mem-POST body apa adanya", async () => {
    const f = stubFetch({ id: "t1" });
    await api.createTask({ title: "Desain", projectId: "p1" });
    expect(f.mock.calls[0]![0]).toBe("/api/tasks");
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ title: "Desain", projectId: "p1" });
  });

  it("patchTask memakai id ter-encode", async () => {
    const f = stubFetch({ id: "t 1" });
    await api.patchTask("t 1", { status: "done" });
    expect(f.mock.calls[0]![0]).toBe("/api/tasks/t%201");
    expect(f.mock.calls[0]![1]!.method).toBe("PATCH");
  });

  // `Member.id` adalah email ternormalisasi, jadi ia SELALU memuat "@" — path yang tak di-encode
  // adalah cara id anggota mulai hilang di tengah URL.
  it("patchMember meng-encode id yang berupa email", async () => {
    const f = stubFetch({ id: "a@x.id" });
    await api.patchMember("a@x.id", { name: "A" });
    expect(f.mock.calls[0]![0]).toBe("/api/members/a%40x.id");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/api-client.test.ts
```

Diharapkan: GAGAL — `api.listTasks is not a function`.

- [x] **Step 3: Implementasi**

Di `src/src/api/client.ts`, tambahkan ke daftar impor tipe di baris 1:
`type TaskView, type MemberView, type CreateTaskInput, type PatchTaskInput, type CreateMemberInput, type PatchMemberInput`.

Lalu sisipkan di objek `api`, tepat sesudah blok tiket/issue GitHub:

```ts
  // SPEC-945 · ADR-0150 · papan kerja MANUSIA. Bukan backlog: `status` di sini milik manusia,
  // sementara `Spec.stage` diturunkan dari fase sesi. `members` GLOBAL, bukan per project —
  // task boleh tanpa project (ADR-0150 keputusan 3).
  listTasks: (p: { projectId?: string; status?: string; memberId?: string; q?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<TaskView>>(paths.tasks + qs(p)),
  createTask: (b: CreateTaskInput) => j<TaskView>(paths.tasks, { method: "POST", ...body(b) }),
  patchTask: (id: string, b: PatchTaskInput) => j<TaskView>(paths.task(id), { method: "PATCH", ...body(b) }),
  deleteTask: (id: string) => j<void>(paths.task(id), { method: "DELETE" }),
  listMembers: (p: { active?: boolean; page?: number; limit?: number } = {}) =>
    j<Paginated<MemberView>>(paths.members + qs(p)),
  createMember: (b: CreateMemberInput) => j<MemberView>(paths.members, { method: "POST", ...body(b) }),
  // `email` sengaja tak ada di `PatchMemberInput`: id diturunkan darinya dan changefeed sync tak
  // punya operasi rename (ADR-0094/ADR-0150). Route menolaknya lagi dengan 400.
  patchMember: (id: string, b: PatchMemberInput) => j<MemberView>(paths.member(id), { method: "PATCH", ...body(b) }),
  deleteMember: (id: string) => j<void>(paths.member(id), { method: "DELETE" }),
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/api-client.test.ts
```

Diharapkan: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/test/api-client.test.ts
git commit -m "feat(946): fungsi api untuk /tasks dan /members"
```

---

### Task 4: `team-board.tsx` — papan, kartu, drag HTML5

**Files:**
- Create: `src/src/screens/team-board.tsx`
- Test: `src/test/team-board.test.tsx`

**Interfaces:**
- Consumes: `TEAM_COLUMNS`, `canDropTask`, `Board` dari `./team-rules`; `MemberView`/`TaskStatus`/`TaskView` dari `@hanoman/shared`; `Badge`/`Icon`/`Select`/`LIST_SCROLL_STYLE`/`FIXED_ROW_STYLE` dari `../ds`.
- Produces:
  ```ts
  export function TeamBoard(props: {
    board: Board;
    totals: Record<TaskStatus, number>;
    columns: { key: TaskStatus; label: string }[];
    members: MemberView[];
    onMove: (t: TaskView, to: TaskStatus) => void;
    onAssign: (t: TaskView, memberId: string | null) => void;
    onOpen: (t: TaskView) => void;
  }): JSX.Element
  ```

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/team-board.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { MemberView, TaskStatus, TaskView } from "@hanoman/shared";
import { TeamBoard } from "../src/screens/team-board";
import { TEAM_COLUMNS, emptyBoard, type Board } from "../src/screens/team-rules";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p", title: "Desain", detail: null, status: "backlog",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
  ...over,
});
const member = (id: string, name: string): MemberView => ({
  id, name, email: id, role: null, active: true,
  createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
});

// jsdom tak punya `DataTransfer`; event drag dioper objek palsu, pola backlog-board.test.tsx:57.
const dt = () => ({ dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" } });
const zeros = { backlog: 0, doing: 0, review: 0, done: 0 } as Record<TaskStatus, number>;

function board(over: Partial<Board>, totals: Partial<Record<TaskStatus, number>> = {}) {
  const b = { ...emptyBoard(), ...over };
  const onMove = vi.fn(), onAssign = vi.fn(), onOpen = vi.fn();
  render(<TeamBoard board={b} totals={{ ...zeros, ...totals }} columns={TEAM_COLUMNS}
    members={[member("a@x.id", "Dena")]} onMove={onMove} onAssign={onAssign} onOpen={onOpen} />);
  return { onMove, onAssign, onOpen };
}
const column = (key: TaskStatus) => screen.getByTestId(`team-col-${key}`);

describe("TeamBoard · kolom", () => {
  it("merender empat kolom milik manusia", () => {
    board({});
    for (const c of TEAM_COLUMNS) expect(column(c.key)).toBeInTheDocument();
  });

  /* Plafon langganan 200/kolom. Board yang diam-diam memotong terbaca sebagai board yang
     lengkap — dan itu kebohongan yang paling mahal di layar ini. */
  it("menyebut jumlah yang tak tertampil saat kolom melewati plafon", () => {
    board({ done: [task({ id: "d1", status: "done" })] }, { done: 340 });
    expect(screen.getByText(/menampilkan 1 dari 340/i)).toBeInTheDocument();
  });

  it("tak menyebut apa pun saat kolom utuh", () => {
    board({ done: [task({ id: "d1", status: "done" })] }, { done: 1 });
    expect(screen.queryByText(/menampilkan/i)).toBeNull();
  });
});

/* Wiring: aturan `canDropTask` sudah benar di unit test-nya, tapi `from`/`to` bisa tertukar saat
   dipasang. Ini men-drag kartu SUNGGUHAN di jsdom, bukan memanggil aturannya lagi. */
describe("TeamBoard · drag sungguhan", () => {
  it("drop lintas kolom memanggil onMove dengan kolom TUJUAN", () => {
    const { onMove } = board({ backlog: [task({ id: "a" })] });
    fireEvent.dragStart(screen.getByTestId("team-card-a"), dt());
    fireEvent.drop(column("review"), dt());
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0]![0].id).toBe("a");
    expect(onMove.mock.calls[0]![1]).toBe("review");
  });

  it("keempat kolom menerima drop — kebalikan board Backlog", () => {
    const { onMove } = board({ done: [task({ id: "z", status: "done" })] });
    fireEvent.dragStart(screen.getByTestId("team-card-z"), dt());
    fireEvent.drop(column("backlog"), dt());
    expect(onMove.mock.calls[0]![1]).toBe("backlog");
  });

  it("drop ke kolom asal tak memanggil apa pun", () => {
    const { onMove } = board({ doing: [task({ id: "a", status: "doing" })] });
    fireEvent.dragStart(screen.getByTestId("team-card-a"), dt());
    fireEvent.drop(column("doing"), dt());
    expect(onMove).not.toHaveBeenCalled();
  });
});

/* Drag HTML5 mati total di keyboard dan di layar sentuh; di sana dua Select ini SATU-SATUNYA jalan. */
describe("TeamBoard · aksi eksplisit kartu", () => {
  it("Pindah kolom mengirim mutasi yang sama dengan drag", () => {
    const { onMove } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    fireEvent.change(screen.getByLabelText("Pindah kolom: Desain"), { target: { value: "done" } });
    expect(onMove.mock.calls[0]![1]).toBe("done");
  });

  it("Tugaskan mengirim id anggota, dan kosong berarti null", () => {
    const { onAssign } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    const sel = screen.getByLabelText("Tugaskan: Desain");
    fireEvent.change(sel, { target: { value: "a@x.id" } });
    expect(onAssign.mock.calls[0]![1]).toBe("a@x.id");
    fireEvent.change(sel, { target: { value: "" } });
    expect(onAssign.mock.calls[1]![1]).toBeNull();
  });

  it("judul membuka detail", () => {
    const { onOpen } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    fireEvent.click(screen.getByRole("button", { name: "Desain" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("TeamBoard · isi kartu", () => {
  it("assignee, tanggal, dan prioritas terbaca", () => {
    board({ backlog: [task({
      id: "a", priority: "tinggi", memberId: "a@x.id",
      startDate: "2026-09-12T12:00:00.000Z", dueDate: "2026-09-20T12:00:00.000Z",
    })] });
    expect(screen.getByText("tinggi")).toBeInTheDocument();
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("Dena");
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("→");
  });

  it("anggota yang tak ada di daftar dibaca 'belum ditugaskan', bukan id mentah", () => {
    board({ backlog: [task({ id: "a", memberId: "hantu@x.id" })] });
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("belum ditugaskan");
    expect(screen.getByTestId("team-card-a")).not.toHaveTextContent("hantu@x.id");
  });

  it("task tanpa project diberi label, bukan dibiarkan kosong", () => {
    board({ backlog: [task({ id: "a", projectId: null })] });
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("tanpa project");
  });

  /* `specId` terisi + `spec` null = tautan putus (ADR-0150 keputusan 5). Bedanya dengan "tak
     pernah dieskalasi" harus TERLIHAT. Aksinya item C. */
  it("membedakan tautan hidup dari tautan putus", () => {
    board({ backlog: [
      task({ id: "a", specId: "SPEC-1", spec: { id: "SPEC-1", stage: "executing", priority: "tinggi" } }),
      task({ id: "b", specId: "SPEC-9", spec: null }),
    ] });
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("SPEC-1");
    expect(screen.getByTestId("team-card-b")).toHaveTextContent("tautan putus");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/team-board.test.tsx
```

Diharapkan: GAGAL — `Failed to resolve import "../src/screens/team-board"`.

- [x] **Step 3: Implementasi**

Buat `src/src/screens/team-board.tsx`:

```tsx
import React from "react";
import type { MemberView, TaskStatus, TaskView } from "@hanoman/shared";
import { Badge, Icon, Select, LIST_SCROLL_STYLE, FIXED_ROW_STYLE } from "../ds";
import { TEAM_COLUMNS, canDropTask, type Board } from "./team-rules";

/* SPEC-946 · papan kanban MANUSIA. Kolomnya `Task.status` — milik manusia — bukan `Spec.stage`
   yang diturunkan dari fase sesi (ADR-0008/0024). Konsekuensinya keempat kolom saling menerima
   drop, kebalikan board Backlog yang hampir seluruhnya menolaknya. */

const PRIO_TONE: Record<string, "err" | "warn" | "neutral"> = {
  tinggi: "err", sedang: "warn", rendah: "neutral",
};

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

function TaskCard({ task, members, dragging, onDragStart, onDragEnd, onOpen, onMove, onAssign }: {
  task: TaskView; members: MemberView[]; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void;
  onOpen: (t: TaskView) => void;
  onMove: (t: TaskView, to: TaskStatus) => void;
  onAssign: (t: TaskView, memberId: string | null) => void;
}) {
  // Anggota bisa lenyap dari daftar sebelum kartunya menyusul (frame sync mendahului). Yang
  // dirender tetap kalimat manusia, bukan id mentah.
  const assignee = members.find((m) => m.id === task.memberId)?.name ?? "belum ditugaskan";
  const dates = taskDates(task);
  return (
    <div draggable data-testid={`team-card-${task.id}`}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      style={{
        // `0 0 auto`: tanpa ini kartu menyusut mengisi kolom, bukan kolomnya yang menggulir.
        flex: "0 0 auto",
        background: "var(--surface-card)", border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-md)", padding: 10, boxShadow: "var(--shadow-xs)",
        cursor: "grab", opacity: dragging ? 0.4 : 1,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Badge tone={PRIO_TONE[task.priority] ?? "neutral"} size="sm"
          variant={task.priority === "tinggi" ? "soft" : "outline"}>{task.priority}</Badge>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{task.projectId ?? "tanpa project"}</span>
      </div>
      <button type="button" onClick={() => onOpen(task)} style={{
        display: "block", width: "100%", textAlign: "left", border: "none", background: "none",
        padding: 0, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13,
        fontWeight: "var(--weight-medium)", color: "var(--text-strong)", lineHeight: 1.35,
      }}>{task.title}</button>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap",
        fontSize: "var(--text-xs)", color: "var(--text-subtle)",
      }}>
        <Icon name="user" size={12} color="var(--text-subtle)" />
        <span>{assignee}</span>
        {dates && <><span aria-hidden="true">·</span><span>{dates}</span></>}
      </div>
      {task.specId && (
        <div style={{ marginTop: 6 }}>
          {/* ADR-0150 keputusan 5 · `specId` terisi tanpa `spec` = tautan putus. Bedanya dengan
              "tak pernah dieskalasi" harus terlihat; aksinya milik item C. */}
          <Badge tone={task.spec ? "ok" : "warn"} size="sm" icon={task.spec ? "link" : "unlink"}>
            {task.spec ? `${task.spec.id} · ${task.spec.stage}` : "tautan putus"}
          </Badge>
        </div>
      )}
      {/* Drag HTML5 mati total di keyboard dan di layar sentuh. Dua Select ini bukan hiasan —
          di sana merekalah satu-satunya jalan. `aria-label` memuat judul supaya papan berisi
          banyak kartu tetap punya nama yang unik bagi pembaca layar DAN bagi test. */}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Select size="sm" value={task.status} aria-label={`Pindah kolom: ${task.title}`}
          onChange={(e) => onMove(task, e.target.value as TaskStatus)}
          options={TEAM_COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
          style={{ flex: 1, minWidth: 0 }} />
        <Select size="sm" value={task.memberId ?? ""} aria-label={`Tugaskan: ${task.title}`}
          onChange={(e) => onAssign(task, e.target.value || null)}
          options={[{ value: "", label: "Belum ditugaskan" },
            ...members.map((m) => ({ value: m.id, label: m.name }))]}
          style={{ flex: 1, minWidth: 0 }} />
      </div>
    </div>
  );
}

export function TeamBoard({ board, totals, columns, members, onMove, onAssign, onOpen }: {
  board: Board; totals: Record<TaskStatus, number>;
  columns: { key: TaskStatus; label: string }[];
  members: MemberView[];
  onMove: (t: TaskView, to: TaskStatus) => void;
  onAssign: (t: TaskView, memberId: string | null) => void;
  onOpen: (t: TaskView) => void;
}) {
  const [drag, setDrag] = React.useState<{ task: TaskView; from: TaskStatus } | null>(null);
  const [over, setOver] = React.useState<TaskStatus | null>(null);

  const drop = (to: TaskStatus) => {
    if (drag && canDropTask(drag.from, to)) onMove(drag.task, to);
    setDrag(null);
    setOver(null);
  };

  return (
    /* Baris kolom menggulir MENDATAR; tiap KOLOM menggulir tegak sendiri, jadi judul kolom tak
       pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. */
    <div data-testid="team-board" className="hn-board-local-overflow" style={{
      flex: "1 1 auto", minHeight: 0, display: "flex", gap: 10,
      overflowX: "auto", overflowY: "hidden", alignItems: "stretch", paddingBottom: 4,
    }}>
      {columns.map((c) => {
        const items = board[c.key];
        const active = !!drag && canDropTask(drag.from, c.key);
        const hot = active && over === c.key;
        const hidden = Math.max(0, (totals[c.key] ?? 0) - items.length);
        return (
          <div key={c.key} data-testid={`team-col-${c.key}`}
            onDragOver={(e) => {
              if (!active) return;   // tanpa preventDefault, kolom ini menolak drop
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(c.key);
            }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c.key); }}
            style={{
              flex: "0 0 244px", display: "flex", flexDirection: "column", minHeight: 0, padding: 10,
              borderRadius: "var(--radius-lg)",
              background: hot ? "var(--brass-100)" : "var(--bone-100)",
              border: `1px ${active ? "dashed" : "solid"} ${hot ? "var(--brass-500)" : "var(--border-hair)"}`,
              opacity: drag && !active ? 0.5 : 1, transition: "var(--transition-fast)",
            }}>
            <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span className="hn-eyebrow">{c.label}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>
                {items.length}
              </span>
            </div>
            {/* Zona drop mencakup ruang kosong di bawah kartu: event menggelembung ke kolom. */}
            <div style={{ ...LIST_SCROLL_STYLE, display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((t) => (
                <TaskCard key={t.id} task={t} members={members}
                  dragging={drag?.task.id === t.id}
                  onDragStart={() => setDrag({ task: t, from: c.key })}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onOpen={onOpen} onMove={onMove} onAssign={onAssign} />
              ))}
            </div>
            {/* Plafon langganan 200/kolom (ADR-0151). Papan yang diam-diam memotong terbaca
                sebagai papan yang lengkap. */}
            {hidden > 0 && (
              <div style={{
                ...FIXED_ROW_STYLE, marginTop: 8, fontSize: "var(--text-xs)", color: "var(--amber-600)",
              }}>
                menampilkan {items.length} dari {totals[c.key]} — persempit penyaring
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/team-board.test.tsx
```

Diharapkan: PASS, 13 test.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/team-board.tsx src/test/team-board.test.tsx
git commit -m "feat(946): papan tim empat kolom, semua kolom menerima drop"
```

---

### Task 5: `TaskModal.tsx` — buat, ubah, hapus kartu

**Files:**
- Create: `src/src/screens/TaskModal.tsx`
- Test: dicakup `src/test/team-screen.test.tsx` (Task 7); tak ada berkas test sendiri

**Interfaces:**
- Consumes: `api.createTask`/`patchTask`/`deleteTask` (Task 3); `dateInputValue`/`dateInputToIso`/`TEAM_COLUMNS` (Task 2); `useConfirm`, `Modal`, `Field`, `Input`, `Select`, `HnTextarea`, `Button` dari `../ds`.
- Produces:
  ```ts
  export function TaskModal(props: {
    open: boolean;
    task: TaskView | null;              // null = buat baru
    projects: ProjectVM[];
    members: MemberView[];
    defaultProjectId: string | null;    // project yang sedang disaring, jadi form tak mulai kosong
    onClose: () => void;
    onSaved: () => void;                // pemanggil memuat ulang papan
    onToast: (msg: string, kind?: string, icon?: string) => void;
  }): JSX.Element | null
  ```

- [x] **Step 1: Implementasi**

Buat `src/src/screens/TaskModal.tsx`:

```tsx
import React from "react";
import type { MemberView, TaskView } from "@hanoman/shared";
import { Button, Field, HnTextarea, Input, Modal, Select, useConfirm } from "../ds";
import { api } from "../api/client";
import { TEAM_COLUMNS, dateInputToIso, dateInputValue } from "./team-rules";
import type { ProjectVM } from "./types";

// SPEC-946 · satu form untuk buat DAN ubah, dibedakan oleh ada/tidaknya kartu yang dipegang.
// Dua modal untuk satu bentuk data adalah cara keduanya mulai menerima field yang berbeda.

const PRIORITIES = [
  { value: "tinggi", label: "Tinggi" }, { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" },
];

type Form = {
  title: string; detail: string; projectId: string; status: string;
  priority: string; memberId: string; startDate: string; dueDate: string;
};

const formOf = (t: TaskView | null, defaultProjectId: string | null): Form => ({
  title: t?.title ?? "",
  detail: t?.detail ?? "",
  projectId: t ? (t.projectId ?? "") : (defaultProjectId ?? ""),
  status: t?.status ?? "backlog",
  priority: t?.priority ?? "sedang",
  memberId: t?.memberId ?? "",
  startDate: dateInputValue(t?.startDate ?? null),
  dueDate: dateInputValue(t?.dueDate ?? null),
});

export function TaskModal({ open, task, projects, members, defaultProjectId, onClose, onSaved, onToast }: {
  open: boolean; task: TaskView | null; projects: ProjectVM[]; members: MemberView[];
  defaultProjectId: string | null;
  onClose: () => void; onSaved: () => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
}) {
  const [form, setForm] = React.useState<Form>(() => formOf(task, defaultProjectId));
  const [busy, setBusy] = React.useState(false);
  const { confirm, dialog } = useConfirm();

  // Kartu yang dibuka berganti tanpa modal ditutup (klik kartu lain di belakang overlay tak
  // mungkin, tapi `onSaved` → reload mengganti objeknya). Kuncinya id, bukan objeknya.
  const key = task?.id ?? "";
  const seeded = React.useRef(key);
  if (open && seeded.current !== key) { seeded.current = key; setForm(formOf(task, defaultProjectId)); }

  if (!open) return null;
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!form.title.trim()) { onToast("Judul tugas wajib diisi", "err", "x-circle"); return; }
    setBusy(true);
    // `null` berarti "kosongkan", `undefined` berarti "jangan sentuh" — route membedakan keduanya,
    // dan form ini SELALU mengirim keadaan penuh, jadi yang kosong memang harus jadi null.
    const payload = {
      title: form.title.trim(),
      detail: form.detail.trim() || null,
      projectId: form.projectId || null,
      status: form.status as TaskView["status"],
      priority: form.priority,
      memberId: form.memberId || null,
      startDate: dateInputToIso(form.startDate),
      dueDate: dateInputToIso(form.dueDate),
    };
    try {
      if (task) await api.patchTask(task.id, payload);
      else await api.createTask(payload);
      onToast(task ? "Tugas diperbarui" : "Tugas dibuat", "ok", "check");
      onSaved();
      onClose();
    } catch { onToast("Gagal menyimpan tugas", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!task) return;
    if (!await confirm({
      title: `Hapus "${task.title}"?`,
      message: "Kartu ini hilang dari papan di semua device yang tersinkron.",
      confirmLabel: "Hapus tugas", tone: "danger", icon: "trash-2",
      run: () => api.deleteTask(task.id),
    })) return;
    onToast("Tugas dihapus", "ok", "trash-2");
    onSaved();
    onClose();
  }

  return (
    <>
      <Modal open={open} onClose={onClose} icon="clipboard-list"
        eyebrow="Papan tim" title={task ? "Ubah tugas" : "Tugas baru"}
        footer={
          <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
            {task && <Button variant="ghost" leftIcon="trash-2" onClick={remove} disabled={busy}>Hapus</Button>}
            <span style={{ flex: 1 }} />
            <Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button>
            <Button onClick={save} loading={busy}>{task ? "Simpan" : "Buat tugas"}</Button>
          </div>
        }>
        <Field label="Judul">
          <Input value={form.title} aria-label="Judul tugas" placeholder="mis. Rapikan halaman harga"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ title: e.target.value })}
            style={{ width: "100%" }} />
        </Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Project">
            {/* `Task.projectId` nullable — tugas internal tim memang tak punya project (ADR-0150). */}
            <Select value={form.projectId} aria-label="Project tugas"
              onChange={(e) => set({ projectId: e.target.value })}
              options={[{ value: "", label: "Tanpa project" },
                ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          </Field>
          <Field label="Kolom">
            <Select value={form.status} aria-label="Kolom tugas"
              onChange={(e) => set({ status: e.target.value })}
              options={TEAM_COLUMNS.map((c) => ({ value: c.key, label: c.label }))} />
          </Field>
          <Field label="Prioritas">
            <Select value={form.priority} aria-label="Prioritas tugas"
              onChange={(e) => set({ priority: e.target.value })} options={PRIORITIES} />
          </Field>
        </div>
        <Field label="Ditugaskan ke">
          <Select value={form.memberId} aria-label="Anggota tugas"
            onChange={(e) => set({ memberId: e.target.value })}
            options={[{ value: "", label: "Belum ditugaskan" },
              ...members.map((m) => ({ value: m.id, label: m.role ? `${m.name} · ${m.role}` : m.name }))]}
            style={{ width: "100%" }} />
        </Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Mulai">
            <Input type="date" value={form.startDate} aria-label="Tanggal mulai"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ startDate: e.target.value })} />
          </Field>
          <Field label="Tenggat">
            <Input type="date" value={form.dueDate} aria-label="Tanggal tenggat"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ dueDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Detail" hint="Opsional — konteks yang tak muat di judul.">
          <HnTextarea value={form.detail} aria-label="Detail tugas" rows={4}
            onChange={(e) => set({ detail: e.target.value })} />
        </Field>
      </Modal>
      {dialog}
    </>
  );
}
```

- [x] **Step 2: Typecheck frontend**

```bash
pnpm --filter ./src typecheck
```

Diharapkan: nol galat. (Test perilakunya menyusul di Task 7 — modal ini tak punya jalan masuk sampai `TeamScreen` ada.)

- [x] **Step 3: Commit**

```bash
git add src/src/screens/TaskModal.tsx
git commit -m "feat(946): modal buat/ubah/hapus tugas"
```

---

### Task 6: `MembersPanel.tsx` — modal kelola anggota

**Files:**
- Create: `src/src/screens/MembersPanel.tsx`
- Test: `src/test/members-panel.test.tsx`

**Interfaces:**
- Consumes: `api.listMembers`/`createMember`/`patchMember`/`deleteMember` (Task 3).
- Produces:
  ```ts
  export function MembersPanel(props: {
    open: boolean;
    onClose: () => void;
    onChanged: (members: MemberView[]) => void;   // daftar terbaru, dipakai TeamScreen
    onToast: (msg: string, kind?: string, icon?: string) => void;
  }): JSX.Element | null
  ```

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/members-panel.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemberView } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    listMembers: vi.fn(), createMember: vi.fn(), patchMember: vi.fn(), deleteMember: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { MembersPanel } from "../src/screens/MembersPanel";
import { api } from "../src/api/client";

const member = (over: Partial<MemberView> = {}): MemberView => ({
  id: "dena@x.id", name: "Dena", email: "dena@x.id", role: "desainer", active: true,
  createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z", ...over,
});
const page = (items: MemberView[]) => ({ items, total: items.length, page: 1, pageSize: items.length });

beforeEach(() => {
  vi.mocked(api.listMembers).mockResolvedValue(page([member()]));
  vi.mocked(api.createMember).mockResolvedValue(member({ id: "b@x.id", name: "Budi", email: "b@x.id" }));
  vi.mocked(api.patchMember).mockResolvedValue(member({ name: "Dena M" }));
  vi.mocked(api.deleteMember).mockResolvedValue(undefined);
});

const open = () => {
  const onChanged = vi.fn(), onToast = vi.fn();
  render(<MembersPanel open onClose={() => {}} onChanged={onChanged} onToast={onToast} />);
  return { onChanged, onToast };
};

describe("MembersPanel", () => {
  it("memuat & menampilkan anggota beserta perannya", async () => {
    open();
    expect(await screen.findByText("Dena")).toBeInTheDocument();
    expect(screen.getByText(/desainer/)).toBeInTheDocument();
  });

  it("menambah anggota lalu memuat ulang daftarnya", async () => {
    const { onChanged } = open();
    await screen.findByText("Dena");
    fireEvent.change(screen.getByLabelText("Nama anggota baru"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByLabelText("Email anggota baru"), { target: { value: "b@x.id" } });
    fireEvent.click(screen.getByRole("button", { name: /tambah anggota/i }));
    await waitFor(() => expect(api.createMember).toHaveBeenCalledWith({ name: "Budi", email: "b@x.id", role: null }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  /* ADR-0094/ADR-0150 · id anggota DITURUNKAN dari email dan changefeed tak punya operasi rename.
     Form yang menawarkan field email lalu membuangnya adalah kelas bug yang membuat lapis kedua
     penolakan di route ditulis — jadi field itu tak boleh ada sama sekali. */
  it("tidak menawarkan field email pada baris yang sudah ada", async () => {
    open();
    await screen.findByText("Dena");
    fireEvent.click(screen.getByRole("button", { name: "Ubah Dena" }));
    expect(screen.getByLabelText("Nama Dena")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email Dena")).toBeNull();
    expect(screen.getByText(/ganti email berarti hapus lalu buat baru/i)).toBeInTheDocument();
  });

  it("menyimpan nama & peran lewat patchMember", async () => {
    open();
    await screen.findByText("Dena");
    fireEvent.click(screen.getByRole("button", { name: "Ubah Dena" }));
    fireEvent.change(screen.getByLabelText("Nama Dena"), { target: { value: "Dena M" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(api.patchMember).toHaveBeenCalledWith("dena@x.id", { name: "Dena M", role: "desainer" }));
  });

  it("menonaktifkan anggota tanpa menghapusnya", async () => {
    open();
    await screen.findByText("Dena");
    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan Dena" }));
    await waitFor(() => expect(api.patchMember).toHaveBeenCalledWith("dena@x.id", { active: false }));
  });

  /* SPEC-847 · ADR-0127 · destruktif lewat useConfirm, bukan window.confirm (dijaga
     src/test/confirm-inventory.test.ts). Dialognya menyebut bahwa task-nya TIDAK ikut terhapus. */
  it("hapus meminta konfirmasi dan menyebut nasib task-nya", async () => {
    open();
    await screen.findByText("Dena");
    fireEvent.click(screen.getByRole("button", { name: "Hapus Dena" }));
    expect(await screen.findByText(/tugasnya tidak ikut terhapus/i)).toBeInTheDocument();
    expect(api.deleteMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /hapus anggota/i }));
    await waitFor(() => expect(api.deleteMember).toHaveBeenCalledWith("dena@x.id"));
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/members-panel.test.tsx
```

Diharapkan: GAGAL — `Failed to resolve import "../src/screens/MembersPanel"`.

- [x] **Step 3: Implementasi**

Buat `src/src/screens/MembersPanel.tsx`:

```tsx
import React from "react";
import type { MemberView } from "@hanoman/shared";
import { Badge, Button, IconButton, Input, Modal, StateBlock, useConfirm } from "../ds";
import { api } from "../api/client";

/* SPEC-946 · direktori orang, dikelola DI DALAM layar Tim — bukan `SettingsScreen.tsx`, yang
   sudah 93 KB. Anggota GLOBAL, bukan per project: task boleh tanpa project, jadi direktorinya
   tak bisa digantung pada project (ADR-0150 keputusan 3). */

function MemberRow({ m, busy, onSave, onToggle, onDelete }: {
  m: MemberView; busy: boolean;
  onSave: (id: string, patch: { name: string; role: string | null }) => void;
  onToggle: (m: MemberView) => void;
  onDelete: (m: MemberView) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(m.name);
  const [role, setRole] = React.useState(m.role ?? "");

  if (editing) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", marginBottom: 8,
        border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)",
        background: "var(--surface-card)",
      }}>
        <Input size="sm" value={name} aria-label={`Nama ${m.name}`}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
        <Input size="sm" value={role} aria-label={`Peran ${m.name}`} placeholder="mis. desainer"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRole(e.target.value)} />
        {/* ADR-0094/ADR-0150 · id diturunkan dari email dan changefeed sync tak punya operasi
            rename — id yang berubah meninggalkan baris yatim di setiap mesin lain. Emailnya
            ditampilkan sebagai TEKS, tak pernah sebagai field yang bisa diketik. */}
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {m.email} — ganti email berarti hapus lalu buat baru.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" disabled={busy}
            onClick={() => { onSave(m.id, { name: name.trim(), role: role.trim() || null }); setEditing(false); }}>
            Simpan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Batal</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="hn-dense-row" style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 8,
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
      background: "var(--surface-card)", opacity: m.active ? 1 : 0.6,
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-strong)" }}>{m.name}</span>
          {m.role && <Badge tone="neutral" size="sm">{m.role}</Badge>}
          {!m.active && <Badge tone="warn" size="sm">nonaktif</Badge>}
        </span>
        <span style={{
          display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          color: "var(--text-subtle)", marginTop: 2,
        }}>{m.email}</span>
      </span>
      <IconButton icon="pencil" label={`Ubah ${m.name}`} size="sm" onClick={() => setEditing(true)} />
      <IconButton icon={m.active ? "user-minus" : "user-check"} size="sm"
        label={`${m.active ? "Nonaktifkan" : "Aktifkan"} ${m.name}`} onClick={() => onToggle(m)} />
      <IconButton icon="trash-2" label={`Hapus ${m.name}`} size="sm" onClick={() => onDelete(m)} />
    </div>
  );
}

export function MembersPanel({ open, onClose, onChanged, onToast }: {
  open: boolean; onClose: () => void;
  onChanged: (members: MemberView[]) => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
}) {
  const [list, setList] = React.useState<MemberView[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("");
  const { confirm, dialog } = useConfirm();

  const load = React.useCallback(() => {
    setState("loading");
    api.listMembers()
      .then((r) => { setList(r.items); setState("ready"); onChanged(r.items); })
      .catch(() => setState("error"));
    // `onChanged` hampir selalu arrow inline di call site; memasukkannya ke deps membuat effect
    // di bawah memuat ulang tiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => { if (open) load(); }, [open, load]);

  if (!open) return null;

  async function add() {
    if (!name.trim() || !email.trim()) { onToast("Nama & email wajib diisi", "err", "x-circle"); return; }
    setBusy(true);
    try {
      await api.createMember({ name: name.trim(), email: email.trim(), role: role.trim() || null });
      setName(""); setEmail(""); setRole("");
      onToast("Anggota ditambahkan", "ok", "user-plus");
      load();
    } catch { onToast("Gagal menambah anggota — email mungkin sudah terdaftar", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function save(id: string, patch: { name: string; role: string | null }) {
    setBusy(true);
    try { await api.patchMember(id, patch); load(); }
    catch { onToast("Gagal menyimpan anggota", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function toggle(m: MemberView) {
    setBusy(true);
    try { await api.patchMember(m.id, { active: !m.active }); load(); }
    catch { onToast("Gagal mengubah status anggota", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function remove(m: MemberView) {
    // `onDelete: SetNull` — tugasnya jadi "belum ditugaskan", tidak ikut terhapus. Operator harus
    // tahu itu SEBELUM menekan, bukan menemukannya di papan sesudahnya.
    if (!await confirm({
      title: `Hapus ${m.name} dari direktori?`,
      message: "Tugasnya tidak ikut terhapus — kartu yang ditugaskan padanya jadi 'belum ditugaskan'.",
      confirmLabel: "Hapus anggota", tone: "danger", icon: "trash-2",
      run: () => api.deleteMember(m.id),
    })) return;
    onToast("Anggota dihapus", "ok", "trash-2");
    load();
  }

  return (
    <>
      <Modal open={open} onClose={onClose} icon="users" eyebrow="Papan tim" title="Anggota" width={620}>
        <div style={{
          display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16,
          paddingBottom: 16, borderBottom: "1px solid var(--border-hair)",
        }}>
          <Input size="sm" value={name} aria-label="Nama anggota baru" placeholder="Nama"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            style={{ flex: "1 1 140px" }} />
          <Input size="sm" value={email} aria-label="Email anggota baru" placeholder="email@nafanesia.id"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            style={{ flex: "1 1 180px" }} />
          <Input size="sm" value={role} aria-label="Peran anggota baru" placeholder="Peran (opsional)"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRole(e.target.value)}
            style={{ flex: "1 1 130px" }} />
          <Button size="sm" leftIcon="user-plus" onClick={add} loading={busy}>Tambah anggota</Button>
        </div>
        {state === "loading" ? <StateBlock kind="loading" compact />
          : state === "error" ? <StateBlock kind="error" compact hint="Gagal memuat anggota."
              action={load} actionLabel="Coba lagi" />
          : list.length === 0 ? <StateBlock kind="empty" compact icon="users" title="Belum ada anggota"
              hint="Tambahkan orang di atas agar kartu papan bisa ditugaskan." />
          : list.map((m) => (
              <MemberRow key={m.id} m={m} busy={busy} onSave={save} onToggle={toggle} onDelete={remove} />
            ))}
      </Modal>
      {dialog}
    </>
  );
}
```

- [x] **Step 4: Verifikasi nama ikon baru ada di lucide**

`user-minus` dan `user-check` dipakai di berkas ini dan belum ada di daftar yang diverifikasi. Jalankan:

```bash
node -e "
const {icons} = require('./src/node_modules/lucide-react/dist/cjs/lucide-react.js');
for (const n of ['UserMinus','UserCheck','ClipboardList','Pencil']) console.log(n, !!icons[n]);
"
```

Diharapkan: keempatnya `true`. Bila ada yang `false`, ganti dengan nama yang ada — nama yang salah jatuh ke `Circle` tanpa satu pun error (SPEC-906).

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/members-panel.test.tsx
```

Diharapkan: PASS, 6 test.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/MembersPanel.tsx src/test/members-panel.test.tsx
git commit -m "feat(946): modal kelola anggota di layar Tim"
```

---

### Task 7: `TeamScreen.tsx` — toolbar, fetch per kolom, langganan per kolom

**Files:**
- Create: `src/src/screens/TeamScreen.tsx`
- Modify: `src/src/app.css:220-227` (kelas responsif toolbar)
- Test: `src/test/team-screen.test.tsx`

**Interfaces:**
- Consumes: `TeamBoard` (Task 4), `TaskModal` (Task 5), `MembersPanel` (Task 6), `team-rules` (Task 2), `api.*` (Task 3), `useLiveTopic` (`src/src/api/live.ts:33`), `usePersistedState`/`useResetOnChange`/`useScrollRestore`/`ResetViewButton`/`oneOf`/`isStr` (`src/src/ui-state`).
- Produces:
  ```ts
  export function TeamScreen(props: {
    projects: ProjectVM[];
    projectFilter: string;                       // "all" | projectId — dimiliki App (SPEC-146)
    onProjectFilter: (v: string) => void;
    onToast: (msg: string, kind?: string, icon?: string) => void;
  }): JSX.Element
  ```

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/team-screen.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemberView, TaskView } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    listTasks: vi.fn(), createTask: vi.fn(), patchTask: vi.fn(), deleteTask: vi.fn(),
    listMembers: vi.fn(), createMember: vi.fn(), patchMember: vi.fn(), deleteMember: vi.fn(),
    getConfig: vi.fn(async () => ({ sync: { running: false } })),
  },
  ApiError: class extends Error {},
}));
// Langganan WS bukan subjek berkas ini; muat awal HTTP-lah yang diuji.
vi.mock("../src/api/live", () => ({ useLiveTopic: () => {}, useEventsStatus: () => ({ connected: true, since: 0, paused: false }) }));

import { TeamScreen } from "../src/screens/TeamScreen";
import { api } from "../src/api/client";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p1", title: "Desain", detail: null, status: "backlog",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
  ...over,
});
const member = (): MemberView => ({
  id: "dena@x.id", name: "Dena", email: "dena@x.id", role: null, active: true,
  createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
});
const page = <T,>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 200 });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.listMembers).mockResolvedValue(page([member()]));
  vi.mocked(api.listTasks).mockImplementation(async (p) =>
    p?.status === "backlog" ? page([task()]) : page([]));
  vi.mocked(api.patchTask).mockResolvedValue(task({ status: "done" }));
});

const projects = [{ id: "p1", name: "Project Satu" }] as never;
const view = (projectFilter = "all") => {
  const onProjectFilter = vi.fn(), onToast = vi.fn();
  render(<TeamScreen projects={projects} projectFilter={projectFilter}
    onProjectFilter={onProjectFilter} onToast={onToast} />);
  return { onProjectFilter, onToast };
};

describe("TeamScreen · toolbar", () => {
  it("semua kontrol punya nama yang bisa dipegang", async () => {
    view();
    await screen.findByTestId("team-board");
    expect(screen.getByRole("tablist", { name: "Mode tampilan" })).toBeInTheDocument();
    for (const label of ["Cari tugas", "Filter project", "Filter kolom", "Filter anggota"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /tugas baru/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^anggota$/i })).toBeInTheDocument();
  });

  /* Satu langganan & satu fetch PER KOLOM: `order` bermakna DI DALAM kolom, jadi potongan 200
     atas himpunan gabungan memotong keempat kolom di titik yang sewenang-wenang (ADR-0151). */
  it("memuat satu halaman per kolom dengan plafon 200", async () => {
    view();
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    const statuses = vi.mocked(api.listTasks).mock.calls.map((c) => c[0]!.status);
    expect(statuses.sort()).toEqual(["backlog", "doing", "done", "review"]);
    for (const c of vi.mocked(api.listTasks).mock.calls) {
      expect(c[0]!.limit).toBe(200);
      expect(c[0]!.page).toBe(1);
    }
  });

  it("penyaring project & anggota menyeberang ke query", async () => {
    view("p1");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalled());
    expect(vi.mocked(api.listTasks).mock.calls[0]![0]!.projectId).toBe("p1");
    vi.mocked(api.listTasks).mockClear();
    fireEvent.change(screen.getByLabelText("Filter anggota"), { target: { value: "dena@x.id" } });
    await waitFor(() => expect(vi.mocked(api.listTasks).mock.calls[0]![0]!.memberId).toBe("dena@x.id"));
  });

  it("sentinel 'all' tidak ikut menyeberang sebagai penyaring", async () => {
    view("all");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalled());
    expect(vi.mocked(api.listTasks).mock.calls[0]![0]!.projectId).toBeUndefined();
  });

  /* Menyaring kolom di sebuah PAPAN berarti mempersempit kolom yang tampil — dan hanya kolom
     yang tampil yang dimuat & dilanggan, jadi biaya servernya ikut mengecil. */
  it("filter kolom mempersempit papan ke satu kolom", async () => {
    view();
    await screen.findByTestId("team-col-doing");
    vi.mocked(api.listTasks).mockClear();
    fireEvent.change(screen.getByLabelText("Filter kolom"), { target: { value: "doing" } });
    await waitFor(() => expect(screen.queryByTestId("team-col-backlog")).toBeNull());
    expect(screen.getByTestId("team-col-doing")).toBeInTheDocument();
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(1));
  });
});

describe("TeamScreen · mutasi", () => {
  it("pindah kolom mengirim status & order tujuan, lalu kartunya pindah tanpa menunggu refetch", async () => {
    view();
    await screen.findByTestId("team-card-t1");
    fireEvent.change(screen.getByLabelText("Pindah kolom: Desain"), { target: { value: "done" } });
    await waitFor(() => expect(api.patchTask).toHaveBeenCalledWith("t1", { status: "done", order: 0 }));
    expect(screen.getByTestId("team-col-done")).toHaveTextContent("Desain");
  });

  it("PATCH gagal mengembalikan kartu ke kolom asal", async () => {
    vi.mocked(api.patchTask).mockRejectedValueOnce(new Error("boom"));
    const { onToast } = view();
    await screen.findByTestId("team-card-t1");
    fireEvent.change(screen.getByLabelText("Pindah kolom: Desain"), { target: { value: "done" } });
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(screen.getByTestId("team-col-backlog")).toHaveTextContent("Desain");
  });
});

describe("TeamScreen · modal", () => {
  it("Tugas baru membuka form kosong", async () => {
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("button", { name: /tugas baru/i }));
    expect(await screen.findByLabelText("Judul tugas")).toHaveValue("");
  });

  it("judul kartu membuka form berisi kartunya", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Desain" }));
    expect(await screen.findByLabelText("Judul tugas")).toHaveValue("Desain");
  });

  // Anggota dikelola DI SINI, bukan di SettingsScreen yang sudah 93 KB.
  it("Anggota membuka modal kelola anggota", async () => {
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("button", { name: /^anggota$/i }));
    expect(await screen.findByLabelText("Email anggota baru")).toBeInTheDocument();
  });
});

describe("TeamScreen · keadaan", () => {
  it("papan kosong menawarkan pintu masuk, bukan layar kosong", async () => {
    vi.mocked(api.listTasks).mockResolvedValue(page([]));
    view();
    expect(await screen.findByText(/papan tim masih kosong/i)).toBeInTheDocument();
  });

  it("muat awal gagal menawarkan coba lagi", async () => {
    vi.mocked(api.listTasks).mockRejectedValue(new Error("boom"));
    view();
    expect(await screen.findByRole("button", { name: /coba lagi/i })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/team-screen.test.tsx
```

Diharapkan: GAGAL — `Failed to resolve import "../src/screens/TeamScreen"`.

- [x] **Step 3: Implementasi**

Buat `src/src/screens/TeamScreen.tsx`:

```tsx
import React from "react";
import type { MemberView, TaskStatus, TaskView, TopicParams } from "@hanoman/shared";
import { Button, Input, Select, StateBlock, Tabs, LIST_SCREEN_STYLE, FIXED_ROW_STYLE, LiveConnectionBadge } from "../ds";
import { api } from "../api/client";
import { useLiveTopic } from "../api/live";
import { SyncButton } from "./SyncButton";
import { TeamBoard } from "./team-board";
import { TaskModal } from "./TaskModal";
import { MembersPanel } from "./MembersPanel";
import { TEAM_COLUMNS, emptyBoard, moveCard, replaceCard, type Board } from "./team-rules";
import { usePersistedState, ResetViewButton, isStr, oneOf } from "../ui-state";
import type { ProjectVM } from "./types";

/* TeamScreen — papan kerja MANUSIA (SPEC-946 · ADR-0150/ADR-0151). Screen mandiri (pola
   TriageScreen): memuat datanya sendiri, tak lewat `gate` App.

   Papan berlangganan PER KOLOM. `zSubLimit` menjepit `limit` ke 200 dan `order` bermakna DI DALAM
   kolom, jadi satu langganan untuk seluruh papan memotong himpunan gabungan empat kolom di titik
   yang sewenang-wenang — kolom mana yang terpotong, dan seberapa, tak bisa dijelaskan kepada
   operator. Empat langganan memberi tiap kolom `total`-nya sendiri, dan plafonnya berlaku per
   kolom. Biayanya 4 dari MAX_SUBS = 16. */

const POLL_MS = 5000;
// ADR-0107 · PLAFON, bukan preferensi — nilainya sama dengan batas atas `zSubLimit`, supaya muat
// awal HTTP dan langganan WS memotong di titik yang SAMA. Muat awal tak-berbatas lalu langganan
// berplafon berarti kartu HILANG dari layar tanpa satu pun tindakan operator.
const COLUMN_LIMIT = 200;
// SPEC-908 · jeda sebelum ketikan mengubah KUNCI langganan: tiap huruf melahirkan kunci baru yang
// dibangun server di luar jadwal, dan sebelas dari dua belas langsung dibuang.
const Q_DEBOUNCE_MS = 400;

// Item B hanya membawa mode Papan. Item D (Linimasa) dan E (Lintas project) menambahkan entri ke
// array yang SAMA — bukan memasang mekanisme baru.
const TEAM_VIEWS = [{ value: "board", label: "Papan", icon: "kanban" }];

type Totals = Record<TaskStatus, number>;
const zeroTotals = (): Totals =>
  Object.fromEntries(TEAM_COLUMNS.map((c) => [c.key, 0])) as Totals;

/* Satu langganan per kolom. Komponen tanpa render karena jumlah pemanggilan hook harus tetap
   sah saat kolom disaring keluar — memasang/melepas komponennya adalah cara React yang jujur
   untuk berhenti berlangganan, dan ia tak melanggar rules-of-hooks seperti hook di dalam map. */
function ColumnFeed({ status, params, onData, refetch }: {
  status: TaskStatus;
  params: Omit<TopicParams["tasks"], "status">;
  onData: (status: TaskStatus, items: TaskView[], total: number) => void;
  refetch: () => void;
}) {
  useLiveTopic({
    topic: "tasks",
    params: { ...params, status },
    apply: (m) => onData(status, m.data.items, m.data.total),
    refetch, pollMs: POLL_MS,
  });
  return null;
}

export function TeamScreen({ projects, projectFilter, onProjectFilter, onToast }: {
  projects: ProjectVM[]; projectFilter: string;
  onProjectFilter: (v: string) => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
}) {
  const [board, setBoard] = React.useState<Board>(emptyBoard);
  const [totals, setTotals] = React.useState<Totals>(zeroTotals);
  const [members, setMembers] = React.useState<MemberView[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = React.useState<TaskView | null>(null);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [membersOpen, setMembersOpen] = React.useState(false);

  // SPEC-740 · ADR-0115 · state tampilan layar ini persisten berkunci `team`. Tak ada `page`:
  // papan tidak dipaginasi.
  const [view, setView] = usePersistedState<string>("team", "view", "board",
    oneOf(...TEAM_VIEWS.map((v) => v.value)));
  const [q, setQ] = usePersistedState("team", "q", "", isStr);
  const [colFilter, setColFilter] = usePersistedState("team", "col", "all", isStr);
  const [memberFilter, setMemberFilter] = usePersistedState("team", "member", "all", isStr);

  const columns = React.useMemo(
    () => (colFilter === "all" ? TEAM_COLUMNS : TEAM_COLUMNS.filter((c) => c.key === colFilter)),
    [colFilter],
  );
  const columnsKey = columns.map((c) => c.key).join(",");
  const activeFilters = [projectFilter !== "all", colFilter !== "all", memberFilter !== "all", q.trim() !== ""]
    .filter(Boolean).length;

  const filters = React.useMemo(() => ({
    projectId: projectFilter === "all" ? undefined : projectFilter,
    memberId: memberFilter === "all" ? undefined : memberFilter,
    q: q.trim() || undefined,
  }), [projectFilter, memberFilter, q]);

  const load = React.useCallback((silent = false) => {
    if (!silent) setState("loading");
    const keys = columnsKey.split(",") as TaskStatus[];
    Promise.all(keys.map((status) =>
      api.listTasks({ ...filters, status, page: 1, limit: COLUMN_LIMIT })))
      .then((pages) => {
        setBoard((prev) => {
          const next: Board = { ...prev };
          keys.forEach((k, i) => { next[k] = pages[i]!.items; });
          return next;
        });
        setTotals((prev) => {
          const next: Totals = { ...prev };
          keys.forEach((k, i) => { next[k] = pages[i]!.total; });
          return next;
        });
        setState("ready");
      })
      .catch(() => { if (!silent) setState("error"); });
  }, [filters, columnsKey]);

  React.useEffect(() => { load(); }, [load]);

  const loadMembers = React.useCallback(() => {
    api.listMembers().then((r) => setMembers(r.items)).catch(() => { /* papan tetap jalan tanpa nama */ });
  }, []);
  React.useEffect(() => { loadMembers(); }, [loadMembers]);

  // `q` yang menyuapi LANGGANAN ditahan; muat HTTP di atas tetap per-ketikan.
  const [liveQ, setLiveQ] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setLiveQ(q.trim()), Q_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const applyFeed = React.useCallback((status: TaskStatus, items: TaskView[], total: number) => {
    setBoard((prev) => ({ ...prev, [status]: items }));
    setTotals((prev) => ({ ...prev, [status]: total }));
    setState("ready");
  }, []);

  const subParams = React.useMemo(() => ({
    projectId: filters.projectId, memberId: filters.memberId,
    q: liveQ || undefined, page: 1, limit: COLUMN_LIMIT,
  }), [filters.projectId, filters.memberId, liveQ]);

  async function move(task: TaskView, to: TaskStatus) {
    const moved = moveCard(board, task.id, task.status, to);
    if (!moved) return;
    const before = board;
    setBoard(moved.board);
    try { await api.patchTask(task.id, moved.patch); }
    catch {
      setBoard(before);
      onToast("Gagal memindahkan tugas", "err", "x-circle");
    }
  }

  async function assign(task: TaskView, memberId: string | null) {
    const before = board;
    setBoard(replaceCard(board, { ...task, memberId }));
    try { await api.patchTask(task.id, { memberId }); }
    catch {
      setBoard(before);
      onToast("Gagal menugaskan", "err", "x-circle");
    }
  }

  const empty = columns.every((c) => board[c.key].length === 0);

  return (
    <div style={LIST_SCREEN_STYLE}>
      <div className="hn-team-controls" role="region" aria-label="Kontrol papan tim"
        style={{ ...FIXED_ROW_STYLE, marginBottom: 18 }}>
        <div className="hn-team-topline" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap", marginBottom: 12,
        }}>
          <Tabs variant="pill" value={view} onChange={setView} tabs={TEAM_VIEWS} aria-label="Mode tampilan" />
          <div className="hn-team-view-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button size="sm" leftIcon="plus" onClick={() => { setEditing(null); setTaskOpen(true); }}>Tugas baru</Button>
            <Button size="sm" variant="secondary" leftIcon="users" onClick={() => setMembersOpen(true)}>Anggota</Button>
            <SyncButton onDone={() => load(true)} onToast={onToast} />
            <ResetViewButton screen="team" active={activeFilters} onReset={() => onProjectFilter("all")} />
            <span className="hn-eyebrow" role="status">
              {columns.reduce((n, c) => n + (totals[c.key] ?? 0), 0)} tugas
            </span>
            <LiveConnectionBadge />
          </div>
        </div>
        <div className="hn-team-filters" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Input size="sm" leftIcon="search" aria-label="Cari tugas" value={q}
            placeholder="mis. halaman harga atau deploy"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            style={{ flex: "1 1 220px" }} />
          {/* SPEC-146 · App pemilik tunggal "daftar disaring ke project mana", jadi berpindah dari
              Backlog ke Tim tak mengganti project yang sedang dilihat. */}
          <Select size="sm" aria-label="Filter project" value={projectFilter}
            onChange={(e) => onProjectFilter(e.target.value)}
            options={[{ value: "all", label: "Semua project" },
              ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          {/* Menyaring kolom di sebuah PAPAN = mempersempit kolom yang tampil. Hanya kolom yang
              tampil yang dimuat & dilanggan, jadi biaya servernya ikut mengecil. */}
          <Select size="sm" aria-label="Filter kolom" value={colFilter}
            onChange={(e) => setColFilter(e.target.value)}
            options={[{ value: "all", label: "Semua kolom" },
              ...TEAM_COLUMNS.map((c) => ({ value: c.key, label: c.label }))]} />
          <Select size="sm" aria-label="Filter anggota" value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            options={[{ value: "all", label: "Semua anggota" },
              ...members.map((m) => ({ value: m.id, label: m.name }))]} />
        </div>
      </div>

      {columns.map((c) => (
        <ColumnFeed key={c.key} status={c.key} params={subParams} onData={applyFeed} refetch={() => load(true)} />
      ))}

      {state === "loading" ? <StateBlock kind="loading" />
        : state === "error" ? <StateBlock kind="error" hint="Gagal memuat papan tim."
            action={() => load()} actionLabel="Coba lagi" />
        : empty && activeFilters === 0 ? <StateBlock kind="empty" icon="users" title="Papan tim masih kosong"
            hint="Catat pekerjaan manusia di sekitar sesi agen — desain, meeting klien, deploy, nego."
            action={() => { setEditing(null); setTaskOpen(true); }} actionLabel="Tugas baru" actionIcon="plus" />
        : empty ? <StateBlock kind="empty" icon="filter" title="Tak ada tugas untuk penyaring ini"
            hint="Longgarkan penyaring di atas untuk melihat kartu yang lain." />
        : <TeamBoard board={board} totals={totals} columns={columns} members={members}
            onMove={move} onAssign={assign}
            onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />}

      <TaskModal open={taskOpen} task={editing} projects={projects} members={members}
        defaultProjectId={projectFilter === "all" ? null : projectFilter}
        onClose={() => { setTaskOpen(false); setEditing(null); }}
        onSaved={() => load(true)} onToast={onToast} />
      <MembersPanel open={membersOpen} onClose={() => setMembersOpen(false)}
        onChanged={setMembers} onToast={onToast} />
    </div>
  );
}
```

- [x] **Step 4: Daftarkan kelas toolbar ke aturan responsif**

`.hn-backlog-controls` **tak punya aturan CSS sama sekali** — ia cuma penanda yang dipegang test responsif. Yang benar-benar punya aturan adalah tiga selector di `src/src/app.css:220-227`, di dalam media query mobile. Tambahkan padanan Tim ke ketiganya supaya toolbar layar ini menumpuk sama rapinya di 390 px, tanpa meminjam nama layar lain:

```css
  .hn-backlog-topline,
  .hn-team-topline,
  .hn-backlog-view-actions,
  .hn-team-view-actions,
  .hn-backlog-filters,
  .hn-team-filters { align-items: stretch !important; }
  .hn-backlog-topline > *,
  .hn-team-topline > *,
  .hn-backlog-view-actions > *,
  .hn-team-view-actions > *,
  .hn-backlog-filters > *,
  .hn-team-filters > * { max-width: 100%; }
  .hn-backlog-view-actions,
  .hn-team-view-actions { flex-wrap: wrap; }
  .hn-backlog-filters .hn-touch-target,
  .hn-team-filters .hn-touch-target { flex: 1 1 145px !important; width: auto !important; }
```

Catatan: `useResetOnChange` **tidak** dipakai di layar ini — papan tak dipaginasi, jadi tak ada nomor halaman yang harus di-reset saat penyaring berganti. Jangan mengimpornya.

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/team-screen.test.tsx src/test/team-board.test.tsx src/test/team-rules.test.ts src/test/members-panel.test.tsx
```

Diharapkan: seluruhnya PASS.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/TeamScreen.tsx src/src/app.css src/test/team-screen.test.tsx
git commit -m "feat(946): layar Tim — toolbar, fetch & langganan per kolom"
```

---

### Task 8: Nav `team` + cabang `App.tsx`

**Files:**
- Modify: `src/src/ds/shell.tsx:26` (sisipkan entri sesudah `backlog`)
- Modify: `src/src/App.tsx` (impor `TeamScreen` + cabang `section === "team"` sesudah cabang `backlog`, `:1372`)
- Test: `src/test/changelog-nav.test.tsx` (sudah ada — tak diubah), `src/test/team-nav.test.tsx`

**Interfaces:**
- Consumes: `TeamScreen` (Task 7); `projectFilter`/`setProjectFilter`/`showToast`/`projectsView` yang sudah ada di `App`.
- Produces: entri `HN_NAV` `{ key: "team", label: "Tim", icon: "users" }`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/team-nav.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { HN_NAV } from "../src/ds/shell";

describe("SPEC-946 · entri nav Tim", () => {
  // Ikon yang salah nama jatuh ke `Circle` tanpa satu pun error (SPEC-906) — `users` sudah
  // diverifikasi ada di lucide yang terpasang.
  it("terdaftar sebagai 'Tim' ber-ikon users (cabang App dijaga changelog-nav.test)", () => {
    const item = HN_NAV.find((n) => n.key === "team");
    expect(item).toEqual({ key: "team", label: "Tim", icon: "users" });
  });

  it("duduk TEPAT sesudah backlog", () => {
    const keys = HN_NAV.map((n) => n.key);
    expect(keys[keys.indexOf("backlog") + 1]).toBe("team");
  });

  // Papan tim tak digerbangi: ia berguna di instalasi satu mesin maupun banyak.
  it("tak digerbangi", () => {
    expect(HN_NAV.find((n) => n.key === "team")?.gate).toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/team-nav.test.tsx
```

Diharapkan: GAGAL — `expected undefined to equal { key: 'team', … }`.

- [x] **Step 3: Implementasi**

Di `src/src/ds/shell.tsx`, sisipkan tepat sesudah baris `backlog`:

```ts
  // SPEC-946 · ADR-0150 · papan kerja MANUSIA. Kolomnya `Task.status`, bukan `Spec.stage` —
  // papan LAIN, bukan mode kedua board Backlog.
  { key: "team", label: "Tim", icon: "users" },
```

Di `src/src/App.tsx`, tambahkan impor `TeamScreen` bersama impor screen lainnya, lalu sisipkan cabang tepat sesudah cabang `backlog`:

```tsx
  } else if (section === "team") {
    // SPEC-946 · papan kerja manusia. Screen mandiri (pola TriageScreen): memuat datanya sendiri
    // lewat langganan per kolom, jadi ia TIDAK lewat `gate` — `gate` menahan render sampai muatan
    // backlog/sessions App selesai, dan layar ini tak memakai satu pun dari keduanya.
    screen = (
      <Shell active="team" title="Tim" breadcrumb="tugas manusia · backlog → selesai" onNavigate={setSection}>
        <TeamScreen projects={projectsView} projectFilter={projectFilter}
          onProjectFilter={setProjectFilter} onToast={showToast} />
      </Shell>
    );
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/team-nav.test.tsx src/test/changelog-nav.test.tsx src/test/responsive-shell-modal.test.tsx src/test/app-state-persist.test.tsx
```

Diharapkan: seluruhnya PASS. `changelog-nav.test.tsx` adalah gerbangnya — ia membaca `App.tsx` sebagai teks dan menuntut literal `section === "team"` ada di sana.

- [x] **Step 5: Typecheck frontend**

```bash
pnpm --filter ./src typecheck
```

Diharapkan: nol galat.

- [x] **Step 6: Commit**

```bash
git add src/src/ds/shell.tsx src/src/App.tsx src/test/team-nav.test.tsx
git commit -m "feat(946): entri nav Tim + cabang section di App"
```

---

### Task 9: Docs — ADR-0151, frontend, kontrak API, index

**Files:**
- Create: `internal/docs/adr/0151-papan-tim-langganan-per-kolom.md`
- Modify: `internal/docs/frontend/frontend-implementation.md` (seksi baru sesudah "Backlog: tiga mode tampilan…", `:944`)
- Modify: `internal/docs/architecture/api-contract.md:1539` (`q` pada `GET /api/tasks`)
- Modify: `internal/docs/README.md` (tautan ADR-0151)
- Modify: `internal/skills/hanoman/SKILL.md` (satu alinea papan tim di bagian Aturan Arsitektur)

- [x] **Step 1: Konfirmasi nomor ADR belum dipakai**

```bash
ls internal/docs/adr/ | grep -c '^0151' || true
```

Diharapkan: `0`. Bila bukan nol, pakai nomor bebas berikutnya dan ganti seluruh rujukan `ADR-0151` di kode, spec, dan plan ini.

- [x] **Step 2: Tulis ADR-0151**

Buat `internal/docs/adr/0151-papan-tim-langganan-per-kolom.md` dengan kerangka ADR repo ini (Status / Tanggal / SPEC / Memperluas / Menegakkan / Konteks / Keputusan / Konsekuensi / Alternatif yang ditolak). Isinya **empat** keputusan:

1. **Papan berlangganan per KOLOM, bukan per papan.** `zSubLimit` menjepit `limit` ke 200 dan `order` bermakna di dalam kolom; satu langganan memotong himpunan gabungan di titik sewenang-wenang. Empat langganan memberi tiap kolom `total`-nya sendiri; biayanya 4 dari `MAX_SUBS = 16`.
2. **Plafon kolom TERLIHAT.** `total > items.length` merender "menampilkan N dari M — persempit penyaring". Memperluas prinsip "tak ada plafon senyap".
3. **Muat awal HTTP memakai parameter yang IDENTIK dengan langganannya.** Muat awal tak-berbatas lalu langganan berplafon membuat kartu lenyap tanpa tindakan operator.
4. **`q` disaring di server SEBELUM paginasi** (amandemen kecil ADR-0150), cermin `buildTicketsPage`: di memori, bukan `contains` Prisma, karena SQLite peka huruf besar-kecil untuk non-ASCII dan `mode: "insensitive"` tak didukung.

Sebutkan juga **konsekuensi bagi item D & E**: linimasa butuh SELURUH task bertanggal, bukan 200 per kolom — jadi ia tak bisa menumpang topik `tasks` apa adanya dan harus memutuskan bentuknya sendiri.

- [x] **Step 3: Tulis seksi frontend**

Di `internal/docs/frontend/frontend-implementation.md`, tambahkan seksi `## Tim — papan kerja manusia (SPEC-946 · ADR-0150/0151)` tepat sesudah seksi Backlog. Isinya: empat kolom dari `TASK_STATUSES`, semua kolom menerima drop (kebalikan board Backlog dan alasannya), rantai flex kolom/baris yang sama, aksi eksplisit kartu karena drag mati di keyboard & sentuh, langganan per kolom + plafon terlihat, toolbar dua baris, penyaring kolom = mempersempit kolom yang tampil, `email` anggota immutable, dan pemecahan berkas berikut tanggung jawab tiap berkas.

- [x] **Step 4: Perbarui kontrak API**

Di `internal/docs/architecture/api-contract.md:1539`, ubah baris `GET /api/tasks` menjadi:

```
GET    /api/tasks?projectId&status&memberId&q&page&limit  -> Paginated<TaskView>
```

dan tambahkan satu baris penjelas di bawah blok itu: `q` = substring case-insensitive pada `title + detail`, disaring **sebelum** paginasi (SPEC-946); parameter yang sama tersedia di topik siar `tasks`.

- [x] **Step 5: Perbarui skill project**

Di `internal/skills/hanoman/SKILL.md`, bagian "Aturan Arsitektur", tambahkan satu alinea papan tim sesudah alinea state tampilan persisten: layar `Tim` sebagai papan kerja manusia di atas `Task`/`Member` (ADR-0150), berlangganan **per kolom** dengan plafon 200 yang **terlihat** (ADR-0151), `Task.status` milik manusia sehingga keempat kolom menerima drop — kebalikan board Backlog — dan `Member.email` immutable karena id diturunkan darinya.

- [x] **Step 6: Tautkan di index**

```bash
pnpm --silent hanoman docs index --check || true
```

Tambahkan baris ADR-0151 di `internal/docs/README.md` mengikuti bentuk baris ADR-0150 tepat di atasnya, lalu jalankan lagi perintah di atas dan pastikan tak ada keluhan tentang berkas yang tak ter-link.

- [x] **Step 7: Commit**

```bash
git add internal/docs/adr/0151-papan-tim-langganan-per-kolom.md internal/docs/frontend/frontend-implementation.md internal/docs/architecture/api-contract.md internal/docs/README.md internal/skills/hanoman/SKILL.md
git commit -m "docs(946): ADR-0151 + frontend, kontrak API, index"
```

---

### Task 10: Verifikasi akhir

**Files:** tak ada perubahan kode; hanya menjalankan bukti.

- [x] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u DATABASE_URL -u NODE_ENV \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

**Jebakan:** `--changed` menyalakan `passWithNoTests`, jadi nol test **terlihat hijau**. Baca jumlah berkas & test yang berjalan; bila nol, sebut path test-nya langsung.

- [x] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

JANGAN `pnpm -r typecheck` — mesin ini menjalankan beberapa sesi sekaligus.

- [x] **Step 3: Uji endpoint nyata di local**

> **Hasil (2026-08-25).** Smoke ini **menangkap satu bug nyata yang lolos seluruh test tingkat
> service**: `GET /api/tasks` tak pernah mendestruktur `q` dari query, jadi `?q=desain` menjawab
> `200` berisi SELURUH tabel — nol error. `tasks-list.test.ts` tak bisa melihatnya karena ia
> memanggil `buildTasksPage` langsung, melewati lapisan yang justru menjatuhkan parameternya.
> Diperbaiki, dan test barunya lewat `app.inject` (HTTP), bukan lewat service.
>
> Terbukti hidup di server nyata: `?q=DESAIN` (tak peka huruf besar-kecil) → 1 dari 4;
> `?q=anggaran` (hanya ada di `detail`) → 1; `?q=de&limit=1` → `total: 2` dengan 1 item, yakni
> penyaring berjalan **sebelum** paginasi; empat muat per-kolom `?status=…&limit=200` menjawab
> `3/1/0/0`; `PATCH {status, order}` (drop kanban) mendarat; `PATCH {status}` **tidak** menghapus
> `dueDate`/`memberId` yang sudah diisi; `DELETE /members/:id` → task jatuh ke `memberId: null`
> tanpa ikut terhapus; `/tasks` tanpa cookie → `401`; `PATCH /members/:id` ber-`email` → `400`;
> dan `Member.id` mendarat sebagai `dena@nafanesia.id` sementara kolom `email` menyimpan
> `Dena@Nafanesia.ID` seperti yang diketik — kontrak ADR-0094 apa adanya.
>
> **Dua jebakan harness yang perlu dicatat:** (1) `HANOMAN_HOME` saja **tidak cukup** untuk
> mengarahkan server ke DB smoke — `DATABASE_URL` absolut harus diberikan eksplisit, kalau tidak
> server membuka berkas lain dan menjawab `P2021 main.User does not exist` padahal tabelnya ada
> di berkas yang baru dimigrasi; (2) `curl -c <jar>` **menulis ulang jar tiap request**, jadi satu
> request yang tak menerima cookie (mis. `400` dari gerbang Origin) **mengosongkan sesi** dan
> semua request berikutnya jadi `unauthorized` — kirim cookie lewat header, jangan pakai `-c`
> pada request mutasi.

Task ini menyentuh satu endpoint (`GET /api/tasks?q=`), jadi sekali di akhir:

```bash
pnpm --filter ./server build >/dev/null 2>&1 || true
HANOMAN_HOME="$(mktemp -d)" node server/dist/server.js &
# tunggu port siap, lalu:
curl -s 'http://127.0.0.1:5174/api/tasks?q=desain' | head -c 400
```

Diharapkan: respons `Paginated<TaskView>` (atau `401` bila auth cookie diminta — dalam hal itu buktikan lewat test route saja dan catat alasannya). Bunuh server **per-PID** (`lsof -ti:5174` → `kill <pid>`), JANGAN `pkill -f node`.

- [ ] **Step 4: Centang seluruh kotak plan ini**

Pastikan tak ada `- [ ]` tersisa di berkas ini sebelum menyatakan Execute selesai.

- [ ] **Step 5: Commit & push**

```bash
git add -A && git commit -m "docs(946): centang plan tuntas + bukti verifikasi"
git push origin HEAD:refs/heads/hanoman/spec-946
```
