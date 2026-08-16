# Audit SPEC-812 — mengetik di sesi terminal terasa tertahan dari mobile lewat domain

**Sumber:** QA finding SPEC-812 (prioritas tinggi, severity major)
**Lingkungan laporan:** HP/tablet lewat domain publik (Cloudflare Tunnel) → hanoman lokal (Mac mini);
di desktop/localhost delay tak terasa
**Keputusan:** Spec dan Plan **skipped**. Satu akar berconfidence tinggi, terukur, dan perbaikannya
lokal — tanpa skema, migration, endpoint baru, perubahan payload WebSocket, maupun perubahan
frontend. Dokumen ini menjadi doc-of-record Execute. ADR-0014, ADR-0016, ADR-0117 dan quota WS
SPEC-771 **ditegakkan**, bukan diamandemen.

## Ringkasan

Jembatan terminal mengirim **satu frame WebSocket per chunk `node-pty`, tanpa kompresi**. Chunk
node-pty berukuran tetap **1024 byte**, jadi sesi yang sedang ramai keluaran memancarkan **±128
frame/detik ≈ 966 kbit/detik** per pane — untuk aliran yang terukur **26× kompresibel**. Di
localhost angka itu tak terasa; lewat Cloudflare Tunnel ke ponsel ia adalah aliran satu arah yang
terus-menerus mengisi antrean kirim. Echo ketikan lahir di **belakang antrean itu**, sehingga
delay-nya tumbuh mengikuti kedalaman antrean — persis bentuk keluhan "makin parah saat sesi sedang
ramai keluaran".

Hipotesis "klien lambat merender" **diuji dan ditolak** (lihat kontrol negatif di bawah): xterm
tak pernah tertinggal, bahkan pada CPU throttle 6×.

## Feedback loop merah

Probe sekali pakai di scratchpad (tanpa dependensi baru): satu sesi tmux berisi TUI redraw penuh
40×100 pada 20 fps — bentuk keluaran yang sama dengan TUI agen — di-attach lewat `node-pty` persis
seperti `open()` di `server/src/services/pty.ts`, lalu chunk-nya direkam beserta jeda antar-chunk
dan diputar ulang di dua tempat: (a) zlib `deflateRaw` ber-`Z_SYNC_FLUSH` per pesan — cara kerja
`permessage-deflate` dengan context takeover, dan (b) `@xterm/xterm` 6.0.0 asli di Chrome headless
lewat CDP dengan `Emulation.setCPUThrottlingRate`.

## Temuan 1 — satu frame WS per chunk 1 KB: 128 frame/detik

`pty.ts:687` memancarkan satu frame per `onData`:

```ts
pty.onData((d) => {
  a.scrollback = (a.scrollback + d).slice(-MAX_SCROLLBACK);
  broadcast(a, { t: "data", d });
});
```

`node-pty` membaca dengan buffer tetap, jadi keluaran deras selalu tiba sebagai chunk **1024 byte**.
Terukur pada 10 detik aliran:

| | nilai |
| --- | --- |
| chunk | 1 178–1 283 (**±128/detik**) |
| ukuran chunk p50 / p90 / max | 1 024 / 1 024 / 1 026 byte |
| byte mentah | 1 012 KB |
| byte sesudah dibungkus JSON | 1 208 KB (**+19,4 %**) |
| laju kawat | **966 kbit/detik per pane** |

Inflasi 19,4 % berasal dari `JSON.stringify`: byte ESC ditulis sebagai escape enam karakter
dan keluaran TUI agen ESC-berat.

Halaman Terminal merender **grid** pane, masing-masing dengan socket sendiri; empat pane ramai =
±3,9 Mbit/detik satu arah yang harus keluar lewat jalur upload Mac mini → edge Cloudflare → ponsel.

## Temuan 2 — kompresi mati padahal alirannya 26× kompresibel

`app.ts:106` mendaftarkan `@fastify/websocket` hanya dengan `maxPayload`; default `ws` untuk
`perMessageDeflate` adalah **mati**. Cloudflare Tunnel meneruskan frame WebSocket apa adanya dan
tak mengompresi apa pun, jadi tak ada lapis lain yang menutupi ini.

Aliran yang sama, `deflateRaw` + `Z_SYNC_FLUSH` per pesan (context takeover, seperti `ws`):

| konfigurasi | frame/10 dtk | kawat | laju | rasio | CPU/10 dtk |
| --- | --- | --- | --- | --- | --- |
| hari ini (1 KB, tanpa kompresi) | 1 283 | 1 183 KB | **966 kbit/dtk** | 1× | 0 |
| deflate level 1, frame apa adanya | 1 283 | 82,5 KB | 68 kbit/dtk | 14,3× | 32 ms |
| coalesce 16 ms + deflate level 1 | 202 | 58,3 KB | 48 kbit/dtk | 19,9× | 10 ms |
| **coalesce 16 ms + deflate level 6** | **202** | **43,9 KB** | **36 kbit/dtk** | **26,5×** | **15 ms** |
| coalesce 33 ms + deflate level 6 | 198 | 43,8 KB | 36 kbit/dtk | 26,6× | 14 ms |

Jendela 33 ms tak membeli apa pun di atas 16 ms, sedangkan 16 ms adalah satu frame animasi — batas
atas tambahan latensi untuk ketikan tunggal saat sesi diam, jauh di bawah RTT jalur tunnel itu
sendiri. `memLevel` 7 dan 8 memberi rasio identik (43,9 KB), jadi 7 dipilih: memori deflate per
koneksi separuh, sesuai anjuran `ws` soal fragmentasi memori.

**Burst attach/reconnect ikut terselesaikan.** `attach()` memutar ulang seluruh scrollback:
**306 KB dalam satu frame tanpa kompresi**, ter-deflate menjadi **15,4 KB** (20×). Di jaringan
mobile yang putus-nyambung, backoff SPEC-800 membuat burst itu berulang.

## Temuan 3 — trim scrollback O(n) per chunk

`(a.scrollback + d).slice(-MAX_SCROLLBACK)` menghasilkan cons-string lalu **meratakannya**:
sesudah scrollback penuh (256 KiB), setiap chunk 1 KB membayar salinan ±512 KB. Terukur
**178 µs per chunk**, yakni **210 ms CPU per 10 detik per pane** (2,1 % satu core) — biaya yang
tumbuh persis saat keluaran deras, yaitu saat event loop paling dibutuhkan untuk melayani frame.
Bukan penyebab utama keluhan, tetapi berada di baris yang sama dengan perbaikannya.

## Kontrol negatif — klien BUKAN penyebabnya

Aliran yang sama diputar ulang ke `@xterm/xterm` 6.0.0 asli (100×40) di Chrome headless, dengan
jaringan dianggap sempurna supaya yang terukur murni ongkos klien: `JSON.parse` + `Terminal.write`.
Metriknya jarak dari satu "keystroke" masuk ke `Terminal.write` sampai callback parse-nya menyala —
yaitu kedalaman antrean `WriteBuffer` xterm:

| CPU throttle | frame apa adanya | coalesce 50 ms |
| --- | --- | --- |
| 1× | echo 0 ms, lag drain 0 ms | 0 ms / 0 ms |
| 4× | 0 ms / 0 ms | 1 ms / 0 ms |
| 6× | **0 ms** / 0 ms | 1 ms / 0 ms |

xterm menguras 1,2 MB dalam 10 detik tanpa tertinggal bahkan pada throttle 6×, dan renderer-nya
menggambar keadaan terakhir per rAF (tak mengantre). Jadi "ponsel lambat merender" bukan
mekanismenya; yang membedakan mobile dari desktop adalah **jalur jaringannya**, bukan CPU-nya.

## Yang sengaja TIDAK dikerjakan

- **Flow control ber-ACK** (klien meng-ACK byte, server menahan kiriman). Ia obat untuk antrean yang
  tumbuh tanpa batas, tetapi menuntut tipe frame baru di payload WS. Dengan laju turun 26× menjadi
  36 kbit/detik, laju tawaran berada di bawah kapasitas jalur mobile mana pun yang masuk akal, jadi
  mekanisme tumbuhnya antrean hilang di akarnya. Ini lever cadangan bila pengukuran di perangkat
  nyata membuktikan sisa delay.
- **Renderer WebGL/Canvas xterm.** Kontrol negatif di atas menunjukkan tak ada yang perlu dibeli di
  sana; menambah addon berarti dependensi baru plus penanganan context-loss tanpa dasar ukur.
- **Menurunkan `MAX_SCROLLBACK`.** Burst attach sudah 20× lebih kecil oleh kompresi, dan memotong
  scrollback menukar latensi dengan riwayat yang hilang saat sambung ulang.

## Ketergantungan yang harus dikonfirmasi di perangkat nyata

`permessage-deflate` dinegosiasikan **ujung ke ujung** antara browser dan server asal; Cloudflare
Tunnel meneruskan handshake-nya. Bila di jalur itu ekstensi ternyata tak ikut ternegosiasi,
coalescing tetap berdiri sendiri (frame 128/detik → 20/detik) dan lever cadangan di atas yang
dipakai. Konfirmasinya satu tatapan di DevTools ponsel: response handshake memuat
`Sec-WebSocket-Extensions: permessage-deflate`.

## Perbaikan

1. `server/src/app.ts` — nyalakan `perMessageDeflate` pada opsi `ws` (level 6, `memLevel` 7,
   `threshold` bawaan 1 KiB sehingga frame kecil tak membayar kompresi).
2. `server/src/services/pty.ts` — kumpulkan keluaran PTY dalam jendela **16 ms** (atau saat mencapai
   plafon byte) lalu siarkan sebagai satu frame `data`; kuras antrean sebelum frame `exit`, sebelum
   klien baru menerima scrollback, dan saat attachment dilepas, supaya urutan byte tak pernah
   berubah.
3. `server/src/services/pty.ts` — amortisasi trim scrollback: potong hanya saat melewati
   `MAX_SCROLLBACK + slack`, bukan tiap chunk.

## Hasil terukur sesudah perbaikan

Smoke di server Fastify hidup + tmux + node-pty nyata (bukan replay), aliran yang sama, satu-satunya
variabel apakah klien menegosiasikan `permessage-deflate`; yang dihitung **byte TCP yang benar-benar
diterima socket klien** (`_socket.bytesRead`), bukan panjang payload:

| | frame/dtk | payload | byte di kawat | laju |
| --- | --- | --- | --- | --- |
| kompresi ditolak klien | 14 | 783,7 KB | 1 464,2 KB | 2 666 kbit/dtk |
| **kompresi dinegosiasikan** | **16** | **812,6 KB** | **24,1 KB** | **44 kbit/dtk** |

**60,6× lebih sedikit byte** untuk aliran yang sama — lebih baik dari perkiraan 26,5× karena
coalescing menghasilkan frame 11,5 KB yang jauh lebih kompresibel daripada chunk 1 KB. Frame per
detik terukur **16**, bukan ±128.

Test yang mengunci: `server/test/pty.test.ts` (frame `data` terbesar > 4 KiB — mustahil tanpa
coalescing karena tak ada chunk node-pty yang melewati ±1026 byte; batas & ekor `trimScrollback`)
dan `server/test/terminal.route.test.ts` (handshake menegosiasikan `permessage-deflate`).
