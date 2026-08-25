# ADR-0154 — Linimasa lintas project: amplop yang tak berbohong tentang okupansi

Tanggal: 2026-08-25
Status: diterima
SPEC: SPEC-949 (item **E**, yang terakhir, dari design induk ADR-0150)
**Memperluas ADR-0150 & ADR-0153** (mode tampilan ketiga di layar Tim; kanvas ADR-0153 dipakai ulang tanpa satu huruf pun berubah di tanda tangannya)
Terkait: ADR-0151 (plafon 200/kolom yang tetap dirender) · ADR-0152 (eskalasi) · ADR-0115 (state tampilan persisten) · ADR-0131 (nilai basi, bukan layar galat) · SPEC-146 (App pemilik tunggal penyaring project) · SPEC-255 (`Project.id` renameable) · SPEC-906 (nama ikon lucide)

## Konteks

Linimasa ADR-0153 menjawab **"kapan"** untuk satu papan. Ia tidak menjawab **"project mana yang
jadwalnya bertabrakan"** — dan itu pertanyaan yang berbeda jenis, bukan versi lebih besar dari
pertanyaan yang sama.

Sebabnya struktural, bukan soal jumlah baris. Layar Tim berbagi satu penyaring project dengan
Backlog (`projectFilter` milik App, SPEC-146). Selama penyaring itu berlaku, **setiap** permukaan
layar Tim menjawab pertanyaan di dalam satu project. Dua project yang tenggatnya menumpuk di minggu
yang sama karena itu tak pernah terlihat di satu layar bersama-sama: masing-masing terlihat wajar
sendirian, dan tabrakannya baru ketahuan setelah terlambat.

Yang harus diputuskan bukan "apakah menggambar baris per project" — objective sudah menyebutnya.
Yang harus diputuskan adalah hal-hal yang **berbohong** kalau salah: apa yang terjadi pada penyaring
yang tak berlaku, apa arti sebuah rentang project, dan apa yang terjadi pada baris yang tak punya
rentang sama sekali.

## Keputusan

### 1. Penyaring project **dinonaktifkan dan terlihat mati**, bukan diabaikan

Mode yang gunanya membandingkan antar-project tak boleh mendarat menampilkan satu baris karena
penyaring yang disetel di layar lain masih menempel. Tiga jalan, dan dua di antaranya salah:

- **Tetap berlaku** → mode mendarat dalam keadaan degenerate tanpa penjelasan apa pun.
- **Diabaikan diam-diam** → `Select` menyala menyebut "Project X" sementara kanvas menampilkan
  semuanya. Penyaring yang tampak aktif tapi tak berlaku adalah kebohongan UI dengan kelas yang
  sama seperti plafon yang memotong senyap (ADR-0151).
- **Dipilih:** `disabled` + `title` yang menyebut sebabnya, `projectId` dilepas dari `filters`, dan
  ia **tidak** ikut dihitung `activeFilters` — lencana "N filter aktif" (ADR-0115) yang menghitung
  penyaring yang tak berlaku sama menyesatkannya.

**Nilainya tidak ditulis.** `projectFilter` milik App dan dipakai bersama Backlog; menyetelnya ke
`"all"` saat mode dibuka mengubah apa yang dilihat layar **lain**.

**Konsekuensi yang dinyatakan terang-terangan:** berbeda dari ADR-0153, berpindah ke/dari mode ini
**mengganti kunci langganan** saat penyaring project sedang aktif — empat request baru. Klaim "nol
fetch" ADR-0153 tetap berlaku untuk Papan ↔ Linimasa, dan tetap berlaku untuk mode ini **saat
penyaringnya `all`**. Biayanya tak bisa dihindari: mode ini butuh task dari project yang tak dimuat
mode lain. Keduanya diuji — yang memuat ulang **dan** yang tidak — supaya kelakuan ini tak bisa
berubah diam-diam.

Penyaring kolom, anggota, dan pencarian tetap berlaku apa adanya: "hamparkan hanya yang sedang
dikerjakan, lintas project" adalah pertanyaan yang masuk akal.

### 2. Baris project membawa **amplop DAN segmen**, bukan amplop saja

Objective mewajibkan batang `min(startDate) → max(dueDate)`. Amplop itu sendirian **berbohong
tentang okupansi**: project dengan satu task di Januari dan satu di Desember menggambar batang
selebar setahun dan tampak bertabrakan dengan segala sesuatu, padahal sepuluh bulan di tengahnya
kosong. Karena satu-satunya guna mode ini adalah menemukan tabrakan, kebohongan itu tepat mengenai
satu-satunya pembacanya.

Tiap baris project karena itu berisi **1 + N** batang: amplop lebih dulu (dilukis di bawah), lalu
satu segmen per task bertanggal. Ini pemakaian `bars` **jamak** yang sudah disiapkan ADR-0153 —
tanda tangan `TimelineCanvas` tak berubah satu huruf pun, hanya bertambah dua prop **opsional**.

Urutan lukisnya diuji langsung: amplop yang dilukis **sesudah** segmen menutupi segmennya, dan itu
kegagalan yang lolos sempurna dari uji aritmetikanya sendiri.

Segmen tetap dirender saat baris **dibuka**. Baris ringkas yang berubah arti tergantung apakah ia
sedang dibuka lebih sulit dibaca daripada sedikit pengulangan.

### 3. `projectSpan` mengembalikan **`null`**, bukan rentang selebar nol

Batasan objective: project tanpa satu pun task bertanggal tak boleh menghasilkan batang selebar nol
atau `NaN`. Ditegakkan **di sumbernya** — `projectSpan([])` dan `projectSpan` atas task yang semua
tanggalnya null/tak sah mengembalikan `null`, dan baris tanpa rentang tak punya jalan menuju `NaN%`.

Tiga aturan turunannya:

- **Akhir tetap inklusif tanpa ditambahkan dua kali.** `taskSpan` sudah menambahkan satu hari
  (ADR-0153 keputusan 2); menambahkannya lagi di agregasi membuat **setiap** project sehari lebih
  panjang dari task terakhirnya. Diuji dengan `projectSpan([t])` yang wajib identik `taskSpan(t)`.
- **Task tanpa tanggal diabaikan, bukan membatalkan rentang.** Project dengan satu task bertanggal
  dan sembilan tanpa tanggal tetap punya rentang.
- **`invalid` menular** dari task mana pun yang tenggatnya mendahului mulainya. Artinya di baris
  project adalah "berisi rentang yang tak sah" — bukan "tenggat project mendahului mulainya", yang
  mustahil karena `min <= max` selalu. Nada galat itulah yang membuat operator membuka barisnya dan
  menemukan kartunya; tanpa itu tanggal terbalik hanya bisa ditemukan dengan membuka semua baris
  satu per satu.

### 4. `barGeometry` **dipisah** menjadi `spanGeometry`

`barGeometry(task, window)` mengunci `taskSpan` di dalamnya, jadi rentang yang **bukan** milik satu
task tak punya jalan menuju persen — dan rentang project memang tak punya `startDate`. Isinya
dipisah menjadi `spanGeometry(span, window)`; `barGeometry` menjadi `span ? spanGeometry(...) : null`
dengan tanda tangan lamanya utuh.

Buktinya ini pemisahan dan bukan penulisan ulang: **seluruh** test `barGeometry` lama tetap hijau
tanpa disentuh, ditambah satu test yang menuntut `barGeometry(t, w)` sama persis dengan
`spanGeometry(taskSpan(t)!, w)` — kalau keduanya pernah menjadi dua rumus, test itu yang jatuh
lebih dulu.

### 5. Jendela dihitung dari **seluruh task**, bukan dari baris yang terlihat

Membuka satu baris project tidak menggeser sumbu. Kalau jendela lahir dari baris yang sedang
terlihat, membuka satu project akan menggerakkan **semua** baris lain — persis saat operator sedang
membandingkan dua di antaranya. Gabungan rentang seluruh task identik dengan gabungan rentang
seluruh project, jadi rumusnya tetap satu (`timelineWindow`, ADR-0153) dan tak ada rumus kedua.

Plafon 120 tick berlaku apa adanya. Project yang jatuh di luar jendela **tetap punya baris**, tanpa
batang, dengan `meta` yang menyebut sebabnya dan menyarankan zoom yang lebih lebar — dibedakan dari
"belum dijadwalkan", tidak digabung. Dua keadaan bar-less yang punya sebab berbeda dan penawar
berbeda tak boleh terlihat sama.

### 6. `TimelineCanvas` bertambah `testId`, dan itu bukan kosmetik

`team-screen.test.tsx` menegakkan cermin `TEAM_VIEWS` ↔ cabang render lewat daftar `SURFACES`
dengan aturan "tak ada dua mode yang berbagi permukaan" (ADR-0151/0153). Mode ini memakai komponen
yang **sama** dengan mode Linimasa — jadi tanpa `data-testid` sendiri ia **lolos** cermin itu sambil
melanggar persis apa yang dijaganya. Nilainya `"team-projects"`, dan `SURFACES` bertambah satu entri.

Prop kedua, `labelHead`, hanya mengganti judul kolom label ("Tugas" → "Project"). Keduanya
ber-default sehingga pemanggil ADR-0153 tak berubah — dan test ADR-0153 yang tetap hijau tanpa
disentuh yang membuktikannya.

### 7. Kunci "tanpa project" adalah `Symbol`, bukan string sentinel

`Project.id` renameable sejak SPEC-255, jadi sentinel apa pun — `"null"`, `"__none__"` — adalah
`projectId` yang **sah** dan akan menggabungkan dua grup diam-diam. Pengelompokan karena itu memakai
`Symbol` yang tak bisa bertabrakan dengan id mana pun. Kunci DOM/state terbuka tetap string
`"__none__"`, dan di sana tabrakan hanya berarti dua baris berbagi keadaan buka-tutup — terlihat,
bukan senyap, dan tak menghilangkan data.

## Konsekuensi

- **Nol kolom, nol route, nol entri sync.** `architecture/data-model.md` dan
  `architecture/api-contract.md` **tidak** tersentuh. Seluruhnya frontend di atas `GET /api/tasks`
  yang sudah ada sejak ADR-0150/0151.
- **Nol dependency baru.** Tak ada library chart, tak ada library tanggal — larangan ADR-0153
  ditegakkan.
- **Layar Tim kini punya tiga mode**, dan `TEAM_VIEWS` adalah satu-satunya daftarnya. Mode keempat
  menambah entri ke array yang sama dan **wajib** membawa permukaannya sendiri ke `SURFACES`.
- **Zoom dibagi bersama** mode Linimasa lewat satu kunci `hn.ui.v1.team.zoom` (ADR-0115): operator
  yang menyetel "bulan" di satu mode menemukannya "bulan" di mode lain. State baru
  `hn.ui.v1.team.expanded` menyimpan baris yang terbuka; nilai rusak jatuh ke `[]` tanpa melempar,
  dan project yang sudah lenyap tinggal di sana tanpa efek — tak ada sweep pembersih, karena tak
  ada baris yang bisa dibukanya.
- **Plafon 200/kolom (ADR-0151) tetap berlaku dan tetap dirender.** Mode ini membaca `board` yang
  sama, jadi ia mewarisi plafon itu berikut kewajiban mengakuinya.
- **Rantai ADR-0150 tertutup.** Item A→B→{C,D}→E selesai: fondasi (0150), papan (0151), eskalasi
  (0152), linimasa papan (0153), linimasa lintas project (0154).

## Alternatif yang ditolak

- **Mengabaikan penyaring project diam-diam.** Nol perubahan toolbar, dan tepat karena itu
  operator tak punya cara tahu penyaring yang menyala tak berlaku (keputusan 1).
- **Menulis `projectFilter` ke `"all"` saat mode dibuka.** Efek samping yang mengubah layar lain;
  App pemilik tunggalnya (SPEC-146).
- **Amplop polos tanpa segmen.** Sesuai objective secara harfiah, dan berbohong tentang okupansi
  tepat pada pertanyaan yang mode ini ada untuk menjawabnya (keputusan 2).
- **Menyalin `team-timeline.tsx`.** Dilarang eksplisit oleh objective, dan alasannya berdiri
  sendiri: dua kanvas adalah dua kebenaran tentang geometri batang yang akan drift.
- **Berkas `team-projects.tsx` terpisah.** Design induk menetapkan `team-timeline.tsx` sebagai
  "kanvas Gantt — dipakai mode Linimasa DAN Lintas project"; menaruh pemakaian ulang di sebelah
  yang dipakainya membuat kontraknya sulit didrift.
- **Menempelkan mode ini ke `OverviewScreen`.** Dilarang objective, dan mode ketiga dari sebuah
  layar yang sudah punya dua tak bisa pindah rumah tanpa memutus `TEAM_VIEWS`.
- **Menyembunyikan project yang tak punya jadwal.** Barisnya bisa **dibuka** — di situlah operator
  melihat task mana yang belum bertanggal. Baris yang dihilangkan menyembunyikan pekerjaan yang ada
  (kelas yang sama dengan keputusan 3 & 7 ADR-0153).
- **Menggabungkan "belum dijadwalkan" dan "di luar jendela" menjadi satu keadaan.** Sebabnya
  berbeda dan penawarnya berbeda — yang satu butuh tanggal, yang lain butuh zoom.
