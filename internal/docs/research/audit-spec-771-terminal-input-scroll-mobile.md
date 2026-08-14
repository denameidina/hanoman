# Audit SPEC-771 — input terminal terputus dan scroll mobile jatuh ke halaman

**Sumber:** QA finding SPEC-771 (prioritas tinggi, severity major)  
**Lingkungan laporan:** dashboard lokal/browser desktop dan Android Chrome  
**Keputusan:** Spec dan Plan **skipped**. Tiga akar masalah berconfidence tinggi, punya reproduksi
otomatis pada jalur nyata, dan dapat diperbaiki lokal tanpa skema, migration, endpoint baru, atau
perubahan kontrak payload WebSocket. Dokumen ini menjadi doc-of-record Execute; ADR-0014, ADR-0016,
ADR-0080, ADR-0117, serta kontrak responsive SPEC-763 ditegakkan, bukan diamandemen.

## Ringkasan

Gejala A bukan satu masalah layout. Sejak hardening SPEC-761, route terminal memasang
`WsMessageGuard` generik dengan default **120 frame per 60 detik**. xterm memanggil `onData` untuk
input pengguna dan `TerminalPane` mengirim setiap panggilan sebagai satu frame. Pada frame ke-121,
server menutup koneksi dengan **1008 `rate limit`**; klien tidak menampilkan close state maupun
menyambung ulang, sehingga karakter berikutnya dibuang oleh pemeriksaan `readyState`. Celah kedua
ada sebelum socket terbuka: pengambilan tiket + upgrade menambah keadaan CONNECTING, tetapi
`send()` juga membuang semua input pada keadaan itu. Keduanya membuat pane terlihat seperti tak
merespons walaupun tmux dan node-pty sehat.

Gejala B berada di klien. `@xterm/xterm` 6.0.0 menggambar scrollbar internal lewat
`SmoothScrollableElement`, tetapi source paket terpasang tidak mendaftarkan pemilik gesture touch
pada viewport itu. `TerminalPane` juga tidak punya handler touch. Karena itu swipe vertikal tidak
pernah mencapai API scrollback xterm dan browser menyerahkannya ke scroller `<main>` di belakang.
API publik `Terminal.scrollLines(amount)` sudah tersedia dan menjadi seam yang tepat; tidak perlu
menyentuh internal xterm atau mengirim gesture ke tmux.

## Feedback loop merah

Perintah cepat frontend:

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest --run src/test/terminal-pane.test.tsx --no-file-parallelism
```

Hasil kode dasar: **2 gagal, 6 lulus**. Test CONNECTING menerima hanya frame resize, bukan
`{t:"in",d:"abc123"}`. Test swipe menerima `scrollLines` kosong dan `touchmove.defaultPrevented`
false. Keduanya deterministik dan selesai sekitar satu detik.

Perintah jalur WS nyata:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV -u DATABASE_URL \
  pnpm vitest --run server/test/terminal.route.test.ts -t "keeps accepting" --no-file-parallelism
```

Test membuka server Fastify dan tmux/node-pty sungguhan, mengirim 120 frame karakter lalu marker
pada frame ke-121. Hasil kode dasar dalam sekitar dua detik:

```text
marker: false
closed.code: 1008
closed.reason: rate limit
```

Ini menangkap gejala pengguna—input berhenti sampai ke sesi—bukan sekadar menguji helper quota.

## Temuan A1 — quota keamanan salah satuan untuk input interaktif

`server/src/routes/terminal.ts` membuat `new WsMessageGuard()` tanpa konfigurasi. Default
`perWindow` di `services/ws-admission.ts` adalah 120 per 60 detik. Nilai itu wajar untuk kanal
kontrol berfrekuensi rendah, tetapi bukan untuk keystroke: dua karakter per detik saja sudah
menghabiskan jendela, sedangkan key-repeat browser dapat mengirim puluhan event per detik.

`git blame` menempatkan guard dan close 1008 ini pada commit hardening SPEC-761 (`1699c2d6`).
Invariant keamanan SPEC-761 hanya menuntut **quota**, bukan angka 120 untuk semua jenis kanal.
Jadi perbaikannya adalah memberi terminal quota eksplisit yang masih bounded tetapi sesuai input
interaktif; guard generik dan test burst-denialnya tetap hidup untuk kanal lain.

Ada penguat latency: sebelum setiap frame terminal diproses, route memanggil
`revalidateWsPrincipal()`. Itu benar menurut ADR-0117 dan tidak boleh dicabut. Quota terminal yang
sesuai menghindari close salah tanpa melemahkan pemeriksaan principal, ukuran maksimum frame, atau
batas koneksi per principal.

## Temuan A2 — input CONNECTING dibuang tanpa antrean

`TerminalPane` membuat socket hanya sesudah `issueWsTicket()` selesai. Listener xterm sudah aktif,
namun `send()` berbentuk:

```ts
if (ws?.readyState === WebSocket.OPEN) ws.send(...)
```

Klik/fokus manual memungkinkan pengguna mengetik selama request tiket atau upgrade masih berjalan;
setiap karakter pada celah itu hilang permanen. SPEC-761 memperlebar celah dari konstruksi socket
langsung menjadi request HTTP lalu upgrade, tetapi tidak menambahkan antrean. Repro menyuntik
`abc` lalu `123` saat `readyState=CONNECTING`, membuka socket, dan membuktikan tidak ada satu pun
frame input yang dikirim.

Perbaikannya adalah satu buffer input berurutan yang hanya hidup selama koneksi awal, lalu dikuras
segera pada `onopen`. Resize tidak perlu diantre karena `onopen` selalu mengirim ukuran terbaru.

## Temuan B — tidak ada pemilik gesture vertikal di xterm 6

Source `@xterm/xterm` 6.0.0 yang terpasang menunjukkan `Viewport` membungkus layar dengan
`SmoothScrollableElement` dan menangani wheel/scroll position, tetapi tidak ada pemanggilan
`Gesture.addTarget`, `handleTouchStart`, atau `handleTouchMove` di browser viewport. Hanya deklarasi
tipe lama yang masih menyebut dua method touch. CSS `.xterm-viewport { overflow-y: scroll }` bukan
penolong karena viewport runtime baru bukan native scroller yang menerima gesture itu.

Di sisi hanoman, host `TerminalPane` hanya memasang keyboard, xterm `onData`, dan ResizeObserver.
Swipe karenanya bubble ke `.hn-shell-main`, satu-satunya page scroller menurut SPEC-763. Repro
men-dispatch `touchstart` lalu swipe turun 80 px pada host: tak ada panggilan `scrollLines`, dan
event tidak dibatalkan.

Perbaikannya adalah handler satu-jari `touchstart`/`touchmove` passive-false pada host, mengubah
delta piksel menjadi baris dari tinggi host/jumlah row terminal, meneruskan sisa pecahan antar-event,
dan memanggil API publik `term.scrollLines(lines)`. Gesture vertikal yang sah dimiliki pane
(`preventDefault` + containment); multi-touch tetap dibiarkan untuk pinch-zoom.

## Hipotesis yang terbantah

- **Render output me-remount xterm.** Effect `TerminalPane` hanya bergantung pada `sessionId`;
  callback exit/fase disalurkan lewat ref. Frame output memanggil `term.write` tanpa mengganti
  listener input.
- **node-pty/tmux membuang stdin.** Test route yang sudah ada meneruskan stdin ke proses hidup dan
  replay scrollback ke klien kedua. Repro baru gagal sebelum marker mencapai route write, tepat pada
  close policy 1008.
- **Layout responsive saja.** SPEC-767 sudah memperbaiki pemilihan pane dan tinggi root. Dalam
  SPEC-771 pane aktif terlihat; yang hilang adalah kepemilikan gesture di dalamnya.

## Scope Execute dan bukti penerimaan

1. Terminal punya quota pesan eksplisit yang masih bounded dan menerima burst input normal di atas
   120 frame tanpa mengubah cap byte, quota koneksi, tiket, Origin, atau revalidation.
2. Input selama CONNECTING ditahan berurutan dan dikirim segera sesudah socket OPEN.
3. Swipe satu-jari di host terminal memanggil `Terminal.scrollLines` dengan arah benar dan tidak
   menggulir halaman; handler dilepas saat pane dispose.
4. Test frontend dan route merah di atas menjadi hijau; test guard burst generik tetap hijau.
5. Verifikasi hanya paket/test terminal yang tersentuh. Karena perilaku route WS berubah, lakukan
   satu smoke runtime lokal di akhir; suite penuh tetap tugas manusia sebelum merge.
