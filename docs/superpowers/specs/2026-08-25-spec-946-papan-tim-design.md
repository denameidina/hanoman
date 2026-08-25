# SPEC-946 — Papan Tim: layar `Tim`, mode Papan, modal Anggota

Tanggal: 2026-08-25
Status: disetujui
Induk: [Tim — papan kanban manusia, linimasa, dan overview lintas project](2026-08-25-tim-kanban-gantt-design.md) (item **B** dari lima)
Sebelumnya: [SPEC-945 — Fondasi Tim](2026-08-25-spec-945-fondasi-tim-design.md) (item **A**, sudah mendarat)
ADR yang lahir dari spec ini: **ADR-0151**

## Ruang lingkup

Item **B**: permukaan pertama di atas fondasi SPEC-945. Layar `Tim`, entri nav, cabang `App.tsx`,
mode tampilan **Papan** (empat kolom, drag HTML5 native), kartu ber-aksi eksplisit, toolbar dua
baris cermin `BacklogScreen`, dan **modal kelola Anggota** di dalam layar itu.

**Tidak** disentuh di sini:

- **Eskalasi ke backlog** (`POST/DELETE /api/tasks/:id/escalate`, dialog, cermin stage, lepas
  tautan) — item **C**. Kartu tetap merender `specId`/`spec` bila ada, tapi tak ada satu pun aksi
  yang membuat atau melepas tautan.
- **Linimasa** (Gantt per papan) — item **D**. `barGeometry` belum ditulis.
- **Lintas project** — item **E**. `projectSpan` belum ditulis.
- Skema, migration, pendaftaran sync, dan `capabilityForRoute`/`clientRouteAllowed`: semuanya
  sudah selesai dan benar di SPEC-945. Nol perubahan.

Yang dikerjakan sisi server hanya **satu**: parameter `q` pada `GET /api/tasks` dan topik `tasks`.
Alasannya di bawah.

## Keadaan awal yang terukur

Sisi belakang lengkap; sisi depan nol. `TaskView`, `MemberView`, `TaskStatus`, `TASK_STATUSES`,
`zCreateTask`, `zCreateMember` tak muncul sekali pun di seluruh `src/`, dan `paths.tasks` /
`paths.members` (`shared/src/api.ts:215–218`) belum punya satu pun fungsi `api.*` yang memakainya.
Jadi spec ini murni UI di atas kontrak yang sudah jadi.

## Bentuk layar

```
Shell(active="team", title="Tim")
└── TeamScreen                      toolbar · fetch · state · toggle view · modal
    ├── baris 1   [Papan] · Tugas baru · Anggota · SyncButton · ResetViewButton · N tugas · Live
    ├── baris 2   Cari · Project · Status · Anggota
    ├── TeamBoard (team-board.tsx)  4 kolom, drag HTML5
    │   └── TaskCard               prioritas · project · assignee · tanggal · pindah · tugaskan
    ├── TaskModal                  buat / ubah / hapus satu kartu
    └── MembersPanel               modal kelola anggota
```

### Pemecahan berkas

`BacklogScreen` 63 KB dan `TerminalScreen` 57 KB adalah pelajaran yang tak perlu diulang, jadi
berkasnya dipecah **sejak awal**, bukan sesudah membengkak:

| Berkas | Tanggung jawab | Boleh mengimpor |
|---|---|---|
| `screens/team-rules.ts` | fungsi **murni**: `canDropTask`, `nextOrder`, `moveCard` | nol React, nol I/O |
| `screens/team-board.tsx` | `TeamBoard` + `TaskCard` — render & event drag | `team-rules`, DS |
| `screens/MembersPanel.tsx` | modal kelola anggota (daftar + CRUD) | `api`, DS |
| `screens/TeamScreen.tsx` | toolbar, fetch, state, toggle view, `TaskModal` | semua di atas |

`team-rules.ts` tak mengimpor React **secara konstruksi**, jadi ia bisa diuji tanpa jsdom dan
tak bisa diam-diam menumbuhkan state.

## Empat kolom, dan kenapa semuanya menerima drop

Kolomnya lahir dari `TASK_STATUSES` (`shared/src/team.ts:11`), bukan dari daftar literal baru —
`COLUMNS` milik `BacklogScreen` adalah cermin yang tak boleh ditiru bentuknya, karena kolom di sana
disintesis (`BACKLOG_COL`/`SUCCESS_COL`) di atas `Spec.stage`.

| kunci | label |
|---|---|
| `backlog` | Backlog |
| `doing` | Dikerjakan |
| `review` | Review |
| `done` | Selesai |

Di board Backlog `canDrop` adalah **penyempitan** — satu-satunya drop yang sah adalah
`backlog → brainstorming`, karena `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024) dan UI
yang menulisnya akan membuat `executing`/`done` tercapai tanpa sesi yang benar-benar berjalan.

Di papan tim aturannya **berbalik**: `Task.status` memang milik manusia, jadi keempat kolom saling
menerima. Yang tersisa dari aturan itu hanya satu larangan:

```ts
export const canDropTask = (from: TaskStatus, to: TaskStatus): boolean => from !== to;
```

Drop ke kolom asal ditolak karena ia bukan perpindahan — menerimanya berarti satu `PATCH` yang
menulis nilai yang sudah ada, satu baris `SyncLog`, dan satu siaran ke tiap device (ADR-0131
mengukur biaya baris yang lahir tanpa pembaca).

**Kartu mendarat di ujung kolom tujuan**, `order = nextOrder(kolomTujuan)` = `max(order) + 1`.
Menyusun ulang kartu **di dalam** kolom lewat drag bukan bagian item B: ia butuh indikator sisip
antar-kartu, dan objective item B menyebut "pindah kolom", bukan "urutkan". `Task.order` tetap
dipakai dan tetap bermakna — nilai naik monoton per kolom, jadi item D/E membacanya apa adanya.

## Papan berlangganan PER KOLOM

Ini keputusan yang mengunci bentuk, dan ia lahir dari satu fakta di kontrak SPEC-945:
`zTopicParams.tasks` mewajibkan `page` dan `limit`, dan `zSubLimit` menjepit `limit` ke **maksimum
200** (`shared/src/dto.ts:741`). Papan tak dipaginasi, tapi topiknya tak bisa tak-berbatas.

**Satu langganan untuk seluruh papan adalah pilihan yang salah dan bisa dibuktikan salah.**
`buildTasksPage` mengurutkan `order asc, id asc` atas seluruh himpunan; potongan 200 pertama karena
itu memotong himpunan gabungan empat kolom di titik yang sewenang-wenang. `order` bermakna **di
dalam** kolom, jadi urutan lintas-status tak punya arti — kolom mana yang terpotong, dan seberapa,
tak bisa dijelaskan kepada operator.

Papan karena itu memasang **empat langganan**, satu per kolom, masing-masing
`{projectId?, status, memberId?, q?, page: 1, limit: 200}`. Konsekuensinya:

- tiap kolom punya `total`-nya **sendiri** — angka di header kolom jujur, bukan sisa pembagian;
- plafon berlaku per kolom, jadi kolom `done` yang menumpuk tak pernah menghabiskan jatah kolom
  `doing`;
- **tak ada plafon senyap**: begitu `total > items.length`, kaki kolom merender
  "menampilkan 200 dari N — persempit penyaring". Board yang diam-diam memotong terbaca sebagai
  papan yang lengkap, dan itu kebohongan yang paling mahal di layar ini;
- biayanya 4 dari `MAX_SUBS = 16` — satu layar Scheduler sudah memakai 5.

Muat awal HTTP memakai **parameter yang sama persis** dengan langganannya (empat `GET /api/tasks`
paralel, `limit=200`), jadi yang terlihat saat memuat identik dengan yang akan didorong frame WS
tiga detik kemudian. Muat awal tak-berbatas lalu langganan berplafon berarti kartu **hilang** dari
layar tanpa satu pun tindakan operator.

`everyTicks: 3` dan `POLL_MS` fallback 5000 mengikuti `tickets` apa adanya (SPEC-908/ADR-0145).

## Satu-satunya perubahan server: `q`

Toolbar mensyaratkan "cari". `GET /api/tasks` hari ini hanya mengenal `projectId`/`status`/
`memberId`. Ada dua jalan, dan yang dipilih adalah yang **tidak berbohong saat kolom penuh**:

- **Menyaring di klien** — nol perubahan kontrak, tapi pencarian hanya melihat ≤200 kartu yang
  sudah termuat. Tugas ke-300 di kolom `done` tak bisa ditemukan dengan mengetik judulnya, dan
  layar tak punya cara memberi tahu bahwa ia sedang mencari di dalam potongan.
- **Menyaring di server** — `q` disaring **sebelum** paginasi, jadi pencarian menjangkau seluruh
  tabel dan plafon 200 berlaku pada hasil pencariannya.

Dipilih yang kedua. Bentuknya menyalin `buildTicketsPage` (`services/tickets-list.ts:29–32`) apa
adanya: substring **case-insensitive** yang dihitung **di memori** sesudah `findMany`, bukan
`contains` Prisma — `contains` di SQLite peka huruf besar-kecil untuk non-ASCII, dan `mode:
"insensitive"` tak didukung provider ini. Ladangnya `title` + `detail`.

Perubahannya additif dan tiga baris: `TasksFilter.q`, penyaring di `buildTasksPage`, dan
`q: z.string().max(200).optional()` di `zTopicParams.tasks`. Route sudah meneruskan query apa
adanya. Amandemen kecil atas ADR-0150, dicatat di ADR-0151.

**Ketikan di-debounce 400 ms sebelum menyentuh KUNCI langganan** (`Q_DEBOUNCE_MS`, pola
`TriageScreen:381–388`): tiap huruf melahirkan kunci baru yang dibangun server di luar jadwal, jadi
mengetik 12 huruf tanpa jeda berarti 12 pembangunan yang sebelas di antaranya langsung dibuang.
Muat HTTP tetap per-ketikan.

## Toolbar dua baris

Cermin `BacklogScreen:978–1035`, dipangkas ke penyaring yang punya arti di sini.

**Baris 1** — `Tabs variant="pill"` mode tampilan (DS tak punya `SegmentedControl`), tombol
**Tugas baru**, tombol **Anggota**, `SyncButton`, `ResetViewButton`, hitungan ber-`role="status"`,
`LiveConnectionBadge`.

`TEAM_VIEWS` hari ini berisi **satu** entri (`board` · "Papan"). Ia tetap dirender sebagai tablist
dan tetap disimpan lewat `usePersistedState("team", "view", …)` karena item D dan E menambahkan
entri ke array yang sama — bukan memasang mekanisme baru. `accept` memakai `oneOf(...)` atas daftar
yang sama, jadi nilai lama dari versi lain jatuh ke default alih-alih membekukan layar di mode yang
tak ada.

**Baris 2** — `Cari tugas` (`Input leftIcon="search"`), `Filter project`, `Filter status`,
`Filter anggota`. Semua `Select` beropsi sentinel `{value: "all"}` yang dipetakan ke `undefined`
sebelum menyeberang ke query/params.

**Penyaring project memakai `App.projectFilter`** (SPEC-146: App pemilik tunggal "daftar disaring
ke project mana"), jadi berpindah dari Backlog ke Tim tidak mengganti project yang sedang dilihat.
Karena state itu milik App dan di luar jangkauan `resetUiState("team")`, `ResetViewButton` diberi
`onReset` — persis alasan `resetView` ada di `BacklogScreen:933`.

**Tidak ada sentinel "Tanpa project" di penyaring ini.** `where.projectId` di server hanya dipasang
saat nilainya truthy, jadi `projectId: null` tak bisa dinyatakan sebagai query tanpa sentinel baru
di kontrak. Kartu tanpa project tetap terlihat di "Semua project" dan diberi label `tanpa project`;
barisnya sendiri adalah item **E**.

Semua state tampilan berkunci `team` (SPEC-740/ADR-0115): `view`, `q`, `status`, `memberId`,
`scroll` papan. `page` tak ada — papan tak dipaginasi.

## Kartu

```
┌──────────────────────────────────┐
│ ▲ tinggi        proyek-x          │   prioritas (Badge) + project / "tanpa project"
│ Rapikan halaman harga            │   judul → membuka TaskModal
│ 👤 Dena · 12 Sep → 20 Sep         │   assignee + rentang tanggal
│ [Pindah ke ▾]  [Tugaskan ▾]      │   aksi eksplisit
└──────────────────────────────────┘
```

Kartu `draggable` di **semua** kolom, `flex: "0 0 auto"` (tanpa itu kartu menyusut mengisi kolom
alih-alih kolomnya menggulir), dan `opacity: 0.4` selama diseret.

**Drag HTML5 mati total di keyboard dan di layar sentuh**, jadi dua `Select` di kaki kartu bukan
hiasan — di sana merekalah satu-satunya jalan. `aria-label` keduanya memuat judul tugas
(`Pindah kolom: <judul>`, `Tugaskan: <judul>`) supaya papan berisi banyak kartu tetap punya nama
yang unik bagi pembaca layar **dan** bagi test.

Tanggal dirender `d MMM` lewat `Intl.DateTimeFormat("id-ID")`; kartu tanpa tanggal tak merender
baris itu sama sekali (bukan "—"). Tautan backlog (`specId`) dirender sebagai `Badge` baca-saja
bila ada — item C yang memberinya aksi.

## Modal tugas

Satu `Modal` untuk buat **dan** ubah, dibedakan oleh ada/tidaknya kartu yang sedang dipegang:
judul, project (`Select`, opsi pertama "Tanpa project"), status, prioritas, anggota, `startDate`,
`dueDate` (`Input type="date"`), detail (`HnTextarea`). Menghapus lewat `useConfirm` — bukan
`window.confirm`, yang dijaga `src/test/confirm-inventory.test.ts` (ADR-0127).

`<input type="date">` memancarkan `YYYY-MM-DD`, sedangkan `zCreateTask` menuntut ISO 8601
**ber-offset** (`z.string().datetime({ offset: true })`). Konversi dua arah karena itu hidup di
satu tempat di `team-rules.ts` (`dateInputValue` / `dateInputToIso`) dan diuji sebagai fungsi
murni: mengirim `"2026-09-12"` apa adanya ditolak `400` oleh route, dan menaruh konversinya inline
di dua tempat adalah cara keduanya mulai berbeda.

## Modal Anggota

Di dalam layar Tim, **bukan** `SettingsScreen.tsx` — berkas itu sudah 93 KB dan menambah panel ke
sana memperburuk yang memang sudah terlalu besar.

Isinya: daftar (aktif dulu, nama asc — urutan datang dari server), tambah (`name`, `email`,
`role?`), ubah `name`/`role`, sakelar `active`, dan hapus ber-`useConfirm`.

**`email` tak bisa diubah.** Id anggota diturunkan darinya (`memberId()`, ADR-0094/ADR-0150) dan
changefeed sync tak punya operasi rename. Form ubah karena itu tidak menampilkan field email
sebagai input sama sekali — ia menampilkan emailnya sebagai teks plus kalimat "ganti email = hapus
lalu buat baru". Route sudah menolak `"email" in body` dengan `400`; UI yang menawarkan field lalu
membuangnya adalah kelas bug yang sama yang membuat lapis kedua itu ditulis.

Menghapus anggota **tidak** menghapus tugasnya (`onDelete: SetNull`); dialog konfirmasi
menyebutkannya lewat `impact[]`.

## Penanganan galat

- **`PATCH` drop gagal** — kartu dikembalikan ke kolom asal (pemindahan optimistis dibatalkan) dan
  toast merah muncul. Papan tak boleh menampilkan kartu di kolom yang tak pernah disimpan server.
- **Kolom melewati plafon 200** — kaki kolom menyebut jumlah yang tak tertampil. Bukan galat,
  tapi ia harus terlihat.
- **Muat awal gagal** — `StateBlock kind="error"` + "Coba lagi". Kegagalan refresh senyap (WS/
  fallback) tak boleh menimpa layar yang sudah tampil.
- **`memberId` menunjuk anggota terhapus** — tak mungkin lewat DB (`SetNull`), tapi bisa lewat
  frame yang mendahului. Kartu merender "belum ditugaskan", bukan id mentah.
- **`specId` tanpa `spec`** — Badge "tautan putus". Aksinya item C.

## Test

Empat lapis, dan lapis kedua ada karena lapis pertama tak cukup:

1. **`team-rules.test.ts`** — `canDropTask` (keempat kolom saling menerima, kolom asal ditolak),
   `nextOrder` (kolom kosong → 0, `max+1`, mengabaikan urutan masukan), `moveCard` (kartu berpindah
   larik, `order` benar, papan lain tak tersentuh), `dateInputValue`/`dateInputToIso` (bolak-balik).
2. **`team-board.test.tsx`** — render jsdom yang **men-drag kartu sungguhan**
   (`fireEvent.dragStart` + `fireEvent.drop`), pola `src/test/backlog-board.test.tsx:159–175`.
   `from`/`to` yang tertukar **lolos** dari unit test aturannya sendiri; hanya wiring yang bisa
   menangkapnya. Termasuk: drop lintas kolom memanggil `PATCH` dengan status tujuan yang benar,
   drop ke kolom asal tak memanggil apa pun, dan kedua `Select` kartu mengirim mutasi yang sama.
3. **`team-screen.test.tsx`** — toolbar (semua kontrol punya nama yang bisa dipegang), penyaring
   menyeberang ke query, modal Anggota terbuka dari layar Tim, plafon kolom terlihat saat
   `total > items.length`.
4. **`changelog-nav.test.tsx`** — sudah ada dan **akan merah** bila entri nav `team` ditambahkan
   tanpa cabang `section === "team"` di `App.tsx`. Tak diubah; ia gerbangnya.

Sisi server: `tasks-list.test.ts` bertambah kasus `q` (cocok di `title`, cocok di `detail`, tak
peka huruf besar-kecil, disaring **sebelum** paginasi), dan `team-topic.test.ts` membuktikan
`q` diterima `zTopicParams.tasks`.

## Yang sengaja TIDAK diubah

- **`GROUPS` di `services/events.ts`.** Papan tim adalah topik berparameter. Menaikkannya jadi grup
  global ke-11 berarti ia di-recompute untuk **setiap** klien yang terhubung, termasuk yang tak
  pernah membuka layar Tim (ADR-0150 keputusan 6).
- **`capabilityForRoute` & `clientRouteAllowed`.** Keduanya deny-by-default; `/tasks` dan
  `/members` sudah tertutup bagi agent token dan role `client` tanpa satu baris pun, dan test yang
  membuktikannya sudah ada sejak SPEC-945.
- **`shared/src/webhook.ts`.** `entityDefForModel` adalah registry eksplisit; `Task`/`Member` tak
  memancarkan apa pun sampai seseorang mendaftarkannya. Belum ada yang meminta.
- **Skema, migration, `SYNCED`/`FIELDS`/`PARENTS`/`BOOTSTRAP_ORDER`.** Selesai di SPEC-945.
- **`Spec`.** Nol kolom ditambahkan. Larangan estimasi & tenggat di `Spec` (SPEC-162) utuh.
