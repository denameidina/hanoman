# Audit SPEC-767 — terminal mobile tidak tampil dan sesi tidak terbuka

## Putusan

Temuan berconfidence tinggi dan perbaikannya lokal di frontend. **Spec dan Plan dilewati**; dokumen
ini menjadi doc-of-record untuk Execute. Tidak ada perubahan skema, endpoint, payload WebSocket,
atau keputusan arsitektur baru: perbaikan menegakkan kontrak responsive SPEC-763 dan perilaku
"Buka sesi" SPEC-341 yang sudah menjadi Source of Truth.

## Laporan dan batas bukti

Telegram update 176005167 melaporkan bahwa UI Terminal pada mobile tidak tampil/kurang responsif
dan terminal tidak membuka session. Laporan tidak menyertakan browser, ukuran viewport, project,
atau session ID. SPEC-767 dibuat sesudah SPEC-763 masuk ke rilis v0.1.32, sehingga masalah ini
bukan laporan terhadap implementasi mobile yang lebih lama.

Audit memakai kode pada commit dasar `5fc6533f`, test komponen yang sudah ada, baris backlog dan
sesi hidup, serta pesan Telegram asli. Browser visual lokal tidak tersedia pada runtime agen, jadi
audit tidak mengklaim pengukuran pixel lintas-browser. Baseline terarah tetap hijau: 64/64 test pada
`terminal-screen.test.tsx`, `terminal-pane.test.tsx`, dan `app-flows.test.tsx`.

## Temuan 1 — target sesi dibuang saat navigasi

`TerminalScreen` sudah menerima `focusSession`, menempatkan sesi itu ke cell kosong, memilih group
dan cell yang memuatnya, lalu pada mobile menampilkan cell tersebut. Jalur ini sudah dijaga test.
Namun beberapa pintu yang mengetahui ID sesi hanya memanggil `setSection("terminal")`:

- aksi Backlog **Buka sesi** menerima `Spec`, tetapi callback di `App` membuang spec itu;
- hasil pembukaan sesi scaffold/reverse/PRD/breakdown dan hasil konflik integrasi membawa ID sesi,
  tetapi ID tidak diteruskan ke `focusSession`;
- VPS menerima `{id}` dari pembukaan sesi/console dan Scheduler sudah merender `session.id`, tetapi
  kedua layar hanya memanggil callback navigasi tanpa argumen.

Kontrol negatifnya adalah IDE dan hanoman-lead: keduanya sudah meneruskan ID ke `focusSession` dan
baru kemudian membuka Terminal. Jadi PTY/WebSocket bukan akar pertama; transisi UI kehilangan
identitas target sebelum `TerminalScreen` sempat memilih pane. Pada mobile, hanya satu cell tampil,
sehingga kehilangan target ini terlihat sebagai sesi "tidak terbuka" walau sesi ada di tray atau
cell lain.

## Temuan 2 — tinggi tetap dapat mengolapskan pane mobile

Root Terminal normal memakai `height: calc(100dvh - 180px)`. Angka 180 mengasumsikan chrome
desktop tetap, sementara kontrak SPEC-763 membuat topbar dan toolbar Terminal membungkus pada
viewport sempit. Saat viewport dinamis memendek—terutama landscape atau keyboard virtual—tinggi
root terus mengecil walau chrome di dalamnya justru bertambah tinggi. Grid yang `flex: 1` akhirnya
dapat menerima tinggi nol; panel tetap mounted tetapi tak terlihat.

Ini berbeda dari mekanisme panel tersembunyi SPEC-763 yang memang sengaja berukuran 0×0. Guard
`TerminalPane` terhadap 0×0 sudah benar untuk cell nonaktif. Yang salah adalah container aktif
kehilangan ruang karena batas viewport arbitrer. Root harus mengikuti rantai flex Shell dan punya
basis minimum; bila viewport lebih pendek, `<main>`—page scroller yang ditetapkan kontrak
responsive—yang menggulir, bukan pane aktif yang dikolapskan.

## Scope Execute dan bukti penerimaan

1. Sediakan satu pintu navigasi Terminal di `App` yang menerima ID opsional, menyetel
   `focusSession`, lalu berpindah section. Semua alur yang baru membuat atau sudah mengetahui sesi
   wajib meneruskan ID itu; navigasi Terminal generik tetap boleh tanpa target.
2. Ubah root Terminal normal dari pengurangan `100dvh` tetap menjadi item flex yang mengisi Shell
   dengan basis minimum, sehingga viewport pendek menggulir di `<main>` dan grid aktif tetap punya
   ruang.
3. Tambahkan test regresi yang gagal pada kode dasar: aksi Backlog **Buka sesi** benar-benar
   merender sesi target, VPS/Scheduler meneruskan ID, dan root Terminal tidak lagi memakai tinggi
   viewport tetap.
4. Verifikasi hanya test frontend terkait dan typecheck paket `src`; endpoint dan protokol runtime
   tidak berubah sehingga boot server/curl tidak diperlukan.
