# ADR-0153 — Linimasa papan tim: geometri sebagai fungsi murni, dan yang tak muat tetap didaftar

Tanggal: 2026-08-25
Status: diterima
SPEC: SPEC-948 (item **D** dari design induk ADR-0150)
Terkait: ADR-0150 (fondasi `Task`/`Member`) · ADR-0151 (papan, langganan per kolom) · ADR-0152 (eskalasi) · SPEC-879 (gulir lokal) · SPEC-906 (nama ikon lucide)

## Konteks

Papan tim menjawab "sedang dikerjakan apa". Ia tidak menjawab **"kapan"**. `Task.startDate` dan
`Task.dueDate` sudah ada sejak SPEC-945 dan sudah bisa diisi lewat `TaskModal`, tapi satu-satunya
tempat keduanya terlihat adalah satu baris teks di kartu. Tenggat yang hanya bisa dibaca satu
kartu pada satu waktu tak bisa dipakai untuk menilai apakah janji ke klien realistis: yang
menentukan itu **tumpang tindih** — dua tugas berat di minggu yang sama, satu orang dengan tiga
tenggat di hari yang sama.

Mode tampilan kedua di layar Tim menghamparkan tugas yang sama di sumbu waktu. Yang harus
diputuskan bukan "apakah menggambar Gantt", melainkan hal-hal yang gagal **senyap** kalau salah:
aritmetika tanggal, batas jendela, dan apa yang terjadi pada baris yang tak muat.

## Keputusan

### 1. Aritmetika hidup sebagai fungsi murni di `team-rules.ts`

`taskSpan` · `timelineWindow` · `barGeometry` · `todayOffset` · `timelineRows`. Nol React, nol I/O,
dan **`today` selalu argumen** — tak satu pun dari kelimanya membaca jam sistem. Fungsi yang
membaca jamnya sendiri hanya bisa diuji dengan membekukan waktu global, dan membekukan `Date.now`
di repo ini sudah pernah menjatuhkan test lain.

Pemisahannya bukan selera gaya: aritmetika tanggal gagal **senyap** (batang bergeser sehari, lebar
satu hari jadi nol, tepi terpotong salah arah) sementara layout gagal **terlihat**. Yang senyap
harus bisa diuji tanpa jsdom.

### 2. Akhir tanggal **inklusif**

`taskSpan` mengembalikan `[dayStart(mulai), dayStart(tenggat) + 1 hari)`. Tanpa `+1 hari`, task
yang mulai dan selesai di hari yang sama punya lebar **nol** — batangnya tak terlihat sama sekali,
jadi kartunya seolah tak bertanggal padahal bertanggal, dan tak ada satu pun galat yang muncul.
Ini kesalahan Gantt paling klasik sekaligus paling senyap, dan ia diuji langsung.

### 3. "Belum dijadwalkan" berarti **kedua** tanggal null

Task dengan **satu** tanggal tetap terjadwal, digambar sebagai batang selebar satu hari. Kartu
ber-`dueDate` saja adalah **tenggat**, dan tenggat justru hal yang dicari linimasa. `taskDates()`
sudah merender rentang setengah terisi (`→ 12 Sep`) di kartu papan sejak SPEC-946; menyembunyikannya
di kanvas akan membuat dua permukaan berselisih tentang apa artinya "punya tanggal".

Tanggal yang tak sah (`"besok"` → `NaN`) disaring di satu pintu masuk dan jatuh ke "belum
dijadwalkan". Satu `NaN` yang lolos ke `Math.min` jendela mengosongkan **seluruh** kanvas tanpa
satu pun galat.

### 4. Tenggat yang mendahului mulai **digambar dan ditandai**, tidak ditukar

`zCreateTask` tak memaksa `dueDate >= startDate` dan `TaskModal` tak memvalidasinya, jadi keadaan
ini bisa ada di DB. Tiga pilihan, dan dua di antaranya berbohong:

- Menukar diam-diam → layar menampilkan rencana yang **tak pernah diketik siapa pun**.
- Menolak menggambar → kartunya lenyap tanpa sebab yang bisa dilihat operator.
- **Dipilih:** digambar di rentang yang sebenarnya, `invalid: true`, batang bernada galat, dan
  `title` yang menyebut sebabnya.

### 5. Jendela lahir dari **data ∪ hari ini**

Dibulatkan **keluar** ke batas satuan zoom, lalu diregangkan sampai tick minimum per zoom.

Jendela tetap ("hari ini ± N") membuat papan berisi rencana kuartal depan tampak kosong; jendela
dari data saja membuat papan yang seluruh tugasnya bulan lalu tak memperlihatkan "sekarang".
Keduanya, karena itu.

| Zoom | Satuan tick | Lebar sel | Tick minimum |
|---|---|---|---|
| `day` | 1 hari | 34 px | 14 |
| `week` | 1 minggu (**Senin**) | 56 px | 8 |
| `month` | 1 bulan kalender | 84 px | 6 |

Minggu mulai Senin (ISO dan konvensi kerja di sini); `getUTCDay()` memberi 0 untuk Minggu, jadi
pergeserannya `(hari + 6) % 7`.

### 6. Tick bulan adalah satuan **kalender**, jadi tak sama lebar dalam hari

Konsekuensinya dinyatakan terang-terangan, bukan disembunyikan: **batang diposisikan oleh WAKTU
(persen), gridline oleh PIKSEL.** Keduanya berdamai karena `100% === N × cell`. Di zoom bulan,
garis grid karena itu adalah **penanda bulan**, bukan koordinat presisi batang — presisi hari
adalah tugas zoom hari.

Alternatifnya, "bulan = 30 hari", akan membuat sumbu meleset makin jauh tiap bulan yang lewat.

### 7. Plafon `MAX_TICKS = 120`, dan yang tak muat **didaftar**

Tanpa plafon, satu task bertanggal 2031 di zoom hari melahirkan ±2 000 sel header dan kanvas
selebar 70 000 px. Dengan plafon, jendela tetap **berjangkar di mulai paling awal** dan task yang
jatuh di luarnya dirender sebagai daftar **"Di luar jendela (N) — pilih zoom yang lebih lebar"** di
bawah kanvas.

Plafon yang menghilangkan baris tanpa jejak adalah kelas bug yang sudah dijawab ADR-0151 dengan
"menampilkan N dari M". Aturan yang sama berlaku di sini, dan `timelineRows` menegakkannya lewat
invarian yang diuji: `rows + unscheduled + outside === tasks`.

### 8. Clamping mengaku, dan irisan setengah terbuka

`barGeometry` menjepit ke `[from, to]` dan menyalakan `clippedStart`/`clippedEnd` **terpisah per
sisi**; batang terpotong merender sudut siku plus chevron di sisi itu. Batang terpotong yang tak
mengaku terpotong berbohong tentang tenggat. Kedua flag diuji terpisah dengan sisi lawannya
dipastikan mati — flag yang tertukar lolos sempurna dari uji "batang terpotong".

Irisan **setengah terbuka**: rentang yang berakhir tepat di `window.from` tidak beririsan, begitu
pula yang mulai tepat di `window.to`. Tanpa aturan ini, task yang berakhir kemarin muncul sebagai
garis rambut selebar nol di tepi kiri — kartu yang seolah dijadwalkan hari ini.

Lebar **piksel** minimum (`minWidth: 3px`) urusan CSS, bukan geometri. Memaksanya ke dalam persen
membuat batang satu hari di zoom bulan tampak **lebih panjang dari waktunya**.

### 9. Aritmetika dan label **UTC** di kedua sisi

`dateInputToIso` menulis tengah hari UTC (SPEC-946, supaya tanggal tak mundur sehari di zona
barat). Menghitung dengan awal hari **lokal** berarti membandingkan tengah hari dengan tengah
malam, dan selisih 12 jam itu cukup untuk menggeser batang setengah sel di zoom hari. Setiap
`Intl.DateTimeFormat` di jalur ini ber-`timeZone: "UTC"` — termasuk `taskDates()` yang dipindah ke
`team-rules.ts`, yang sebelumnya tak punya dan karena itu bisa memberi label yang bergeser sehari.

### 10. Nol fetch baru

Linimasa membaca `board` yang **sudah** dimuat & dilanggan mode Papan (empat langganan per kolom,
ADR-0151). Berpindah mode dan mengganti zoom tak melahirkan satu pun request — diuji langsung.
Konsekuensinya plafon 200/kolom berlaku di sini juga, dan ia tetap **dirender**: satu baris
"N tugas tak termuat karena plafon 200 per kolom".

Penyaring project/kolom/anggota/cari berlaku apa adanya karena merekalah yang menentukan isi
`board`. Zoom **bukan** penyaring: ia tak ikut `activeFilters` yang menyalakan `ResetViewButton`.

### 11. `TimelineCanvas` generik, `bars` **jamak**

`team-timeline.tsx` mengekspor kanvas yang **tak menyebut `Task` sama sekali** — ia menerima
`rows: TimelineRowSpec[]`, jendela, dan `today`. Seluruh pengetahuan tentang task hidup di
`TeamTimeline` yang membungkusnya.

`bars` jamak meski mode task selalu mengirim satu: baris per **project** di item E adalah satu
baris dengan banyak batang. Membuatnya tunggal sekarang berarti membongkar tanda tangannya nanti,
dan pemakaian ulang itu adalah **batasan** yang ditulis SPEC-948, bukan harapan.

### 12. Gridline sebagai gradien, bukan div per sel

`repeating-linear-gradient` menggantikan satu div per sel per baris — 40 baris × 120 tick = 4 800
node kosong yang tak pernah dibaca siapa pun. Header tetap CSS grid sungguhan; di sanalah labelnya
hidup.

### 13. Gulir mendatar milik kanvas, dengan lebar pembungkus **eksplisit**

`.hn-timeline-scroll` yang menggulir, tak pernah badan halaman (SPEC-879). Pembungkus di dalamnya
memakai lebar eksplisit `LABEL_W + N × cell`: anak **blok** di dalam container `overflow: auto`
menyusut mengikuti containernya, dan scroller-nya lalu tak punya apa pun untuk digulir — kegagalan
yang sudah terukur di SPEC-879 (`.hn-local-overflow` beranak blok memberi tombol 0 × 44 px).

Kolom label `position: sticky; left: 0` dengan latar padat: nama tugas yang tergulir keluar membuat
batang di sebelah kanan kehilangan pemiliknya.

## Konsekuensi

- **Tanggal aktual belum punya pembaca.** Gantt ini rencana-saja (ADR-0150): tak ada batang
  "aktual", tak ada persen selesai, tak ada critical path, tak ada dependency antar-task. `Task`
  memang tak punya `doneAt` maupun stempel transisi kolom — dihilangkan dengan sengaja, dan
  menambahkannya kelak adalah migration additif biasa.
- **Menyeret batang tidak mengubah tanggal.** `TaskModal` tetap satu-satunya penulis tanggal; klik
  batang membukanya. Drag-to-reschedule butuh kuantisasi, snapping, dan undo — tiga hal yang
  belum ada yang meminta.
- **Zoom bulan tidak presisi hari.** Sudah dinyatakan di keputusan 6; operator yang butuh presisi
  hari memakai zoom hari.
- **Jendela dibekukan sekali per mount** (`useRef(Date.now())`). Tab yang dibiarkan terbuka melewati
  tengah malam menunjukkan garis "hari ini" yang basi satu hari sampai dimuat ulang. Jendela yang
  bergeser di tengah interaksi lebih membingungkan daripada itu.
- **`taskDates()` pindah rumah** dari `team-board.tsx` ke `team-rules.ts` supaya kanvas memakainya
  tanpa mengimpor papan. Ia sekaligus mendapat `timeZone: "UTC"` yang sebelumnya tak ada.
- **Nol dependency baru.** Tak ada library chart, tak ada library tanggal.

## Alternatif yang ditolak

- **Library Gantt** (`frappe-gantt`, `dhtmlx`, `react-calendar-timeline`) — dependency baru untuk
  hal yang muat dalam satu berkas, dan tak satu pun bisa memakai token design system tanpa dilawan.
  Larangan ini eksplisit di SPEC-948.
- **Menaikkan zoom otomatis saat data tak muat.** Zoom adalah pilihan operator; mengubahnya sendiri
  membuat kontrol yang nilainya berpindah tanpa diminta.
- **Menyimpan geometri di state React.** Dua kebenaran yang bisa drift; geometri lahir dari
  jendela dan tanggal, dan keduanya sudah ada.
- **Grup global ke-11 di `GROUPS`.** Tak ada topik baru sama sekali — linimasa membaca papan yang
  sudah dilanggan (keputusan 10).
- **Menyembunyikan task tanpa tanggal.** Papan yang diam-diam memotong terbaca sebagai papan yang
  lengkap; keputusan 3 dan 7 keduanya menolak itu.
