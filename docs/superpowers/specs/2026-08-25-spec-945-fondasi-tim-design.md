# SPEC-945 — Fondasi Tim: entity `Task` & `Member`, sync, API

Tanggal: 2026-08-25
Status: disetujui
Induk: [Tim — papan kanban manusia, linimasa, dan overview lintas project](2026-08-25-tim-kanban-gantt-design.md) (item **A** dari lima)
ADR yang lahir dari spec ini: **ADR-0150**

## Ruang lingkup

Item **A**: bentuk data, migration, pendaftaran sync, route CRUD, dan topik realtime. **Tanpa UI.**
Layar `Tim`, papan, Gantt, dan eskalasi adalah item B–E dan **tidak** disentuh di sini — termasuk
`POST/DELETE /api/tasks/:id/escalate`, yang milik item C.

Keputusan bentuk sudah dikunci di dokumen induk. Spec ini menambahkan yang tak ada di sana: **peta
cermin yang harus ikut berubah**, dan pembenaran atas tiga hal yang sengaja **tidak** diubah.

## Bentuk data

Persis seperti dokumen induk, tanpa penyimpangan:

```prisma
model Member {
  id        String   @id              // DETERMINISTIK: email ternormalisasi (lowercase + trim)
  name      String
  email     String   @unique
  role      String?                   // label bebas: "desainer", "backend" — BUKAN RBAC
  active    Boolean  @default(true)
  version   Int      @default(0)      // ADR-0045 · version-stamp sync
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tasks     Task[]
}

model Task {
  id        String    @id @default(cuid())
  projectId String?                    // null = tugas internal tim, tanpa project
  title     String
  detail    String?
  status    String                     // "backlog" | "doing" | "review" | "done"
  priority  String    @default("normal")
  memberId  String?                    // null = belum ditugaskan
  startDate DateTime?
  dueDate   DateTime?
  order     Float     @default(0)      // urutan dalam kolom
  specId    String?                    // eskalasi — TANPA FK
  version   Int       @default(0)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  project   Project?  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  member    Member?   @relation(fields: [memberId], references: [id], onDelete: SetNull)

  @@index([projectId, status])
  @@index([memberId])
}
```

`Member.email @unique` **bukan** redundansi terhadap PK: id menyimpan bentuk ternormalisasi,
kolom `email` menyimpan yang diketik operator. Indeks unik itu jaring kedua bila normalisasi
suatu hari berubah.

Migration **ditulis tangan** (`server/prisma/migrations/20260825120000_team_member_task/`), bukan
`prisma migrate dev`: worktree tetangga membuat `migrate dev` me-reset DB saat ada drift. Dua tabel
baru → `CREATE TABLE` polos, tak ada tabel diredefinisi, tanpa backfill.

## Cermin yang ikut berubah

Model Prisma baru menyentuh delapan daftar tulis-tangan. Tiga di antaranya **tidak** ditangkap
TypeScript, dan dua **tidak** disebut dokumen induk sama sekali:

| Tempat | Isi | Ditangkap apa | Kalau terlewat |
|---|---|---|---|
| `sync.ts` `SYNCED` | `+ "member", "task"` | — | tak pernah menyeberang |
| `sync.ts` `DELEGATE` | dua entri `prisma.*` | **tsc** (`Record<Entity,…>`) | — |
| `sync.ts` `FIELDS` | seluruh kolom bermakna + `updatedAt` | **tsc** hanya untuk *kunci*, bukan isinya | kolom terlewat mendarat **null palsu tanpa satu pun error** |
| `sync.ts` `DATE_FIELDS` | idem | **tsc** untuk kunci | tanggal mendarat sebagai string |
| `sync.ts` `NUMBER_FIELDS`/`BOOLEAN_FIELDS` | `task:order` · `member:active` | — | urutan kolom acak; anggota nonaktif hidup lagi |
| `sync.ts` `PARENTS` | `task → project`, `task → member` | `sync-parents-dmmf.test.ts` | anak yatim saat induk bertombstone |
| `sync.ts` `BOOTSTRAP_ORDER` | `member` **sebelum** `task` | `sync-bootstrap.test.ts` | bootstrap sukses tanpa error, assignee kosong |
| **`cli/.../migrate-pg.ts` `PG_ORDER`** | `Member` sebelum `Task`, `Task` sesudah `Project` | `cli/test/migrate-pg.test.ts` | **test merah** — daftar wajib memuat SETIAP model DMMF tepat sekali |
| **`server/test/sync-exclusions.test.ts:20`** | snapshot literal `SYNCED` | dirinya sendiri | **test merah** |

Dua baris tebal itu adalah temuan spec ini. `PG_ORDER` tak pernah disebut dokumen induk; ia daftar
seluruh model untuk migrasi Postgres→SQLite, ditegakkan terhadap DMMF, dan model baru yang lupa di
sana membuat suite CLI merah — bukan gagal senyap, tapi tetap harus dikerjakan.

`FIELDS` adalah satu-satunya yang **tak punya gerbang mekanis sama sekali** (tak ada test DMMF yang
menegakkan kelengkapan kolom di repo ini — sudah dicari). Karena itu spec ini menambahkan
`server/test/team-schema.test.ts` yang membandingkan `__FIELDS.member`/`__FIELDS.task` dengan daftar
kolom DMMF dikurangi `id`/`version`, memakai `toEqual` atas himpunan tersortir — bukan `toContain`
per kolom, yang lolos untuk kolom yang belum pernah terpikirkan.

## Yang sengaja TIDAK diubah

**1. `GROUPS` di `services/events.ts`.** Papan tim masuk registry `TOPICS` sebagai topik
berparameter, `everyTicks: 3`. Alasannya biaya: `GROUPS` di-recompute untuk **setiap klien yang
terhubung** tiap N detik, sementara papan tim punya sedikit penonton dan banyak parameter.

**2. `capabilityForRoute` di `services/agent-capabilities.ts`.** Top-segment yang tak terdaftar
jatuh ke `null`, dan `checkAgentCapability` memperlakukan `null` **sama dengan `COOKIE_ONLY`** —
403 untuk agent token mana pun. `/api/tasks` dan `/api/members` karena itu tertutup bagi agen
**tanpa satu baris pun**, dan itu default yang benar: papan tim adalah permukaan manusia. Demikian
pula `clientRouteAllowed` — allowlist deny-by-default (ADR-0110) sudah menutupnya bagi role
`client`. Keduanya dibuktikan test, bukan diasumsikan.

**3. `WEBHOOK_ENTITIES` di `shared/src/webhook.ts`.** Model baru tak memancarkan apa pun sampai
didaftarkan; belum ada yang meminta. **Konsekuensi yang dinyatakan, bukan terlupa:** entri
`project` punya `cascade: ["spec","ticket","customAgent","githubIssue"]`, dan daftar itu jadi
`data.cascade` pada `project.deleted` — jumlah anak yang ikut lenyap. `Task` adalah anak
`Project` ber-`onDelete: Cascade`, jadi sejak spec ini angka itu **kurang melaporkan** task yang
ikut terhapus. `task` sengaja tidak ditambahkan: kunci di `data.cascade` adalah nama entity
webhook, dan menambahkan kunci untuk entity yang tak pernah memancarkan event sendiri berarti
mengiklankan sesuatu yang tak bisa dilanggan. Saat `task` didaftarkan sebagai entity webhook,
kunci itu masuk bersamanya — satu perubahan, bukan dua.

## API

Semua di belakang gate cookie. Paginasi ADR-0107 lewat `paginate()` yang sudah ada.

```
GET    /api/members?active&page&limit                      → Paginated<MemberView>
POST   /api/members    { name, email, role? }              → 201 MemberView
PATCH  /api/members/:id { name?, role?, active? }          → MemberView
DELETE /api/members/:id                                    → 204

GET    /api/tasks?projectId&status&memberId&page&limit     → Paginated<TaskView>
POST   /api/tasks      { title, projectId?, detail?, status?, priority?, memberId?, startDate?, dueDate?, order? }
PATCH  /api/tasks/:id  { …semua di atas, semuanya opsional }
DELETE /api/tasks/:id                                      → 204
```

**Kedua daftar beramplop `Paginated`, termasuk `/members`.** Aturan ADR-0107 adalah *amplop
tunggal*, bukan kewajiban memenggal: `paginate()` tanpa `limit` mengembalikan seluruh item sebagai
satu halaman (`pageSize = total`). Jadi pemilih assignee yang meminta daftar penuh tetap
mendapatkannya, tanpa membuat `/members` jadi bentuk respons keempat yang harus diingat pemanggil.
Urutan default: aktif dulu, lalu nama asc.

**`email` immutable, ditegakkan dua lapis** — cermin `name`/`projectId` di `zUpdateCustomAgent`:
skema `zPatchMember` tak punya field `email`, **dan** route menolak `"email" in body` dengan `400`
sebelum parse. Lapis kedua wajib: `.omit()` sendirian membuang field itu **senyap**, sehingga
"ganti email diterima lalu tak terjadi apa-apa" — bug yang tak terlihat operator.

**`memberId` divalidasi di boundary.** FK ada, tapi pesan Prisma `P2003` bukan jawaban yang bisa
dibaca UI; route menjawab `400 { error, memberId }`. Sama untuk `projectId`.

**`GET /api/tasks` menyertakan `spec: { id, stage, priority } | null`, baca-saja.** `specId` tanpa
FK, jadi tak ada `include` Prisma: id dikumpulkan dari halaman, di-`findMany({ id: { in } })`
sekali, lalu dipetakan. **Satu query untuk seluruh halaman, bukan N+1** — dan `specId` yang
menunjuk `Spec` terhapus menghasilkan `spec: null` sementara `specId` tetap terisi. Perbedaan
itulah yang membuat UI (item C) bisa merender "tautan putus" alih-alih diam.

Bentuk `TaskView`/`MemberView` dan zod-nya hidup di `shared/src/team.ts` — satu sumber untuk
server, topik WS, dan UI item B.

## Realtime

Topik `tasks` menyentuh **empat** tempat yang harus tetap sinkron manual:

- `EventTopic` union — `shared/src/dto.ts`
- `zTopicParams.tasks` — `{ projectId?, status?, memberId?, page, limit }.strict()`, `page`/`limit`
  memakai `zSubPage`/`zSubLimit` yang sudah ada (plafon ADR-0107)
- varian `EventMsg` — `{ t: "tasks"; key: string; data: Paginated<TaskView> }`
- `TOPICS.tasks` — `{ everyTicks: 3, build: async (p) => ({ data: await buildTasksPage(p) }) }`

`buildTasksPage` hidup di `server/src/services/tasks-list.ts` dan **dipakai bersama** oleh
`GET /api/tasks` dan topik siar — cermin `tickets-list.ts`. Menyalinnya berarti dua serializer
yang bisa berselisih diam-diam.

## Penanganan galat

| Keadaan | Jawaban |
|---|---|
| `POST /members` email sudah ada | `409 { error, id }` — id deterministik, jadi tabrakan terdeteksi sebelum menulis |
| `PATCH /members/:id` membawa `email` | `400` dengan pesan yang menyebut "hapus lalu buat baru" |
| `DELETE /members/:id` yang punya task | `204`; task jatuh ke `memberId: null` (SetNull), tidak ikut terhapus |
| `POST/PATCH /tasks` `memberId`/`projectId` tak ada | `400 { error, memberId }` / `400 { error, projectId }` |
| `status` di luar empat nilai | `400` dari zod |
| `specId` menunjuk `Spec` terhapus | `spec: null` dengan `specId` tetap terisi — bukan keduanya kosong |
| Konflik sync | LWW + antrean rekonsil yang sudah ada (ADR-0067). Tak ada aturan khusus |

## Test

- `server/test/team-schema.test.ts` — kontrak skema & sync: `FIELDS` lengkap terhadap DMMF (kedua
  arah), `DATE/NUMBER/BOOLEAN_FIELDS`, `PARENTS`, `BOOTSTRAP_ORDER` (`member` sebelum `task`),
  `PG_ORDER`, cascade Project→Task nyata di DB, SetNull Member→Task nyata di DB.
- `server/test/members.route.test.ts` — id deterministik dari email ber-kapital & berspasi, 409
  duplikat lintas-kapitalisasi, penolakan `email` di PATCH, urutan aktif-dulu, SetNull saat hapus.
- `server/test/tasks.route.test.ts` — CRUD, filter, paginasi, join `spec` (termasuk tautan putus &
  bukti satu query untuk banyak task), validasi `memberId`/`projectId`/`status`.
- `server/test/sync-exclusions.test.ts` & `sync-parents-dmmf.test.ts` & `sync-bootstrap.test.ts` &
  `cli/test/migrate-pg.test.ts` — sudah ada, wajib tetap hijau.
- `server/test/client-route-allowed.test.ts` — `/api/tasks` & `/api/members` ikut daftar permukaan
  operator yang tertutup bagi role `client`.
- `server/test/agent-capabilities.test.ts` — agent token ditolak `403`
  `reason: "cookie-only"` di kedua route.
