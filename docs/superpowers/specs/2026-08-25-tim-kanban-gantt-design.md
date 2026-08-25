# Tim — papan kanban manusia, linimasa, dan overview lintas project

Tanggal: 2026-08-25
Status: disetujui (brainstorming)
ADR yang lahir dari spec ini: **ADR-0150**

## Masalah

hanoman mengelola pekerjaan **agen** dengan sangat rapi: satu backlog item = satu sesi `claude` di
worktree terisolasi, stage diturunkan dari phase-file sesi, tak ada estimasi dan tak ada progress %.

Yang tidak dikelola sama sekali adalah pekerjaan **manusia** di sekitar itu: desain, meeting klien,
deploy, nego, tulis konten, urusan internal tim. Pekerjaan itu hari ini hidup di kepala orang atau
di alat lain, dan akibatnya tak ada satu tempat pun yang bisa menjawab "siapa mengerjakan apa" dan
"project mana yang jadwalnya bertabrakan".

Spec ini menambahkan lapisan manajemen kerja manusia — papan kanban, linimasa, dan overview lintas
project — dengan satu jembatan ke dunia agen: kartu manusia bisa **dieskalasi** menjadi backlog item
hanoman.

## Yang bukan masalah ini

- **Bukan** mengganti board Backlog yang sudah ada. `BacklogScreen` punya view `board` dengan kolom
  `Backlog · Brainstorm · Objective · Spec · Plan · Execute · Success`; kolom itu adalah `Spec.stage`,
  diturunkan dari fase sesi (ADR-0008/0024), dan drag ke sana hampir seluruhnya dilarang karena UI
  yang menulis stage akan membuat `executing`/`done` tercapai tanpa sesi yang benar-benar berjalan.
  Papan tim adalah papan **lain**, dengan kolom milik manusia.
- **Bukan** membatalkan larangan estimasi. Larangan "tak ada progress %, tak ada estimasi biaya"
  (SPEC-162, tertulis di `OverviewScreen.tsx:1`) berlaku untuk *sesi AI* — pekerjaan yang durasinya
  tak bisa dijanjikan siapa pun. Tenggat atas *pekerjaan manusia* adalah hal berbeda jenis. Yang
  tetap terlarang: menaruh tenggat atau estimasi di `Spec`.
- **Bukan** RBAC. Model "cookie sesi = akses penuh" (`app.ts`) tidak disentuh; tidak ada role baru.

## Keputusan yang mengunci bentuk

| Pertanyaan | Keputusan |
|---|---|
| Untuk siapa | Tim manusia yang berkolaborasi — membagi tugas dan tenggat |
| Unit kerja | Entity `Task` **baru**, bukan `Spec`. Kanban bukan bagian dari backlog |
| Assignee | Tabel `Member` **baru** — bukan `User` (LOCAL-only, tak ikut sync) |
| Topologi | Satu instance hanoman bersama, disync ke tiap device |
| Lingkup papan | Per project, dan `projectId` boleh **null** (tugas internal tim) |
| Kolom | **Tetap empat**: `backlog · doing · review · done` |
| Eskalasi | Kartu **tetap di papan**, menampilkan cermin stage backlog baca-saja |
| Gantt | Rencana saja: `startDate → dueDate` yang diisi manusia |
| Overview | Linimasa **lintas project** — mencari tabrakan jadwal |
| Rumah | Layar baru `Tim` dengan tiga mode tampilan |

## Arsitektur

### Bentuk data

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

**`Member.id` deterministik dari email.** Pola `CustomAgent` (ADR-0094): dengan id acak, dua mesin
yang sama-sama membuat "Dena" melahirkan dua baris yang keduanya menyeberang changefeed, dan salah
satunya lenyap tanpa jejak begitu papan menyaring per-assignee. Konsekuensi yang harus ditegakkan
di boundary route: **`email` immutable** — ganti email berarti hapus + buat baru. `name` bebas diedit.

**`Member` global, bukan per project.** Task boleh tanpa project, jadi direktori orang tak bisa
digantung pada project. Orang yang sama juga lazim melintasi beberapa project.

**`Task.specId` tanpa FK.** Cermin `Ticket.specId` (ADR-0062): changefeed bisa memancarkan `Task`
sebelum `Spec`-nya mendarat (kelas bug SPEC-382) dan FK akan menolaknya.

**Stage backlog TIDAK disimpan di `Task`.** Pencerminan dihitung saat baca lewat join
`specId → Spec.stage`. Aturan ADR-0090 bukan "selalu simpan" melainkan *bisakah dihitung ulang dari
sumber lain*; di sini bisa, jadi kolom kedua hanya menciptakan dua kebenaran yang bisa drift.

**Tak ada `doneAt` dan tak ada stempel transisi kolom.** Gantt yang dipilih adalah rencana-saja,
jadi tanggal aktual belum punya pembaca. Dihilangkan dengan sengaja, bukan terlupa. Menambahkannya
nanti adalah migration additif biasa.

**`order Float`.** Drop di antara dua kartu menulis titik tengah tetangganya — tak ada reindex
seluruh kolom, dan dua mesin yang menulis bersamaan menghasilkan nilai yang tetap terurut. Seri
dipecah oleh `id`.

### "Tugas saya" tanpa menautkan tabel

`Member.email` dicocokkan dengan `User.email` akun yang sedang login. String, bukan FK — jadi tak
ada masalah `User` yang LOCAL-only, tak perlu role baru, dan model akses tetap utuh.

### Pendaftaran sync

`User`, `Session`, dan `AgentToken` LOCAL-only; `Member` dan `Task` **ikut menyeberang**. Setiap
baris di tabel ini punya kelas gagal-senyap sendiri yang sudah pernah terjadi di repo ini:

| Tempat | Isi | Kalau terlewat |
|---|---|---|
| `SYNCED` | `+ "member", "task"` | tak pernah menyeberang sama sekali |
| `FIELDS` | seluruh kolom bermakna + `updatedAt` | kolom terlewat mendarat **null palsu tanpa satu pun error** (ADR-0090/0093/0105) |
| `DATE_FIELDS` | `task:startDate`, `task:dueDate`, `task:createdAt`, `member:createdAt` | tanggal mendarat sebagai string |
| `NUMBER_FIELDS` | `task:order` | urutan kolom acak di mesin lain |
| `BOOLEAN_FIELDS` | `member:active` | anggota nonaktif hidup lagi di mesin lain |
| `PARENTS` | `task → project` (nullable-safe, cermin `customAgent`), `task → member` | anak yatim saat induk bertombstone (ADR-0119) |
| `BOOTSTRAP_ORDER` | `member` **sebelum** `task` | bootstrap sukses tanpa error tapi assignee kosong (kelas SPEC-885 "lupa `vps`") |

### API

Semua route baru otomatis tertutup bagi `User.role === "client"`: `clientRouteAllowed` adalah
allowlist deny-by-default (ADR-0110), dan tak ada entri baru yang ditambahkan.

```
GET    /api/members                  daftar (aktif dulu, nama asc)
POST   /api/members                  { name, email, role? }   → id diturunkan dari email
PATCH  /api/members/:id              { name?, role?, active? }  — email DITOLAK
DELETE /api/members/:id              task-nya jatuh ke memberId: null (SetNull)

GET    /api/tasks?projectId&status&memberId&page&limit   berhalaman (ADR-0107)
POST   /api/tasks                    { title, projectId?, status?, memberId?, startDate?, dueDate?, priority? }
PATCH  /api/tasks/:id                termasuk { status, order } untuk drop kanban
DELETE /api/tasks/:id
POST   /api/tasks/:id/escalate       { source, priority, projectId? } → membuat Spec, mengisi specId
DELETE /api/tasks/:id/escalate       lepas tautan (specId → null)
```

`GET /api/tasks` menyertakan `spec: { id, stage, priority } | null` hasil join `specId` — **baca-saja**,
tak pernah ditulis balik ke `Task`. `specId` yang menunjuk `Spec` terhapus dirender sebagai
"tautan putus", bukan diam-diam kosong.

### Realtime

Papan masuk registry `TOPICS` (`services/events-topics.ts`, SPEC-908/ADR-0145) sebagai **topik
berparameter**, bukan grup global ke-11 di `GROUPS`.

Alasannya biaya: `GROUPS` di-recompute untuk **setiap klien yang terhubung** tiap N detik — grup
`specs` saja 1 detik sekali. Papan tim punya sedikit penonton dan banyak parameter (project, member,
status), jadi ia harus mengikuti pola `tickets`: biaya hanya lahir untuk parameter yang benar-benar
ada yang menonton. `everyTicks: 3`.

### Eskalasi

Empat aturan:

1. **Task tanpa project tak bisa dieskalasi.** `nextSpecId(repoDir)` butuh repo, dan `repoDir` milik
   project. Dialog memaksa memilih project lebih dulu bila `projectId` null — bukan menolak dengan
   diam (kelas bug SPEC-546).
2. **Idempoten lewat `task.specId`**, persis `acceptTicket()`: sudah tertaut → kembalikan `Spec`
   yang sama, jangan buat kedua. Retry `P2002` ≤3× untuk TOCTOU `nextSpecId` (SPEC-197).
3. **Operator memilih `source`** (`brief` default · `qa` · `audit`); tak ada pemetaan alami dari
   tugas manusia ke alur, beda dengan tiket yang punya kategori (SPEC-291). `payload` dibentuk
   sesuai source agar lolos `superRefine` dto. `launchApprovedBy` diisi operator (SPEC-761).
4. **Teks task TIDAK dibungkus penanda untrusted.** Pembungkus `UNTRUSTED_TICKET_DATA_*` ada karena
   tiket datang dari publik; task ditulis anggota tim di dalam dashboard ber-auth. Memperlakukannya
   sebagai racun melatih agen mengabaikan konteks yang justru sengaja diberikan.

**Webhook keluar sengaja tidak disentuh.** `webhooks/tap.ts` memakai registry eksplisit
(`entityDefForModel`), jadi model baru tidak memancarkan apa pun sampai seseorang mendaftarkannya.
Tak ada yang rusak, dan belum ada yang meminta.

### UI

Satu entri nav baru `{ key: "team", label: "Tim", icon: "users" }` setelah `backlog`. Nama ikon
`users` sudah diverifikasi ada di lucide yang terpasang — SPEC-906 menunjukkan nama yang salah jatuh
ke `Circle` tanpa satu pun error. Setiap key nav **wajib** punya cabang `section === "team"` di
`App.tsx`; tanpa itu sidebar ikut lenyap dan pengguna terjebak sampai reload (kontrak yang dijaga
`src/test/changelog-nav.test.tsx`).

Tiga mode tampilan, cermin `BacklogScreen`, view tersimpan lewat `uiKey("team","view")` (SPEC-740):

**Papan.** Empat kolom, drag HTML5 native tanpa dependency. **Tidak dipaginasi** — kolom yang
terpotong halaman bukan board. Kolom menggulir tegak sendiri; barisnya menggulir mendatar. Berbeda
dari board Backlog, **semua kolom di sini bisa menerima drop**: `Task.status` memang milik manusia,
tak diturunkan dari fase sesi. Karena drag mati di keyboard dan layar sentuh, tiap kartu tetap
membawa aksi eksplisit (pindah kolom, tugaskan, eskalasi).

**Linimasa.** Gantt satu papan. Baris = task, batang = `startDate → dueDate`, zoom hari/minggu/bulan.
Task tanpa tanggal masuk daftar "belum dijadwalkan" di bawah kanvas, bukan disembunyikan. Digambar
dengan CSS grid + token DS, tanpa library chart. Menggulir mendatar di dalam containernya sendiri
sehingga badan halaman tak pernah ikut menggulir samping (SPEC-879).

**Lintas project.** Satu baris ringkas per project (`min(startDate)` → `max(dueDate)` dari task-nya),
bisa dibuka jadi task-nya. Inilah yang menjawab "tabrakan jadwal antar-project". Task tanpa project
muncul sebagai baris "Tanpa project".

**Anggota dikelola di modal dalam layar Tim, bukan di Settings.** `SettingsScreen.tsx` sudah 93 KB;
menambah panel ke sana memperburuk berkas yang memang sudah terlalu besar.

### Pemecahan berkas

`BacklogScreen` 63 KB dan `TerminalScreen` 57 KB adalah pelajaran yang tak perlu diulang:

```
TeamScreen.tsx      toolbar, fetch, state, toggle view
team-board.tsx      papan + kartu
team-timeline.tsx   kanvas Gantt — dipakai mode Linimasa DAN Lintas project
team-rules.ts       fungsi MURNI: canDropTask, barGeometry, projectSpan
MembersPanel.tsx    kelola anggota
EscalateDialog.tsx  dialog eskalasi
```

## Penanganan galat

- **Eskalasi ganda** — idempoten via `specId`; respons kedua mengembalikan `Spec` yang sama dengan
  `created: false`.
- **Eskalasi task tanpa project** — `400` dengan pesan yang menyebut sebabnya; UI mendahuluinya
  dengan memaksa pilih project di dialog.
- **`specId` menunjuk `Spec` terhapus** — kartu merender "tautan putus" plus aksi lepas tautan.
  Tak ada sweep pembersih: keadaan itu jujur dan murah untuk ditampilkan.
- **`nextSpecId` TOCTOU** — retry `P2002` ≤3×, bukan `500` (SPEC-197).
- **Anggota dihapus saat punya task** — `onDelete: SetNull`; task jadi "belum ditugaskan", tidak
  ikut terhapus.
- **Konflik sync** — `Task` dan `Member` mengikuti LWW + antrean rekonsil yang sudah ada (ADR-0067).
  Tak ada aturan konflik khusus.

## Test

- `team-rules.ts` diuji sebagai fungsi murni: `canDropTask`, `barGeometry` (tanggal → `{left%,width%}`
  dengan clamping di tepi jendela), `projectSpan`.
- **Unit test aturan tidak cukup.** `from`/`to` yang tertukar lolos dari unit test aturannya sendiri
  — itu sebabnya `src/test/backlog-board.test.tsx` men-drag kartu sungguhan di jsdom. Pola itu
  diikuti untuk papan tim.
- Server: route tasks & members, eskalasi (idempotensi + penolakan task tanpa project + bentuk
  payload per source), dan lepas tautan.
- Kontrak sync sudah ditegakkan `sync-parents-dmmf.test.ts` dan `__FIELDS`; entity baru wajib lulus
  keduanya tanpa pengecualian.

## Pemecahan menjadi backlog

Lima item berantai lewat `dependsOn` (ADR-0093). Urutan **A → B → {C, D} → E**; C dan D independen
satu sama lain.

| # | Item | Isi |
|---|---|---|
| **A** | Fondasi Tim | schema `Member`+`Task`, migration, ADR-0150, pendaftaran sync lengkap, route CRUD + zod, topik realtime. Tanpa UI |
| **B** | Papan tim | layar `Tim` + nav + mode Papan + kartu + filter + modal Anggota |
| **C** | Eskalasi ke backlog | dialog + `POST/DELETE /tasks/:id/escalate` + cermin stage + lepas tautan |
| **D** | Linimasa papan | mode Gantt per papan, zoom, daftar "belum dijadwalkan" |
| **E** | Linimasa lintas project | mode ketiga, baris ringkas per project yang bisa dibuka |
