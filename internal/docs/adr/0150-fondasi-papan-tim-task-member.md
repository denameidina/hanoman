# ADR-0150 — Fondasi papan tim: `Task` & `Member` sebagai entity tersync, stage backlog dihitung saat baca

- Status: berlaku
- Tanggal: 2026-08-25
- SPEC: SPEC-945
- Memperluas: ADR-0094 (id deterministik), ADR-0045/ADR-0067/ADR-0119 (record-sync)
- Menegakkan: ADR-0090, ADR-0062, ADR-0145/ADR-0039, ADR-0110, ADR-0065, ADR-0107
- Mengamandemen: dokumen desain induk `docs/superpowers/specs/2026-08-25-tim-kanban-gantt-design.md` pada kosakata `priority`

## Konteks

hanoman mengelola pekerjaan **agen** dengan rapi: satu backlog item = satu sesi `claude` di worktree
terisolasi, `Spec.stage` diturunkan dari phase-file sesi (ADR-0008/0024), tak ada estimasi dan tak
ada progress %.

Yang tak dikelola sama sekali adalah pekerjaan **manusia** di sekitarnya: desain, meeting klien,
deploy, nego, tulis konten, urusan internal tim. Pekerjaan itu hidup di kepala orang atau di alat
lain, jadi tak ada satu tempat pun yang bisa menjawab "siapa mengerjakan apa" dan "project mana
yang jadwalnya bertabrakan".

ADR ini memutuskan **fondasi datanya saja** — bentuk tabel, pendaftaran sync, permukaan API, dan
topik realtime. UI (papan, linimasa, eskalasi) adalah keputusan yang sama dan spec terpisah.

## Keputusan

**1. `Task` adalah entity BARU, bukan kolom di `Spec`.**

Papan tim bukan board Backlog yang sudah ada. Kolom board Backlog adalah `Spec.stage`, diturunkan
dari fase sesi, dan drag ke sana hampir seluruhnya dilarang — UI yang menulis stage akan membuat
`executing`/`done` tercapai tanpa sesi yang benar-benar berjalan. `Task.status` sebaliknya **milik
manusia** dan justru harus bisa di-drag ke kolom mana pun.

Larangan estimasi & tenggat di `Spec` (SPEC-162) **tetap berlaku utuh**. Ia dibuat untuk sesi AI —
pekerjaan yang durasinya tak bisa dijanjikan siapa pun. Tenggat atas pekerjaan manusia adalah hal
berbeda jenis, dan ia hidup di tabel berbeda. Tak satu kolom pun ditambahkan ke `Spec`.

**2. `Member.id` DETERMINISTIK dari email ternormalisasi (`lowercase + trim`).**

Memperluas ADR-0094. Dengan id acak, dua mesin yang sama-sama mencatat "Dena" melahirkan dua baris
yang keduanya menyeberang changefeed, dan salah satunya lenyap tanpa jejak begitu papan menyaring
per-assignee.

Konsekuensi yang **harus ditegakkan di boundary**: `email` immutable — ganti email berarti hapus +
buat baru. Ditegakkan **dua lapis**: `zPatchMember` tak punya field `email`, **dan** route menolak
`"email" in body` dengan `400` sebelum parse. Lapis kedua wajib karena `.omit()` sendirian membuang
field itu **senyap**, sehingga "ganti email diterima lalu tak terjadi apa-apa" — bug yang tak
terlihat operator. `name` bebas diedit.

`Member.email` tetap `@unique` meski id sudah diturunkan darinya: id menyimpan bentuk
ternormalisasi, kolom `email` menyimpan yang diketik operator. Indeks itu jaring kedua bila
normalisasi suatu hari berubah.

**3. `Member` GLOBAL, bukan per project.**

`Task.projectId` nullable (null = tugas internal tim), jadi direktori orang tak bisa digantung pada
project. Orang yang sama juga lazim melintasi beberapa project.

"Tugas saya" dijawab dengan mencocokkan `Member.email` ke `User.email` akun yang login — **string,
bukan FK**. Jadi tak ada masalah `User` yang LOCAL-only, tak perlu role baru, dan model akses
(ADR-0117) tetap utuh.

**4. Stage backlog TIDAK disimpan di `Task`.**

Pencerminan dihitung **saat baca** lewat join `specId → Spec.stage`. Ini menegakkan ADR-0090, yang
aturannya bukan "selalu simpan" melainkan *bisakah dihitung ulang dari sumber lain*; di sini bisa,
jadi kolom kedua hanya menciptakan dua kebenaran yang bisa drift.

`GET /api/tasks` menyertakan `spec: { id, stage, priority } | null` — **baca-saja**, tak pernah
ditulis balik ke `Task`. Join-nya **satu query untuk seluruh halaman** (`findMany({ id: { in } })`),
bukan satu per kartu.

**5. `Task.specId` TANPA foreign key.**

Cermin `Ticket.specId` (ADR-0062): changefeed bisa memancarkan `Task` sebelum `Spec`-nya mendarat
(kelas bug SPEC-382), dan FK akan menolaknya.

Akibat yang dipilih dengan sadar: `specId` yang menunjuk `Spec` terhapus dirender sebagai **tautan
putus** — `specId` tetap terisi sementara `spec` bernilai `null`. Perbedaan antara "tak pernah
dieskalasi" (`specId: null`) dan "tautannya putus" (`specId` terisi, `spec: null`) harus tetap
terlihat. Tak ada sweep pembersih: keadaan itu jujur dan murah untuk ditampilkan.

`specId` juga **tak bisa ditulis lewat CRUD** — ia tak ada di `zCreateTask` maupun `zPatchTask`.
Tautan ke backlog lahir dari eskalasi, bukan dari ketikan; CRUD yang bisa mengarangnya berarti
kartu bisa mengaku tertaut pada `Spec` yang tak pernah menyetujuinya.

**6. Tak ada `doneAt` dan tak ada stempel transisi kolom.**

Gantt yang dipilih adalah **rencana-saja** (`startDate → dueDate` yang diisi manusia), jadi tanggal
aktual belum punya pembaca. Dihilangkan dengan sengaja, bukan terlupa. Menambahkannya nanti adalah
migration additif biasa.

**7. `order` bertipe `Float`.**

Drop di antara dua kartu menulis titik tengah tetangganya — tak ada reindex seluruh kolom, dan dua
mesin yang menulis bersamaan menghasilkan nilai yang tetap terurut. Seri dipecah oleh `id`, jadi
urutan yang dilihat dua mesin identik.

**8. Keduanya IKUT record-sync, terdaftar di sembilan tempat.**

`Member` dan `Task` punya `version` dan masuk `SYNCED`: papan kerja tim adalah pengetahuan bersama,
bukan setelan mesin. Konflik mengikuti LWW + antrean rekonsil yang sudah ada (ADR-0067); tak ada
aturan konflik khusus. Penghapusan mengikuti tombstone ADR-0119.

Setiap baris di tabel ini punya kelas gagal-senyap yang sudah pernah terjadi di repo ini:

| Tempat | Isi | Ditangkap apa | Kalau terlewat |
|---|---|---|---|
| `SYNCED` | `+ "member", "task"` | — | tak pernah menyeberang sama sekali |
| `DELEGATE` | dua entri `prisma.*` | tsc (`Record<Entity,…>`) | — |
| `FIELDS` | seluruh kolom bermakna + `updatedAt` | tsc hanya untuk *kunci* | kolom terlewat mendarat **null palsu tanpa satu pun error** (ADR-0090/0093/0105) |
| `DATE_FIELDS` | `task:{startDate,dueDate,createdAt,updatedAt}`, `member:{createdAt,updatedAt}` | tsc untuk kunci | tanggal mendarat sebagai string |
| `NUMBER_FIELDS` | `task:order` | — | urutan kartu acak di mesin lain |
| `BOOLEAN_FIELDS` | `member:active` | — | anggota nonaktif hidup lagi di mesin lain |
| `PARENTS` | `task → project`, `task → member` | `sync-parents-dmmf.test.ts` | anak yatim saat induk bertombstone (ADR-0119) |
| `BOOTSTRAP_ORDER` | `member` **sebelum** `task` | `sync-bootstrap.test.ts` | bootstrap sukses tanpa error tapi **assignee kosong** (kelas SPEC-885 "lupa `vps`") |
| **`PG_ORDER`** (`cli/src/commands/migrate-pg.ts`) | `Member` sebelum `Task`, keduanya sesudah `Project` | `cli/test/migrate-pg.test.ts` | test merah — daftar wajib memuat setiap model DMMF tepat sekali |

Baris terakhir hidup **di luar** `sync.ts` dan tak disebut dokumen desain induk sama sekali. Ia
daftar seluruh model untuk migrasi Postgres→SQLite; model baru yang lupa di sana membuat suite CLI
merah — bukan gagal senyap, tapi tetap wajib dikerjakan.

`FIELDS` adalah satu-satunya yang **tak punya gerbang mekanis** di repo ini. Karena itu
`server/test/team-schema.test.ts` membandingkan `__FIELDS.member`/`__FIELDS.task` dengan daftar
kolom DMMF dikurangi `id`/`version` memakai `toEqual` atas himpunan tersortir — bukan `toContain`
per kolom, yang lolos untuk kolom yang belum pernah terpikirkan.

`Member` sengaja **absen** dari `PARENTS`: direktori orang global, tanpa satu pun FK keluar.

**9. Papan tim adalah topik BERPARAMETER di `/events/ws`, bukan grup global ke-11.**

Menegakkan ADR-0145/0039. Alasannya biaya: `GROUPS` di-recompute untuk **setiap klien yang
terhubung** tiap N detik — grup `specs` saja 1 detik sekali. Papan tim punya sedikit penonton dan
banyak parameter (project, status, assignee, halaman), jadi ia mengikuti pola `tickets`: biaya
hanya lahir untuk parameter yang benar-benar ada yang menonton. `everyTicks: 3`.

`buildTasksPage` (`services/tasks-list.ts`) dipakai **bersama** oleh `GET /api/tasks` dan topik
siar — cermin `tickets-list.ts`. Menyalinnya berarti dua serializer yang bisa berselisih diam-diam.

**10. Deny-by-default DUA arah, dengan nol entri baru.**

Route `/api/members` & `/api/tasks` tertutup bagi role `client` karena `clientRouteAllowed` adalah
allowlist deny-by-default (ADR-0110), **dan** tertutup bagi agent token karena top-segment yang tak
terdaftar di `capabilityForRoute` jatuh ke `null`, yang `checkAgentCapability` perlakukan sama
dengan `COOKIE_ONLY` (ADR-0065). Papan tim adalah permukaan manusia; itu default yang benar.

Yang ditambahkan hanya **test** yang membuktikannya — supaya keadaan itu tetap begitu bila suatu
hari seseorang menambahkan cabang tanpa memikirkannya.

**11. Webhook keluar sengaja TIDAK disentuh.**

`webhooks/tap.ts` memakai registry eksplisit (`WEBHOOK_ENTITIES`), jadi model baru tak memancarkan
apa pun sampai seseorang mendaftarkannya. Belum ada yang meminta.

**Konsekuensi yang dinyatakan, bukan terlupa:** entri `project` punya
`cascade: ["spec","ticket","customAgent","githubIssue"]`, dan daftar itu jadi `data.cascade` pada
`project.deleted` — jumlah anak yang ikut lenyap. `Task` adalah anak `Project` ber-`onDelete:
Cascade`, jadi sejak ADR ini angka itu **kurang melaporkan** task yang ikut terhapus. `task` tidak
ditambahkan ke sana karena kunci di `data.cascade` adalah nama entity webhook, dan menambahkan
kunci untuk entity yang tak pernah memancarkan event sendiri berarti mengiklankan sesuatu yang tak
bisa dilanggan. Saat `task` didaftarkan sebagai entity webhook, kunci itu masuk bersamanya — satu
perubahan, bukan dua.

**12. Amandemen atas dokumen desain induk: `priority` memakai kosakata yang sudah ada.**

Dokumen induk menulis `priority String @default("normal")`. Repo ini sudah punya satu kosakata
prioritas — `zPriority = z.enum(["tinggi","sedang","rendah"])` (`shared/src/enums.ts`) — yang
dipakai `Spec`, PRD, dan tiket; `"normal"` bukan anggotanya. `Task.priority` karena itu memakai
`zPriority` dengan default `"sedang"`. Kartu tim duduk bersebelahan dengan backlog item di layar
yang sama, dan dua kosakata untuk satu konsep adalah cara keduanya mulai berbeda.

## Konsekuensi

- Dua tabel baru, satu migration aditif tulis-tangan, tanpa backfill. Tak ada tabel diredefinisi.
- `resetDb()` di harness test menyapu `task` lalu `member` — tanpa itu baris tim bocor antar-berkas
  test yang berbagi satu DB.
- `Spec` tak tersentuh sama sekali; SPEC-162 utuh.
- Menghapus anggota **tidak** menghapus pekerjaannya (`onDelete: SetNull`) — task jadi "belum
  ditugaskan". Menghapus project **menghapus** task-nya (`onDelete: Cascade`).
- Instance yang lebih tua di jaringan sync akan menolak push `member`/`task` sebagai kind tak
  dikenal sampai ia ikut diperbarui — perilaku normal `isEntity()`, bukan kerusakan.
- `TaskSpecMirror.stage` & `.priority` bertipe `string`, bukan union: keduanya kolom TEXT yang
  menyeberang sync dari mesin yang boleh lebih baru (ADR-0087), jadi menyempitkannya hanya bisa
  lewat cast — dan cast itu berbohong tentang nilai yang tak bisa dibuktikan (pelajaran `runtimeOf`,
  ADR-0101). Ini muatan untuk dirender, bukan untuk dicabangi.

## Alternatif yang ditolak

**Menambah kolom ke `Spec` (tenggat, assignee, kolom kanban).** Ditolak: SPEC-162 melarangnya untuk
sesi AI, dan `Spec.stage` yang diturunkan dari fase sesi tak bisa dipakai sebagai kolom yang bisa
di-drag tanpa membuat `executing`/`done` tercapai tanpa sesi.

**Menyimpan `stage` hasil eskalasi sebagai kolom di `Task`.** Ditolak oleh ADR-0090: nilainya bisa
dihitung ulang dari `Spec`, jadi kolom kedua hanya menciptakan dua kebenaran yang bisa drift.

**`Member` sebagai kolom di `User`, atau `Member.userId` sebagai FK.** Ditolak: `User` LOCAL-only
(tak ikut sync), jadi assignee akan kosong di setiap mesin lain. Pencocokan lewat `email` sebagai
string menghindarinya tanpa role baru dan tanpa menyentuh model akses.

**`Member` per project.** Ditolak: `Task.projectId` nullable, jadi direktori orang tak punya project
untuk digantung; dan orang yang sama lazim melintasi beberapa project.

**Grup global ke-11 di `GROUPS`.** Ditolak karena biaya — lihat keputusan 9.

**`order` sebagai `Int` dengan reindex kolom saat drop.** Ditolak: reindex menulis ulang setiap
kartu di kolom itu, dan dua mesin yang me-reindex bersamaan menghasilkan urutan yang berbeda.
