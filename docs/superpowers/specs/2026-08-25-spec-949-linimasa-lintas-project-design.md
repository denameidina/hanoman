# SPEC-949 — Linimasa lintas project di layar Tim

Tanggal: 2026-08-25
Status: disetujui (brainstorming)
Induk: `2026-08-25-tim-kanban-gantt-design.md` (ADR-0150) — item **E**, yang terakhir
Pendahulu: SPEC-945 (fondasi, ADR-0150) · SPEC-946 (papan, ADR-0151) · SPEC-947 (eskalasi, ADR-0152) · SPEC-948 (linimasa per papan, ADR-0153)
ADR yang lahir dari spec ini: **ADR-0154**

## Masalah

Linimasa SPEC-948 menjawab **"kapan"** untuk satu papan. Ia tidak menjawab **"project mana yang
jadwalnya bertabrakan"** — dan itu pertanyaan yang berbeda jenis, bukan versi lebih besar dari
pertanyaan yang sama.

Sebabnya struktural, bukan soal jumlah baris. Layar Tim berbagi satu penyaring project dengan
Backlog (`projectFilter` milik App, SPEC-146). Selama penyaring itu berlaku, tiap permukaan layar
Tim menjawab pertanyaan **di dalam satu project**. Dua project yang tenggatnya menumpuk di minggu
yang sama karena itu tak pernah terlihat di satu layar bersama-sama: masing-masing terlihat wajar
sendirian, dan tabrakannya baru ketahuan setelah terlambat.

Mode tampilan **ketiga** — dan yang terakhir — menghamparkan seluruh project pada satu sumbu waktu.

## Yang bukan masalah ini

- **Bukan** kanvas baru. `TimelineCanvas` lahir generik di SPEC-948 justru untuk dipakai di sini:
  ia tak menyebut `Task` sama sekali, dan `bars`-nya sudah jamak. Menyalinnya adalah kegagalan,
  bukan alternatif.
- **Bukan** aritmetika baru. `taskSpan` · `timelineWindow` · `todayOffset` dipakai apa adanya;
  yang ditambahkan hanya agregasi (`projectSpan`, `projectGroups`) dan satu **refactor** yang
  memisahkan `barGeometry` dari `taskSpan`.
- **Bukan** rumah di `OverviewScreen`. Batasan objective menyebutnya eksplisit, dan alasannya
  berdiri sendiri: `OverviewScreen.tsx` sudah padat, dan mode ini adalah mode ketiga dari sebuah
  layar yang sudah punya dua — memindahkannya ke layar lain memutus `TEAM_VIEWS` yang sudah
  dijaga test cermin.
- **Bukan** perubahan skema, route, atau kontrak sync. Nol kolom, nol endpoint, nol entri
  `SYNCED`/`FIELDS`. Seluruhnya frontend di atas `GET /api/tasks` yang sudah ada.
- **Bukan** Gantt lengkap. Larangan induk berlaku apa adanya: tak ada batang aktual, tak ada
  persen selesai, tak ada critical path, tak ada dependency antar-task.
- **Bukan** mengedit tanggal dengan menyeret. Persis SPEC-948: klik segmen **membuka** `TaskModal`.

## Keputusan yang mengunci bentuk

| Pertanyaan | Keputusan |
|---|---|
| Penyaring project | **Dinonaktifkan dan terlihat mati** di mode ini; nilainya tak diubah |
| Sumber data | `board` yang sama, tapi `projectId` dilepas dari filter → **ada** refetch saat pindah mode |
| Baris | Satu baris per project + satu baris "Tanpa project" |
| Batang baris project | **Amplop** `projectSpan` + **segmen per task** di atasnya |
| Buka baris | Task-nya muncul sebagai baris anak; jendela **tidak** bergeser |
| Project tanpa task bertanggal | Baris tetap ada, **nol batang**, meta menyebut sebabnya |
| Agregasi | Fungsi MURNI `projectSpan(tasks)` + `projectGroups(...)` di `team-rules.ts` |
| Kanvas | `TimelineCanvas` **dipakai ulang**, ditambah dua prop opsional |

### 1. Penyaring project dinonaktifkan, bukan diabaikan

Mode yang gunanya membandingkan antar-project tak boleh mendarat menampilkan satu baris karena
penyaring yang disetel di layar lain masih menempel. Tiga jalan, dan dua di antaranya salah:

- **Tetap berlaku** → mode mendarat dalam keadaan degenerate tanpa penjelasan.
- **Diabaikan diam-diam** → `Select` menyala menyebut "Project X" sementara kanvas menampilkan
  semuanya. Penyaring yang tampak aktif tapi tak berlaku adalah kebohongan UI dengan kelas yang
  sama seperti plafon yang memotong senyap (ADR-0151).
- **Dipilih:** `Select` di-`disabled` dengan `title` yang menyebut sebabnya, `projectId` dilepas
  dari `filters`, dan ia **tidak** ikut dihitung `activeFilters` — lencana "N filter aktif" yang
  menghitung penyaring yang tak berlaku sama menyesatkannya.

**Nilainya tidak diubah.** `projectFilter` milik App dan dipakai bersama Backlog (SPEC-146);
menuliskan `"all"` ke sana saat mode dibuka akan mengubah apa yang dilihat layar **lain**.

**Konsekuensi yang dinyatakan terang-terangan:** berbeda dari SPEC-948, berpindah ke/dari mode ini
**mengganti kunci langganan** saat penyaring project sedang aktif, jadi ada empat request baru.
Klaim "berpindah mode tak menambah satu pun request" tetap berlaku untuk Papan ↔ Linimasa dan
tetap berlaku untuk mode ini **saat penyaring `all`**. Biayanya jujur dan tak bisa dihindari:
mode ini butuh task dari project yang tak dimuat mode lain.

Penyaring kolom, anggota, dan pencarian tetap berlaku apa adanya — "hamparkan hanya yang sedang
dikerjakan, lintas project" adalah pertanyaan yang masuk akal.

### 2. Amplop **dan** segmen, bukan amplop saja

Objective mewajibkan batang `min(startDate) → max(dueDate)`. Amplop itu sendirian **berbohong
tentang okupansi**: project yang punya satu task di Januari dan satu di Desember menggambar batang
selebar setahun dan tampak bertabrakan dengan segala sesuatu, padahal sepuluh bulan di tengahnya
kosong. Karena satu-satunya gunanya mode ini adalah menemukan tabrakan, kebohongan itu tepat
mengenai satu-satunya pembacanya.

```
Situs Klien   ▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▓   ← amplop (bone-200, resesif)
              ██              ████       ← segmen per task (brass)
```

Baris project karena itu membawa **1 + N** batang: amplop lebih dulu (dilukis di bawah), lalu satu
segmen per task bertanggal. Inilah pemakaian `bars` jamak yang sudah disiapkan SPEC-948 —
tanda tangannya tidak berubah satu huruf pun.

Segmen tetap dirender saat baris **dibuka**. Baris ringkas yang berubah arti tergantung apakah ia
sedang dibuka lebih sulit dibaca daripada sedikit pengulangan.

### 3. Buka baris tidak menggeser jendela

Jendela dihitung dari **seluruh** task yang termuat, bukan dari baris yang terlihat. Kalau tidak,
membuka satu project akan menggeser sumbu dan seluruh baris lain ikut bergerak — persis saat
operator sedang membandingkan dua di antaranya.

### 4. Project tanpa jadwal tetap punya baris

Batasan objective: "Project tanpa satu pun task bertanggal tidak boleh menghasilkan batang selebar
nol atau NaN." Ditegakkan di sumbernya — `projectSpan` mengembalikan **`null`**, dan baris tanpa
batang tak punya jalan menuju `NaN%`.

Barisnya tetap dirender, dengan `meta` yang menyebut sebabnya, karena ia bisa **dibuka**: di situlah
operator melihat task mana yang belum punya tanggal. Baris yang dihilangkan menyembunyikan pekerjaan
yang ada.

Dua sebab bar-less dibedakan di `meta`, tidak digabung: **"belum dijadwalkan"** (`span === null`)
dan **"di luar jendela"** (punya `span`, tapi tak beririsan dengan jendela berplafon 120 tick).

## Arsitektur

### Aritmetika — tambahan di `team-rules.ts`

Tetap nol React, nol I/O, `today` selalu argumen.

**Refactor yang mendahului fitur.** `barGeometry(task, window)` hari ini mengunci `taskSpan` di
dalamnya, jadi rentang yang **bukan** milik satu task tak punya jalan menuju persen. Isinya
dipisah, tanda tangan lamanya utuh:

```ts
export function spanGeometry(span: TaskSpan, window: TimelineWindow): BarGeometry | null;
export function barGeometry(
  task: Pick<TaskView, "startDate" | "dueDate">, window: TimelineWindow,
): BarGeometry | null;   // = span ? spanGeometry(span, window) : null
```

Clamping, irisan setengah terbuka, `clippedStart`/`clippedEnd`, dan `invalid` pindah apa adanya —
seluruh test `barGeometry` yang ada harus tetap hijau **tanpa disentuh**. Itu buktinya ini
pemisahan, bukan penulisan ulang.

**`projectSpan` — yang diminta objective:**

```ts
export function projectSpan(tasks: Pick<TaskView, "startDate" | "dueDate">[]): TaskSpan | null;
```

- `null` bila **tak satu pun** task punya tanggal sah — termasuk daftar kosong. Satu-satunya jalan
  menuju "batang selebar nol atau NaN" ditutup di sini.
- `start` = `min` dari `taskSpan(t).start`, `end` = `max` dari `taskSpan(t).end`. Akhir tetap
  **inklusif** karena `taskSpan` sudah menambahkan satu hari (ADR-0153 keputusan 2) — menambahkannya
  lagi di sini akan membuat setiap project satu hari lebih panjang dari task-nya.
- `invalid` = **ada** task yang `invalid`. Artinya di baris project adalah "berisi rentang yang tak
  sah", bukan "tenggat project mendahului mulainya" (yang mustahil, `min <= max` selalu). Baris
  bernada galat itulah yang membuat operator membukanya dan menemukan kartunya; membiarkannya
  wajar berarti tanggal terbalik hanya bisa ditemukan dengan membuka semua baris satu per satu.
- Task tanpa tanggal **diabaikan**, tidak membuat hasilnya `null`. Project yang punya satu task
  bertanggal dan sembilan tanpa tanggal tetap punya rentang.

**`projectGroups` — pembagian ember, satu tempat:**

```ts
export type ProjectGroup = {
  /** `null` = "Tanpa project" — tugas internal tim (ADR-0150). */
  projectId: string | null;
  span: TaskSpan | null;
  /** `null` = tak ada amplop: `span` null, atau `span` di luar jendela. Bedanya dibaca dari `span`. */
  geometry: BarGeometry | null;
  /** Seluruh task grup ini: bertanggal lebih dulu (mulai paling awal), tak bertanggal di ekor. */
  tasks: TaskView[];
};

export function projectGroups(
  tasks: TaskView[], window: TimelineWindow, name: (projectId: string | null) => string,
): ProjectGroup[];
```

`name` adalah **argumen**, bukan impor: `team-rules.ts` tak boleh tahu apa itu `ProjectVM`, dan
urutan baris yang tak bertanggal harus mengikuti nama yang dilihat operator — bukan `id` yang
kebetulan cuid. Fungsinya tetap murni; pemanggil merakit resolvernya.

Urutan baris berjenjang, dan jenjangnya disengaja:

1. `geometry !== null` (terlihat di kanvas) — diurutkan `span.start` menaik.
2. `span !== null` tapi di luar jendela — `span.start` menaik.
3. `span === null` — belum dijadwalkan.

Seri di tiap jenjang dipecah `name(...)` lalu `projectId` (`null` terakhir). Yang terlihat di
kanvas naik ke atas karena baris tanpa batang tak punya apa pun untuk dibandingkan di sumbu waktu;
mendorongnya ke bawah menjaga bagian atas kanvas tetap padat.

Diurutkan oleh **`span.start`, bukan `geometry.left`**: amplop yang terpotong di kiri semuanya
ber-`left` 0, dan urutannya akan runtuh jadi urutan kedatangan dari empat langganan (pelajaran
`timelineRows`, ADR-0153).

**Invarian yang diuji langsung:** `Σ groups[].tasks.length === tasks.length`, dan tiap `task.id`
muncul **tepat satu kali** di seluruh grup. Tak ada ember keempat, jadi tak ada task yang bisa
jatuh keluar — cermin invarian `timelineRows`.

### Kanvas — dua prop opsional, nol perubahan perilaku lama

`TimelineCanvas` bertambah dua prop, keduanya ber-default sehingga pemanggil SPEC-948 tak berubah:

```tsx
export function TimelineCanvas(props: {
  window: TimelineWindow; rows: TimelineRowSpec[]; today: number; emptyHint?: string;
  /** `data-testid` kanvas. Default `"team-timeline"`. */
  testId?: string;
  /** Judul kolom label. Default `"Tugas"`. */
  labelHead?: string;
}): JSX.Element;
```

`testId` bukan kosmetik. `src/test/team-screen.test.tsx` menegakkan cermin `TEAM_VIEWS` ↔ cabang
render lewat daftar `SURFACES`, dan aturannya "tak ada dua mode yang berbagi permukaan". Mode ini
memakai komponen yang **sama** dengan mode Linimasa, jadi tanpa `testId` sendiri ia lolos cermin
itu sambil justru melanggar apa yang dijaganya. Nilainya `"team-projects"`, dan `SURFACES`
bertambah satu entri.

`TONE` bertambah satu nada **`envelope`** — `background: var(--bone-200)`, `border:
var(--border-hair)`. Ia harus lebih resesif dari `muted` (`bone-300`/`border-strong`), yang sudah
dipakai task berstatus `done`: amplop yang sewarna dengan task selesai membuat dua hal berbeda
tampak sama.

### Menggambar — `TeamProjectTimeline` di `team-timeline.tsx`

Berkasnya sama, bukan berkas baru: induk (ADR-0150) menetapkan `team-timeline.tsx` sebagai
"kanvas Gantt — dipakai mode Linimasa DAN Lintas project", dan menaruh pemakaian ulang di
sebelah yang dipakainya membuat kontraknya sulit didrift.

```tsx
export function TeamProjectTimeline(props: {
  tasks: TaskView[]; projects: { id: string; name: string }[]; members: MemberView[];
  zoom: TimelineZoom; today: number; hidden: number;
  expanded: string[]; onToggle: (projectId: string) => void;
  onOpen: (t: TaskView) => void;
}): JSX.Element;
```

`projects` disempitkan ke `{ id, name }` — komponen kanvas tak butuh sisa `ProjectVM`, dan tanda
tangan yang menyebut lebih dari yang dipakai mengundang ketergantungan yang tak disadari.

Jendela dihitung identik dengan `TeamTimeline`: `tasks.map(taskSpan)` → `timelineWindow(spans,
zoom, today)`. Gabungan rentang seluruh task sama persis dengan gabungan rentang seluruh project,
jadi tak ada rumus kedua.

Tiap grup menghasilkan satu `TimelineRowSpec`:

| Bagian | Isi |
|---|---|
| `key` | `p:<projectId>` · `p:__none__` untuk Tanpa project |
| `label` | tombol expand: ikon `chevron-right`/`chevron-down` + nama + `· N` |
| `meta` | rentang tanggal, atau `"belum dijadwalkan"`, atau `"di luar jendela · pilih zoom yang lebih lebar"` |
| `bars` | `[amplop, ...segmen]` — amplop lebih dulu supaya segmen dilukis di atasnya |

Amplop: `key: "span:<projectId>"`, `tone: "envelope"` (atau `"err"` bila `invalid`), `onClick`
men-toggle baris. Segmen: `key: "seg:<taskId>"`, nada mengikuti aturan `TeamTimeline`
(`err` bila invalid · `muted` bila `done` · `brass` selebihnya), `onClick` membuka `TaskModal`.

Baris anak (hanya saat dibuka): `key: "t:<taskId>"`, label ber-indent, `meta` = assignee ·
rentang, `bars` = `[]` bila tak ada geometri. Persis satu batang selebihnya.

**Tombol expand wajib membawa `minHeight` inline.** Di `pointer: coarse` dan di bawah 768 px,
`app.css` menaikkan setiap `button` ke `min-height: var(--touch-target)` (44 px); tombol 44 px di
baris 34 px meluber menimpa baris berikutnya, dan jsdom tak memuat stylesheet sehingga **nol test
akan merah**. Gotcha yang sama sudah membuat `Bar` menyatakan `minHeight`-nya (ADR-0153).

### Toolbar & TeamScreen

```ts
export const TEAM_VIEWS = [
  { value: "board",    label: "Papan",         icon: "kanban" },
  { value: "timeline", label: "Linimasa",      icon: "gantt-chart" },
  { value: "projects", label: "Lintas project", icon: "layers" },
];
```

`layers` → `Layers` **diverifikasi ada** di lucide 0.400.0 yang terpasang, lewat `toPascal` di
`ds/icon.tsx`. SPEC-906 menunjukkan nama yang salah jatuh ke `Circle` tanpa satu pun galat.
`chevron-right`/`chevron-down` ikut diverifikasi.

Perubahan di `TeamScreen.tsx`:

- `const cross = view === "projects";`
- `filters.projectId` → `cross ? undefined : (projectFilter === "all" ? undefined : projectFilter)`
- `activeFilters` → `projectFilter !== "all" && !cross`
- `Select` project → `disabled={cross}` + `title` yang menyebut sebabnya
- `Select` zoom → dirender saat `timeline || cross` (satu state `zoom` yang sama, ADR-0115)
- state baru `usePersistedState<string[]>("team", "expanded", [], strList)` — `strList` sudah ada
  di `ui-state/store.ts`; nilai rusak jatuh ke `[]`, tak pernah melempar
- satu cabang render ketiga

`emptyHint` mode ini: `"Belum ada project bertanggal — isi mulai atau tenggat di kartunya."`

Baris "menampilkan N dari M" (plafon 200/kolom, ADR-0151) tetap dirender apa adanya.

## Penanganan galat

| Keadaan | Perilaku |
|---|---|
| Papan kosong tanpa penyaring | `StateBlock` yang sama seperti dua mode lain |
| Project tanpa satu pun task bertanggal | `projectSpan` → `null` → baris tanpa batang + meta "belum dijadwalkan". Nol lebar, nol `NaN` |
| Project bertanggal tapi di luar jendela berplafon | Baris tanpa batang + meta "di luar jendela" + saran zoom |
| Task tanpa tanggal di project bertanggal | Diabaikan `projectSpan`; muncul sebagai baris anak tanpa batang saat dibuka |
| Tanggal task terbalik | Segmen bernada galat; amplop project ikut `invalid` supaya barisnya mengaku |
| `startDate` bukan tanggal sah | `taskSpan` → `null` (disaring `stamp`) → diperlakukan seperti tanpa tanggal |
| `projectId` menunjuk project yang tak ada di daftar | Label jatuh ke `projectId` mentah, baris tetap ada — cermin `"belum ditugaskan"` di kartu |
| `expanded` menyimpan project yang sudah lenyap | Diabaikan; tak ada baris yang bisa dibukanya. Tak ada sweep pembersih |
| Muat gagal / basi | Persis dua mode lain: papan basi ditandai, bukan diganti layar galat (ADR-0131) |

## Test

**Aturan murni (`src/test/team-rules.test.ts`, menambah):**

- `spanGeometry`: seluruh test `barGeometry` yang ada **tetap hijau tanpa disentuh** — itulah bukti
  refactor-nya pemisahan, bukan penulisan ulang. Ditambah satu test yang memanggil `spanGeometry`
  dengan rentang yang tak berasal dari task.
- `projectSpan`: gabungan dua task; akhir **inklusif tidak ganda** (satu task saja → identik dengan
  `taskSpan`-nya); task tanpa tanggal diabaikan; **seluruh** task tanpa tanggal → `null`; daftar
  kosong → `null`; satu task `invalid` menular ke `invalid` project; tanggal `NaN` tak mencemari
  `min`/`max`.
- `projectGroups`: invarian jumlah + tiap id tepat sekali; "Tanpa project" jadi grup ber-`projectId`
  `null`; urutan berjenjang (terlihat → di luar jendela → tanpa jadwal); seri dipecah oleh `name`,
  bukan `id`; stabil terhadap urutan masukan; task di dalam grup terurut dengan yang tak bertanggal
  di ekor.

**Render (`src/test/team-projects.test.tsx`, berkas baru):**

Unit test aturan tidak cukup — pelajaran yang sama yang melahirkan `team-board.test.tsx` dan
`team-timeline.test.tsx`: amplop dan segmen yang **tertukar urutan lukisnya** lolos sempurna dari
uji aritmetikanya sendiri.

- Baris per project muncul, plus baris "Tanpa project" untuk task ber-`projectId` null.
- Amplop memakai persen yang sama dengan `spanGeometry(projectSpan(tasks), window)`.
- Amplop dirender **sebelum** segmen di DOM (urutan lukis), dan segmen ada satu per task bertanggal.
- Project yang seluruh task-nya tanpa tanggal: baris ada, **nol** batang, dan tak ada atribut
  gaya yang memuat `NaN`.
- Klik expand memunculkan baris anak; klik lagi menyembunyikannya; jendela (jumlah tick) **tidak**
  berubah di antara keduanya.
- Klik segmen memanggil `onOpen` dengan task yang benar.
- Kanvas membawa `data-testid="team-projects"`.

**Layar (`src/test/team-screen.test.tsx`, menambah):**

- `SURFACES` bertambah `"team-projects"`; test cermin `TEAM_VIEWS` lulus dengan tiga entri.
- Tab "Lintas project" ada; memilihnya merender kanvas dan menyembunyikan dua permukaan lain.
- Penyaring project **`disabled`** di mode ini dan **kembali hidup** saat pindah mode; nilainya tak
  berubah.
- Dengan penyaring project aktif, masuk ke mode ini **memuat ulang tanpa `projectId`** — request
  tambahan yang memang disengaja, diuji supaya ia tak hilang diam-diam.
- Select zoom hidup di mode ini juga.

## Docs yang tersentuh

- `internal/docs/adr/0154-linimasa-lintas-project.md` — baru.
- `internal/docs/README.md` — tautan ADR-0154 + baris ringkas layar `Tim`.
- `internal/docs/frontend/frontend-implementation.md` — mode tampilan ketiga layar Tim.
- `internal/skills/hanoman/SKILL.md` — SPEC-949/ADR-0154 di klausa Papan Tim.

Tak ada perubahan skema, route, maupun kontrak sync — `architecture/data-model.md` dan
`architecture/api-contract.md` **tidak** tersentuh.
