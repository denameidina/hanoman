# ADR-0161 — Gerbang peluncuran sesi berdiri di jalur bersama, dan host punya hak menolak

- Status: Accepted
- Tanggal: 2026-09-05
- SPEC: SPEC-1108 (QA · critical) — temuan pendamping SPEC-1109 (worktree yatim)
- Terkait: **mengamandemen [0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md)** (invarian cap
  poin 3 dinyatakan ulang: yang dibatasi adalah sesi **agen**, dan gerbangnya pindah dari governor ke
  jalur bersama poin 6); menegakkan [0015](0015-one-session-per-backlog.md) (satu backlog satu sesi),
  [0016](0016-sesi-terminal-hidup-di-tmux.md) (tmux satu-satunya sumber kebenaran soal sesi),
  [0093](0093-dependency-antar-backlog.md) (pola `force` milik jalur manusia),
  [0084](0084-melanjutkan-sesi-backlog.md) (pane hidup = re-attach, bukan peluncuran baru).

## Konteks

ADR-0072 poin 3 menuliskan sebuah invarian: *"Governor menghitung sesi hidup **gabungan manual +
scheduler** dari `pty.listSessions()` … **Invarian: sesi hidup tak pernah melebihi cap.**"* Poin 6
dari ADR yang sama menyeragamkan jalur peluncuran ke `startSpecSession()` justru dengan alasan
"dipakai POST manual & governor".

Kedua poin itu tak pernah bertemu di kode. Aritmetika cap hanya ada di satu tempat —
`scheduler/governor.ts:105` (`let slots = cfg.maxConcurrent - deps.liveCount()`), di dalam `drain()`.
`session-launch.ts` (228 baris) dan `routes/terminal.ts` **nol rujukan** ke `maxConcurrent`,
`liveCount`, atau `slots`. Invarian itu karena itu hanya ditegakkan pada satu dari dua pemanggil, dan
pemanggil yang tak digerbangi justru yang dipakai manusia.

Di instance operator akibatnya total. Semua source scheduler MATI (`backlog:false`, `triase:false`),
jadi `drain()` praktis tak pernah meluncurkan apa pun — dan `maxConcurrent: 6` yang tampil serta bisa
diatur di Settings tidak ditegakkan oleh apa pun. Knob mati. Terbukti: SPEC-1100…1104 tak punya satu
pun baris `SchedulerQueueItem`; kesembilan sesi hidup lahir dari `POST /terminal/sessions`.

Cap juga menghitung satuan yang salah. Biaya nyata bukan pada sesinya melainkan pada anak yang
dilahirkannya: satu `tsc --noEmit` terukur **470 MB / 149% CPU**, `claude` sendiri 100–280 MB. Enam
sesi wajar di mesin 32 GB dan fatal di 8 GB, tetapi angka cap tak tahu bedanya. Di host operator
(Mac mini M2, 8 GB, 8 core) sembilan sesi hidup menghasilkan load average **30** (3,75 per core),
swap **3,25 dari 4 GB**, **129 GB swap-in dalam 54 menit**, dan jetsam (OOM killer macOS) **4× dalam
sepekan**. Puncaknya dua kernel panic bertanda tangan identik — `userspace watchdog timeout: no
successful checkins from WindowServer in ~127 seconds`, `thermalPressureLevel: Nominal` (jadi bukan
panas) — pada 2026-08-30 10:39 dan 2026-09-05 10:12. `SessionHistory` mengikat keduanya ke beban
agen: masing-masing terjadi saat batch 4–5 sesi SPEC hidup ~3 jam, dan barisnya ditutup
`endedReason='reconciled'` berstempel tepat sesudah reboot (10:40:12 dan 10:29:27).

hanoman tidak punya penjaga sumber daya sama sekali: `freemem|totalmem|loadavg|os.cpus|memoryUsage`
nol hasil di seluruh `server/src` (satu-satunya `loadavg` ada di `vps-audit.ts`, untuk VPS remote).

## Keputusan

### 1. Gerbang cap berdiri di `startSpecSession()`, bukan di governor

Jalur bersama ADR-0072 poin 6 adalah satu-satunya tempat yang dilewati SEMUA peluncuran — POST
manual, governor scheduler, dan denyut lead. Gerbang ditaruh di sana. Governor tetap menghitung
`slots` untuk membatasi berapa item yang ia proses per drain, tetapi itu kini optimasi batching,
bukan lagi satu-satunya penegak: kebenaran cap punya satu rumah.

Urutan gerbang di dalam `startSpecSession()` **tidak digeser**. Cek pane hidup tetap paling depan —
re-attach ke sesi yang sedang berjalan (ADR-0015/0084) bukan peluncuran dan tak boleh ikut ditolak,
karena menolaknya justru menyembunyikan pekerjaan yang paling perlu dilihat operator. Gerbang baru
berdiri **sesudah** cek pane hidup dan **sebelum** `killSession`/worktree, bersama gerbang dependency
(ADR-0093), supaya penolakan tak meninggalkan efek samping.

### 2. Yang dibatasi adalah sesi AGEN — `terminal`/`shell` di luar cap

Amandemen atas invarian ADR-0072 poin 3, yang berbunyi "sesi hidup" tanpa membedakan jenis. Dinyatakan
ulang: **sesi agen hidup tak pernah melebihi cap.**

`listPanes()` menghitung semua pane, jadi terminal ikut terhitung di `liveCount()` — dan itu
dipertahankan, karena beban host memang nyata. Yang berubah: terminal/shell tidak pernah **ditolak**.
Alasannya operasional, bukan estetis. Terminal adalah satu-satunya jendela operator ke sesi yang
sedang bermasalah; menolaknya persis saat cap penuh berarti mencabut alat diagnosis tepat pada saat
ia paling dibutuhkan. Biayanya juga beda orde — pane shell kosong berbanding sesi `claude` + `tsc`.

### 3. Host berhak menolak: gerbang sumber daya berbasis load-per-core

Cap menghitung sesi; gerbang kedua menghitung mesin. Sebelum spawn, `startSpecSession()` membaca
`os.loadavg()[0] / os.cpus().length` dan menolak bila melampaui ambang.

Metriknya dipilih dengan pengukuran, bukan selera — lihat "Alternatif yang ditolak" untuk kenapa
`os.freemem()` haram di sini. Load-per-core memisahkan kedua keadaan dengan bersih di host yang sama:
**3,75/core** saat sembilan sesi menuju panic, **1,66/core** saat mesin itu sehat mengerjakan
beberapa sesi. Ia juga portabel di macOS dan Linux tanpa memanggil apa pun di luar Node.

Di Windows `os.loadavg()` mengembalikan `[0,0,0]`. Nol bukan "mesin senggang" melainkan "tak ada
kabar", jadi platform yang tak memasok angka membuat gerbang ini **tak berpendapat** — ia meluluskan,
dan tak pernah menolak berdasarkan data yang tak ada.

### 4. Ditolak, bukan diantrekan

Peluncuran yang kena gerbang menjawab `409` beserta **angkanya**: sesi agen hidup, cap, load-per-core,
dan ambang yang dilanggar. Bukan penolakan buram.

Sengaja tidak dibuat antrean untuk peluncuran manual. Antrean durable sudah ada
(`SchedulerQueueItem`, ADR-0072) dan menduplikasinya untuk jalur manusia berarti dua antrean dengan
dua kebijakan pembatalan. Peluncuran manual menurut definisi punya manusia di depannya: ia bisa
menunggu, atau memutuskan sebaliknya lewat `force`.

### 5. `force` menembus kedua gerbang; otomasi tak pernah memaksa

Mengikuti pola ADR-0093 apa adanya: `force` hanya dipasok jalur manusia (`POST /terminal/sessions`),
dan governor maupun denyut lead **tak pernah** mengirimkannya. Prinsip produk "manusia terakhir yang
memutuskan" menuntut operator tetap bisa meluncurkan sesudah membaca angkanya. Yang tak boleh adalah
otomasi menabrak pagar yang sama tanpa manusia melihat.

### 6. Semua ambang di `Setting`, default aman

Mengikuti ADR-0072 poin 5. `maxConcurrent` yang sudah ada tetap sumber cap; ambang load ditambahkan
sebagai knob dengan default yang menyala. Gerbang harus bisa dimatikan operator, dan mematikannya
adalah keputusan sadar yang tercatat, bukan efek samping konfigurasi kosong.

### 7. Jalur asinkron saja

Gerbang membaca sesi hidup lewat `listSessionsAsync()`/`listPanesAsync()`. `pty.ts:434` sudah mencatat
bahwa `listPanes()` memakai `execFileSync` dan memblokir event loop sampai **916 ms** saat mesin sibuk
(terukur SPEC-878). Menambahkan pembacaan sinkron ke jalur peluncuran berarti memasang penyebab lag
baru tepat di dalam penawar lag.

## Alternatif yang ditolak

**`os.freemem()` sebagai ambang memori.** Ditolak dengan pengukuran. Pada host yang sama, saat kernel
melaporkan **57% memori bebas**, swap turun ke 1,47 GB, dan mesin bekerja normal, `os.freemem()`
menjawab **146 MB**. Di macOS ia hanya menghitung halaman yang benar-benar bebas dan mengabaikan
purgeable serta compressor — angkanya kecil secara struktural, bukan karena mesin sesak. Gerbang yang
dipatok padanya akan menolak peluncuran selamanya di mesin yang sehat. Kesalahan ini tak akan
ketahuan lewat unit test; ia hanya muncul di host nyata, jadi ia dicatat di sini supaya tak lahir
kembali.

**Menaruh gerbang di route `POST /terminal/sessions`.** Ditolak: itu persis kesalahan yang jadi akar
temuan ini — kebijakan yang hidup di satu pemanggil dan tidak di pemanggil lain. Setiap pemanggil
baru kelak (MCP, Telegram, lead) akan melewatinya lagi.

**Membiarkan governor tetap satu-satunya penegak dan hanya menaikkan disiplin operator.** Ditolak:
knob yang tak menegakkan apa pun lebih buruk daripada tak ada knob, karena ia menjanjikan pagar yang
tidak ada. Operator membaca `maxConcurrent: 6` dan menyimpulkan ada yang menjaganya.

**Menghitung biaya sesungguhnya (RSS anak sesi) alih-alih jumlah sesi.** Ditolak untuk sekarang:
menghitung pohon proses tiap peluncuran menuntut hanoman menelusuri anak tmux lintas platform, dan
biaya sesi baru justru belum ada saat gerbang dievaluasi. Load-per-core menangkap akibat kolektifnya
tanpa memodelkan sebabnya.

## Konsekuensi

- **Positif:** invarian ADR-0072 akhirnya punya penegak tunggal; knob `maxConcurrent` menjadi nyata;
  host tak lagi bisa didorong ke kernel panic oleh peluncuran yang tak terhitung; penolakan membawa
  angka sehingga operator tahu apa yang ditunggunya.
- **Negatif:** peluncuran kini bisa gagal karena keadaan mesin, dan itu jenis kegagalan yang tak
  deterministik — dua percobaan identik bisa berbeda hasil. Itu harga yang disengaja; alternatifnya
  adalah kegagalan yang jauh lebih mahal, yaitu host tumbang membawa semua sesi.
- **Negatif:** ambang load bergantung platform. Nilai yang benar di Mac mini 8 GB bukan nilai yang
  benar di VPS 16 core; ambangnya knob, bukan konstanta.
- Gerbang ini **tidak** menyembuhkan sesi yang sudah terlanjur jalan. Ia mencegah yang ke-N lahir,
  bukan menghentikan yang ke-1..N-1.

## Amandemen implementasi SPEC-1108 (2026-09-05, disetujui operator)

Audit kode menemukan bahwa cron, workflow project, agen konflik, hardening VPS, dan gateway
Telegram tidak melewati `startSpecSession()`. Cakupan diperluas atas persetujuan operator:
semua agen terstruktur memakai satu kebijakan `session-admission`, melalui wrapper launcher
asinkron; `startSpecSession()` tetap pintu bersama backlog manual, scheduler, dan lead.
Tidak ada aritmetika gerbang di route. Terminal biasa (termasuk TUI agen tanpa pekerjaan
terstruktur), shell, dan konsol SSH VPS tetap bebas penolakan dan tetap dihitung dalam cap.

Check→spawn diserialkan dalam satu proses server; kelahiran terminal yang dikecualikan
juga memakai mutex yang sama tanpa check cap/load. Ini mutex peluncuran sementara, bukan
antrean kerja manual kedua; tidak ada item durable, retry otomatis manual, atau registry
sesi DB. Re-attach diperiksa sebelum gerbang, dan pembacaan tmux gagal tidak dianggap nol.
Metadata `launchClass` agent/terminal disimpan di pane tmux saat lahir untuk angka penolakan;
pane lama diklasifikasi dari spec/flow/cwd/project yang sudah tersedia. Cap selalu memakai
semua pane hidup, sehingga klasifikasi lama tidak dapat melonggarkan cap.

`Setting.scheduler.launchGuard = { enabled: true, maxLoadPerCore: 2.5 }`. Default 2,5
disetujui sebagai nilai awal: sekitar 51% di atas titik sehat 1,66 dan 33% di bawah
titik 3,75 menuju panic; belum terkalibrasi lintas host. `enabled` mematikan kedua
gerbang baru secara eksplisit; batching governor tetap memakai `maxConcurrent`. Scheduler
atau source mati tidak mematikan gerbang. Load ditolak hanya bila **lebih besar** dari ambang.

Penolakan 409 membawa `kind: capacity|host-load` dan `admission` berisi `enabled`,
`liveCount` (semua pane hidup), `liveAgentCount` (agen terstruktur), `maxConcurrent`,
`loadPerCore`, `maxLoadPerCore`, `loadStatus: available|unsupported|unavailable`. Windows
memakai null + unsupported; data invalid memakai null + unavailable, sehingga tidak
terlihat aktif dengan angka nol. Status yang sama tersedia di state scheduler.
`force` milik tindakan manusia; Bearer AgentToken yang mengirim force:true ditolak 403
sebelum lookup/approval/spawn. Otomasi tidak memasoknya. Penolakan sementara pada
governor menahan item di antrean yang sudah ada beserta alasannya, bukan menutup failed.

Untuk konflik, operasi Git yang diminta manusia sudah terjadi sebelum diketahui bahwa
agen pemulih dibutuhkan. Gerbang menolak **spawn agen**, mempertahankan worktree konflik
untuk pemulihan manual, dan tidak mencoba membatalkan Git atau menghapus kerja operator.
Gerbang backlog/project/cron tetap berdiri sebelum kill/worktree.

## Yang TIDAK diputuskan di sini

- **Kalibrasi lintas host.** Default awal 2,5 ditetapkan amandemen di atas; pengukuran
  lebih luas tetap diperlukan untuk mengevaluasinya.
- **Apakah sesi yang sedang berjalan boleh dihentikan otomatis saat host sesak.** Itu mencabut kerja
  yang sedang berlangsung dan menabrak "manusia terakhir yang memutuskan" jauh lebih keras daripada
  menolak peluncuran. Perlu ADR sendiri bila kelak dibutuhkan.
- **Pemungutan worktree yatim** — ranah SPEC-1109 dan ADR-nya sendiri.

## Gotcha wajib

- `os.loadavg()` di Windows adalah `[0,0,0]`. Perlakukan sebagai "tak berpendapat", jangan sebagai
  "senggang" — kalau tidak, gerbang mati diam-diam di satu platform sambil terlihat aktif.
- Load average adalah rata-rata bergerak, jadi ia **tertinggal** dari kenyataan. Lima sesi yang
  diluncurkan dalam sepuluh detik semuanya akan melihat load lama dan semuanya lolos. Cap sesi
  (keputusan 1) yang menutup celah itu; kedua gerbang saling menutup lubang masing-masing dan tak
  boleh dianggap redundan.
- `liveCount()` menghitung pane, dan pane MATI yang ditahan `remain-on-exit on` bukan sesi (ADR-0084).
  Menghitungnya sebagai sesi hidup akan membuat cap menyempit sendiri seiring waktu.
