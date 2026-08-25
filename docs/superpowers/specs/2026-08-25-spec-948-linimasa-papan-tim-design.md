# SPEC-948 — Linimasa: mode Gantt per papan tim

Tanggal: 2026-08-25
Status: disetujui (brainstorming)
Induk: `2026-08-25-tim-kanban-gantt-design.md` (ADR-0150) — item **D**
Pendahulu: SPEC-945 (fondasi, ADR-0150) · SPEC-946 (papan, ADR-0151) · SPEC-947 (eskalasi, ADR-0152)
ADR yang lahir dari spec ini: **ADR-0153**

## Masalah

Papan tim menjawab "sedang dikerjakan apa" — empat kolom, kartu, assignee. Ia tidak menjawab
**"kapan"**. `Task.startDate` dan `Task.dueDate` sudah ada sejak SPEC-945 dan sudah bisa diisi
lewat `TaskModal`, tapi satu-satunya tempat keduanya terlihat adalah satu baris teks kecil di
kartu (`taskDates()` di `team-board.tsx`). Tenggat yang hanya bisa dibaca satu kartu pada satu
waktu tak bisa dipakai untuk menilai apakah janji ke klien realistis: yang menentukan itu adalah
**tumpang tindih** — dua tugas berat di minggu yang sama, satu orang dengan tiga tenggat di hari
yang sama.

Mode tampilan kedua di layar Tim menghamparkan tugas yang sama di sumbu waktu.

## Yang bukan masalah ini

- **Bukan** mode Lintas project (item E). Berkas `team-timeline.tsx` yang lahir di sini **wajib**
  bisa dipakai ulang olehnya, tapi baris-per-project, `projectSpan`, dan baris "Tanpa project"
  bukan lingkup SPEC-948.
- **Bukan** Gantt lengkap. Larangan induk berlaku apa adanya: **tak ada** batang "aktual", **tak
  ada** persen selesai, **tak ada** critical path, **tak ada** dependency antar-task. Yang
  digambar adalah **rencana** yang diketik manusia.
- **Bukan** mengedit tanggal dengan menyeret batang. Drag-to-reschedule butuh kuantisasi,
  snapping, dan undo; `TaskModal` sudah menjadi satu-satunya tempat tanggal ditulis dan tetap
  begitu. Klik batang **membuka** `TaskModal` — itu jalan mengeditnya.
- **Bukan** dependency paket baru. Nol library chart, nol library tanggal.
- **Bukan** cara memuat data baru. Mode Linimasa membaca `board` yang **sudah** dimuat & dilanggan
  mode Papan (empat langganan per kolom, ADR-0151). Berpindah mode tak menambah satu pun request.

## Keputusan yang mengunci bentuk

| Pertanyaan | Keputusan |
|---|---|
| Sumber data | `board` yang sama — nol fetch baru, nol langganan baru |
| Baris | Satu baris = satu task, urut mulai paling awal |
| Jendela | **Diturunkan dari data** + hari ini, dibulatkan ke batas satuan zoom |
| Zoom | `hari · minggu · bulan` — mengubah satuan tick, bukan menyaring data |
| Task setengah bertanggal | **Terjadwal**, batang selebar 1 hari. "Tanpa tanggal" = **kedua**-nya null |
| Tanggal terbalik (`due < start`) | Digambar apa adanya + ditandai **salah**, tidak diam-diam ditukar |
| Batas jendela | Tick diplafon; task yang jatuh di luar **didaftar**, tidak dihilangkan |
| Geometri | Fungsi MURNI `barGeometry(task, window)` → persen, di `team-rules.ts` |
| Gulir | Mendatar **di dalam** kanvas; badan halaman tak pernah ikut (SPEC-879) |

## Arsitektur

### Pemisahan: aturan murni vs piksel

Objective menuntut geometri batang hidup sebagai fungsi **murni**. Itu bukan selera gaya — ia
memisahkan dua hal yang gagal dengan cara berbeda: aritmetika tanggal gagal **senyap** (batang
bergeser sehari, lebar 1-hari jadi 0, tepi terpotong salah arah), sementara layout gagal **terlihat**.
Yang senyap harus bisa diuji tanpa jsdom.

```
team-rules.ts        aritmetika: taskSpan · timelineWindow · barGeometry · todayOffset · timelineRows
                     (plus taskDates, dipindah ke sini dari team-board.tsx)
team-timeline.tsx    piksel: TimelineCanvas (generik) + TeamTimeline (mode task)
TeamScreen.tsx       toolbar: satu entri TEAM_VIEWS + satu Select zoom + satu cabang render
```

`team-rules.ts` tetap nol React dan nol I/O. Tak satu pun fungsi di bawah membaca jam sistem —
**`today` selalu argumen**. Fungsi yang memanggil `Date.now()` sendiri hanya bisa diuji dengan
membekukan waktu global, dan membekukan `Date.now` di repo ini sudah pernah menjatuhkan test lain.

### Satuan waktu: hari, bukan milidetik

Seluruh aritmetika bekerja pada **awal hari UTC**. Alasannya `dateInputToIso()` (SPEC-946) menulis
`T12:00:00.000Z` — tengah hari UTC, dipilih supaya tanggal tak bergeser sehari di zona barat.
Membandingkan stempel mentah karena itu membandingkan "tengah hari" dengan "tengah malam", dan
selisih 12 jam cukup untuk membuat batang mulai setengah sel terlambat di zoom hari.

```ts
const DAY = 86_400_000;
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
```

UTC, bukan lokal, di **kedua** sisi: nilai yang ditulis UTC dan dibaca UTC bolak-balik tanpa
bergeser, dan pilihan itu sudah dikunci `dateInputToIso`/`dateInputValue`.

### `taskSpan` — dua tanggal menjadi satu rentang

```ts
export type TaskSpan = { start: number; end: number; invalid: boolean };
export function taskSpan(task: Pick<TaskView, "startDate" | "dueDate">): TaskSpan | null
```

Empat kasus, semuanya disengaja:

| Masukan | Hasil | Alasan |
|---|---|---|
| keduanya null | `null` | satu-satunya arti "belum dijadwalkan" |
| keduanya terisi | `[dayStart(start), dayStart(due) + DAY)` | **akhir inklusif** |
| satu terisi | `[dayStart(d), dayStart(d) + DAY)` | 1 hari |
| `due < start` | `[dayStart(min), dayStart(max) + DAY)`, `invalid: true` | digambar, ditandai |

**Akhir inklusif** adalah kesalahan Gantt paling klasik dan paling senyap: tugas yang mulai dan
selesai di hari yang sama punya `end - start === 0`, dan batang selebar nol tak terlihat sama
sekali — kartunya seolah tak punya tanggal padahal punya. `+ DAY` membuat "satu hari" benar-benar
selebar satu hari.

**Setengah bertanggal tetap terjadwal.** Kartu ber-`dueDate` saja adalah tenggat, dan tenggat
adalah justru hal yang dicari linimasa. `taskDates()` di kartu papan sudah merender rentang
setengah terisi (`→ 12 Sep`) sejak SPEC-946; menyembunyikannya di sini akan membuat dua permukaan
berselisih tentang apa artinya "punya tanggal". Definisi "belum dijadwalkan" karena itu **sempit**:
kedua tanggal null.

**Terbalik digambar, bukan ditukar.** `zCreateTask` tidak memaksa `dueDate >= startDate` dan
`TaskModal` tidak memvalidasinya, jadi keadaan ini bisa ada di DB. Menukarnya diam-diam membuat
layar menampilkan rencana yang tak pernah diketik siapa pun; menolak menggambarnya membuat kartu
lenyap tanpa sebab. Digambar di rentang yang sebenarnya, `invalid: true`, dan baris itu memakai
nada galat plus judul yang menyebut sebabnya.

### `timelineWindow` — jendela lahir dari data

```ts
export type TimelineZoom = "day" | "week" | "month";
export type TimelineWindow = { from: number; to: number; zoom: TimelineZoom; ticks: TimelineTick[] };
export function timelineWindow(spans: TaskSpan[], zoom: TimelineZoom, today: number): TimelineWindow
```

Jendela tetap = "hari ini ± N" akan membuat papan berisi rencana kuartal depan tampak kosong.
Jendela dari data saja akan membuat papan yang seluruh tugasnya bulan lalu tak memperlihatkan
"sekarang". Jadi keduanya: **gabungan rentang seluruh task ∪ {hari ini}**, dibulatkan **keluar** ke
batas satuan zoom, lalu diregangkan sampai jumlah tick minimum.

| Zoom | Satuan tick | Lebar sel | Tick minimum | Plafon tick |
|---|---|---|---|---|
| `day` | 1 hari | 34 px | 14 | 120 |
| `week` | 1 minggu (Senin) | 56 px | 8 | 120 |
| `month` | 1 bulan kalender | 84 px | 6 | 120 |

- **Minggu mulai Senin.** Konvensi ISO dan konvensi kerja di sini; `getUTCDay()` memberi 0 untuk
  Minggu, jadi pergeserannya `(day + 6) % 7`.
- **Bulan adalah satuan kalender**, bukan 30 hari. Tick bulan karena itu **tidak** sama lebar dalam
  hari — dan itulah kenapa geometri batang dihitung dalam **persen dari rentang waktu**, bukan
  dalam "sel keberapa". Sumbu piksel tetap seragam (tiap tick 84 px) sementara sumbu waktu tidak;
  keduanya berdamai karena batang diposisikan oleh waktu dan gridline oleh piksel. Konsekuensinya
  disebutkan terang-terangan: di zoom bulan, garis grid adalah **penanda bulan**, bukan koordinat
  presisi batang. Presisi hari adalah tugas zoom hari.
- **Plafon tick 120** melindungi DOM. Tanpa plafon, satu task bertanggal 2031 di zoom hari
  melahirkan ±2 000 sel header dan kanvas selebar 70 000 px. Dengan plafon, jendela **tetap
  berjangkar di mulai paling awal** dan task yang jatuh di luarnya **didaftar di bawah kanvas**
  (lihat `timelineRows`) — bukan menghilang. Plafon yang menghilangkan baris tanpa jejak adalah
  persis kelas bug yang sudah dijawab ADR-0151 dengan "menampilkan N dari M".

`TimelineTick = { start: number; label: string; major: boolean }`. `major` menandai tick yang
mendapat garis lebih tegas (awal bulan di zoom hari, awal bulan di zoom minggu, awal tahun di zoom
bulan) — satu-satunya cara membaca sumbu panjang tanpa menghitung sel.

### `barGeometry` — inti yang diminta objective

```ts
export type BarGeometry = {
  left: number; width: number;              // persen 0..100 terhadap [window.from, window.to)
  clippedStart: boolean; clippedEnd: boolean;
  invalid: boolean;
};
export function barGeometry(
  task: Pick<TaskView, "startDate" | "dueDate">, window: TimelineWindow,
): BarGeometry | null
```

- `null` = **tak ada batang di jendela ini**: task tanpa tanggal, atau rentangnya tak beririsan
  sama sekali dengan jendela. Pemanggil yang memutuskan mana dari keduanya — `taskSpan(task)`
  sudah membedakannya, jadi tak ada informasi yang hilang.
- **Clamping** di kedua tepi: `left = clamp(start)`, `right = clamp(end)`, keduanya ke
  `[window.from, window.to]`. `clippedStart`/`clippedEnd` menyala saat rentang aslinya melewati
  tepi, dan batangnya merender panah di sisi itu. Batang terpotong yang tak mengaku terpotong
  berbohong tentang tenggat.
- Irisan **setengah terbuka**: rentang yang berakhir tepat di `window.from` tidak beririsan
  (`end <= from` → `null`), sementara yang mulai tepat di `window.to` juga tidak (`start >= to`).
  Tanpa aturan ini, task yang berakhir kemarin muncul sebagai garis rambut di tepi kiri.
- `width` selalu > 0 untuk hasil non-null. Lebar **piksel** minimumnya urusan CSS
  (`minWidth: 3px`), bukan urusan geometri: memaksa lebar minimum ke dalam persen akan membuat
  batang 1-hari di zoom bulan **lebih panjang dari waktunya**, dan itu kebohongan yang sama.

### `todayOffset` dan `timelineRows`

```ts
export function todayOffset(window: TimelineWindow, today: number): number | null
export function timelineRows(tasks: TaskView[], window: TimelineWindow): {
  rows: { task: TaskView; geometry: BarGeometry }[];
  unscheduled: TaskView[];
  outside: TaskView[];
}
```

`todayOffset` mengembalikan persen, atau `null` bila hari ini di luar jendela — garis "hari ini"
yang dipaksa menempel di tepi menandai hari yang salah.

`timelineRows` adalah satu-satunya tempat ketiga ember dibagi, jadi tak ada task yang bisa jatuh
ke luar ketiganya. `rows` diurutkan **mulai paling awal**, seri dipecah oleh `title` lalu `id` —
urutan yang stabil, tak bergantung urutan datang dari empat langganan yang mendarat kapan saja.

Invarian yang diuji langsung: `rows.length + unscheduled.length + outside.length === tasks.length`.

### Menggambar: satu kanvas generik

`team-timeline.tsx` mengekspor dua hal. Yang generik lebih dulu, karena itulah yang dipakai ulang
item E:

```tsx
export type TimelineBarSpec = {
  key: string; geometry: BarGeometry; tone: "brass" | "err" | "muted";
  title: string; onClick?: () => void;
};
export type TimelineRowSpec = {
  key: string; label: React.ReactNode; meta?: React.ReactNode; bars: TimelineBarSpec[];
};
export function TimelineCanvas(props: {
  window: TimelineWindow; rows: TimelineRowSpec[]; today: number; emptyHint?: string;
}): JSX.Element;
```

`bars` **jamak** meski mode ini selalu mengirim satu: baris project di item E adalah satu baris
dengan banyak batang. Membuatnya tunggal sekarang berarti membongkar tanda tangannya nanti — dan
objective menyebut pemakaian ulang itu sebagai batasan, bukan harapan.

`TimelineCanvas` **tidak** tahu apa itu `Task`. Ia menerima label, batang, dan jendela. Semua
pengetahuan tentang task hidup di `TeamTimeline` yang membungkusnya.

**Struktur DOM & aturan gulir.**

```
<div class="hn-timeline-scroll">          ← overflow-x: auto · SATU-SATUNYA yang menggulir samping
  <div style="min-width: LABEL_W + Σtick"> ← lebar EKSPLISIT: anak blok yang menyusut = scroller mati
    <div role="row">  [ label sticky left:0 ] [ header tick × N — CSS grid ]
    <div role="row">  [ label sticky left:0 ] [ track: gridline gradient + batang absolut ]
    …
```

- Pembungkus dalam memakai lebar **eksplisit**. Anak blok di dalam container `overflow: auto`
  menyusut mengikuti containernya, dan scroller-nya lalu tak pernah punya apa pun untuk digulir —
  kegagalan yang sudah terukur di SPEC-879 (`.hn-local-overflow` beranak blok memberi tombol
  0 × 44 px).
- Kolom label **`position: sticky; left: 0`** dengan latar padat: nama tugas yang tergulir keluar
  membuat batang di sebelah kanan kehilangan pemiliknya.
- **Gridline sebagai `repeating-linear-gradient`, bukan N div per baris.** 40 baris × 120 tick =
  4 800 node kosong yang tak pernah dibaca siapa pun. Gradien menggambar hal yang sama dengan satu
  properti, dan ia tetap sejajar dengan header karena kanvasnya sama-sama `N × cell` px.
  Header tetap CSS grid sungguhan — di sanalah labelnya hidup.
- Batang diposisikan `left: X%; width: Y%` di dalam track ber-`position: relative`. Persen dan
  gridline piksel bertemu tepat karena `100% === N × cell`.
- Seluruh warna, radius, dan bayangan dari token DS (`--brass-*`, `--bone-*`, `--border-hair`,
  `--radius-*`, `--text-*`). Nol nilai hex baru.

**`TeamTimeline`** membangun `rows` dari task: label = judul + assignee, `meta` = rentang tanggal
(memakai `taskDates()`, yang **dipindah** dari `team-board.tsx` ke `team-rules.ts` supaya kanvas tak
perlu mengimpor papan — dipindah, bukan disalin), batang
ber-`tone: "err"` bila `invalid`, `onClick` membuka `TaskModal`. Di bawah kanvas, dua daftar yang
hanya muncul saat berisi: **"Belum dijadwalkan (N)"** dan **"Di luar jendela (N)"** — keduanya
memakai baris ringkas yang bisa diklik, dan yang kedua membawa saran zoom yang lebih lebar.

### Toolbar

Satu entri baru di array `TEAM_VIEWS` yang **sudah ada** — induknya menulis "item D menambahkan
entri ke array yang SAMA, bukan memasang mekanisme baru":

```ts
const TEAM_VIEWS = [
  { value: "board", label: "Papan", icon: "kanban" },
  { value: "timeline", label: "Linimasa", icon: "gantt-chart" },
];
```

`gantt-chart` → `GanttChart` **diverifikasi ada** di lucide 0.400.0 yang terpasang. SPEC-906
menunjukkan nama yang salah jatuh ke `Circle` tanpa satu pun galat; nama baru tak boleh masuk
tanpa dicek.

`usePersistedState("team", "zoom", "week", oneOf("day","week","month"))` — **`week` bawaan**: hari
terlalu sempit untuk melihat tabrakan, bulan terlalu kasar untuk melihat tenggat. Select zoom
hanya dirender di mode Linimasa; ia bukan penyaring, jadi ia **tidak** ikut `activeFilters` yang
menyalakan `ResetViewButton`.

Penyaring project/kolom/anggota/cari berlaku apa adanya — mereka sudah menentukan isi `board`,
dan linimasa membaca `board`. Menyaring kolom di linimasa berarti "hamparkan hanya tugas yang
sedang dikerjakan", dan itu masuk akal apa adanya.

Plafon 200/kolom tetap berlaku dan tetap **dirender**: satu baris "menampilkan N dari M" di bawah
kanvas bila `Σtotals > Σitems`, cermin ADR-0151 di papan.

## Penanganan galat

| Keadaan | Perilaku |
|---|---|
| Papan kosong | `StateBlock` yang sama seperti mode Papan — tak ada kanvas tanpa baris |
| Semua task tanpa tanggal | Kanvas dirender kosong dengan petunjuk, daftar "belum dijadwalkan" berisi penuh |
| Tanggal terbalik | Batang nada galat + `title` yang menyebutnya; data tak disentuh |
| Task di luar jendela | Didaftar di bawah kanvas dengan saran zoom, tak dihilangkan |
| Rentang jauh melebihi plafon | Jendela berjangkar di mulai paling awal; sisanya masuk daftar di atas |
| Muat gagal / basi | Persis mode Papan: papan basi ditandai, bukan diganti layar galat (ADR-0131) |
| `startDate` bukan tanggal sah | `new Date(x).getTime()` → `NaN` → `taskSpan` mengembalikan `null` → "belum dijadwalkan" |

## Test

**Aturan murni (`src/test/team-rules.test.ts`, menambah ke berkas yang ada):**
- `taskSpan`: akhir inklusif (start === due → tepat 1 hari); setengah bertanggal → 1 hari;
  keduanya null → `null`; terbalik → rentang benar + `invalid`; `NaN` → `null`.
- `timelineWindow`: pembulatan keluar per zoom; Senin sebagai awal minggu; hari ini selalu
  termuat; tick minimum saat data sempit; plafon 120 saat data lebar; `major` di tempat yang benar.
- `barGeometry`: batang di tengah; clamping kiri & kanan menyalakan flag yang **benar** (uji
  keduanya terpisah — `clippedStart`/`clippedEnd` yang tertukar lolos dari uji "batang terpotong");
  di luar jendela → `null`; menyentuh tepi tepat → `null`; `left + width <= 100` selalu.
- `todayOffset`: persen benar; `null` di luar jendela.
- `timelineRows`: invarian jumlah tiga ember; urutan; stabil terhadap urutan masukan.

**Render (`src/test/team-timeline.test.tsx`, berkas baru):**

Unit test aturan tidak cukup — pelajaran yang sama yang membuat SPEC-946 menulis
`team-board.test.tsx`: `left`/`width` yang tertukar, atau kolom label yang tak `sticky`, lolos
sempurna dari uji aritmetikanya sendiri.
- Batang muncul dengan `left`/`width` yang cocok dengan `barGeometry` untuk masukan yang sama.
- Task tanpa tanggal ada di daftar "belum dijadwalkan" dan **tidak** punya batang.
- Ganti zoom mengubah jumlah tick header.
- Klik batang memanggil `onOpen` dengan task yang benar.
- Kanvas — bukan badan halaman — yang membawa `overflow-x`, dan pembungkus dalamnya punya lebar
  eksplisit (SPEC-879).

**Layar (`src/test/team-screen.test.tsx`, menambah):**
- Tab "Linimasa" ada, memilihnya merender kanvas dan menyembunyikan papan.
- Select zoom hanya ada di mode Linimasa.
- Berpindah mode **tidak** memanggil `api.listTasks` lagi.

## Docs yang tersentuh

- `internal/docs/adr/0153-linimasa-gantt-papan-tim.md` — baru.
- `internal/docs/frontend/frontend-implementation.md` — mode tampilan layar Tim.
- `internal/docs/design-system/**` — kanvas linimasa sebagai pola layout, bila ada tempatnya.
- `internal/docs/README.md` — tautan ADR-0153.

Tak ada perubahan skema, tak ada route baru, tak ada perubahan kontrak sync — jadi
`architecture/data-model.md` dan `architecture/api-contract.md` **tidak** tersentuh.
