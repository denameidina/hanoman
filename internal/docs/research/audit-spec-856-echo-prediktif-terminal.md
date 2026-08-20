# Audit SPEC-856 — ketikan di sesi terminal terasa tertahan lewat domain publik (arah MASUK)

**Sumber:** backlog SPEC-856 (brief, prioritas tinggi)
**Pendahulu:** SPEC-812 menyelesaikan arah **KELUAR** (coalesce 16 ms + `perMessageDeflate`;
1 464 KB → 24,1 KB di kawat) dan menyebut arah masuk sebagai lever berikutnya. Dokumen ini lever itu.
**Keputusan:** tanpa ADR. Tak ada tipe frame WS baru, kolom, endpoint, maupun satu baris pun
perubahan di `server/**` — kontrak `t:"in"` / `t:"data"` yang diukur SPEC-812 **ditegakkan**.
ADR-0014, ADR-0016, ADR-0115, ADR-0117, ADR-0118 ditegakkan.

## Ringkasan

Sebelum SPEC-856 sebuah huruf baru tampil setelah round-trip penuh klien → server → tmux → pty →
flush coalesce → klien. Terukur lewat jalur nyata pada RTT 200 ms: **242 ms dari keydown sampai
glyph** di TUI claude. Sesudahnya **2,7 ms** — huruf digambar lokal lebih dulu lalu direkonsiliasi.

Brief menduga akarnya bisa dibantu coalescing input. Ukuran membantahnya dan sekaligus
memperbaiki premisnya dua kali:

1. **Coalescing input sendirian tak memperbaiki rasa tertahan** — ia menunda byte, bukan
   mempercepat glyph. Terbukti: pada kecepatan ketik manusia jendela 16 ms **tak menggabungkan
   apa pun** (10 tekan → 10 frame).
2. **Tetapi coalescing membeli arah KELUAR, bukan arah masuk** — TUI agen menggambar ulang sekali
   per *event input*, bukan per karakter, jadi menggabungkan burst memangkas byte balik sampai 11×.
   Ini tak diantisipasi brief.

Brief juga menyuruh **mematikan** prediksi di "dialog/TUI agen yang menggambar ulang layar penuh
(claude/codex)". Ukuran menunjukkan di sanalah prediksi paling aman **dan** paling berharga.
Gerbangnya karena itu **perilaku terukur, bukan nama program** (keputusan operator).

## Feedback loop merah

Probe sekali pakai di scratchpad, tanpa dependensi baru, meniru `open()` di
`server/src/services/pty.ts` apa adanya (socket tmux terpisah, opsi global identik: `remain-on-exit`,
`status off`, `prefix None`, `mouse on`, `history-limit 50000`, `default-terminal screen-256color`),
lalu `node-pty` attach 100×30. Tiga lapis:

1. **Probe echo** — kirim satu keystroke, rekam setiap chunk `onData` beserta jedanya.
2. **Probe coalesce** — kirim N keystroke berjeda vs satu frame berisi N karakter, bandingkan byte balik.
3. **Harness ujung-ke-ujung** — Fastify + `@fastify/websocket` (perMessageDeflate level 6 memLevel 7,
   coalesce keluar 16 ms / 64 KiB) menjembatani WS ke tmux nyata, menyajikan halaman berisi
   **`@xterm/xterm` 6.0.0 asli** dan **modul `terminal-predict.ts` asli** (di-bundle esbuild),
   dirangkai persis seperti `TerminalPane`. Disetir Chrome 151 headless lewat CDP.
   Satu-satunya variabel: `?predict=0|1`.

**RTT disuntik di jembatan, bukan di Chrome.** `Network.emulateNetworkConditions` tidak menyentuh
frame WebSocket yang sudah terhubung, jadi menahan frame di jembatan adalah satu-satunya penundaan
yang benar-benar terukur.

## Temuan 1 — satu keystroke ≠ satu byte echo

| skenario | balasan pty untuk SATU keystroke |
| --- | --- |
| `bash --noprofile --norc` | **1 byte** |
| TUI claude v2.1.237 (100×30) | **1 540 byte** — repaint layar penuh, 2 chunk, tiba 9–14 ms |
| `read -s -p PASS:` | **0 byte** |
| dialog trust claude, tombol tak dikenal | **0 byte** |

Bentuk repaint claude untuk keystroke `h`:

```
\x1b[38;5;174m\x1b[H ▐▛███▛█…Claude Code v2.1.237\x1b[K…
…\x1b[8;1H❯ h\x1b[K\x1b[38;5;244m\r\n──────…\x1b[10;1H…\x1b[K\x1b[8;4H
```

Tiga sifat yang menentukan seluruh desain:

1. Frame dibuka `\x1b[H`, ditutup `\x1b[8;4H` — **penempatan absolut**. Tak satu pun bergantung pada
   posisi kursor sebelumnya, jadi prediksi yang menggeser kursor tak bisa merusaknya.
2. Baris prompt digambar `\x1b[8;1H❯ h\x1b[K` — **`\x1b[K` menghapus ke akhir baris**, jadi ekor di
   kanan kursor selalu kosong dan kursor selalu duduk di ujung teks. Itulah yang membuat rollback
   `\x1b[<n>D\x1b[K` setia.
3. Karakter yang diketik **ada di dalam frame** (`❯ h`), jadi "sudah ter-echo atau belum" bisa
   dijawab dari isi layar sesudah frame ditulis.

Dua baris nol byte di tabel adalah kasus yang **tak bisa dibedakan dari jaringan lambat** kecuali
lewat batas waktu — dasar gerbang TTL.

## Temuan 2 — TUI agen menggambar ulang per EVENT input, bukan per karakter

`hello world` di kotak prompt claude, RTT nol, diukur di pty:

| cara kirim | frame balik | byte balik |
| --- | --- | --- |
| 11 keystroke terpisah (jeda 120 ms) | 22 | **16 999** |
| 1 frame berisi 11 karakter | 2 | **1 551** |

**11× lebih sedikit byte balik** untuk input yang identik. Inilah nilai sebenarnya coalescing
input — di arah keluar yang sudah dibayar SPEC-812, bukan di arah masuk.

## Kontrol negatif 1 — `?47h` dan `?2004h` BUKAN milik agen

`\x1b[?47h` (alternate screen bentuk lama) dan `\x1b[?2004h` (bracketed paste) muncul **1×** di
aliran claude — dan **1× juga di `bash --noprofile --norc` polos**. Keduanya lahir dari handshake
attach tmux, bukan dari program di dalamnya:

| mode | claude | bash polos |
| --- | --- | --- |
| `?1049h` / `?1049l` | 0 / 0 | 0 / 0 |
| `?47h` | **1** | **1** |
| `?2004h` | **1** | **1** |
| `?1000h` `?1002h` `?1006h` | 3 masing-masing | 2 masing-masing |

Gerbang alt-screen yang mempercayai `?47` karena itu akan mematikan prediksi selamanya pada
**setiap** attach — bug yang tak akan pernah terlihat sebagai error. Gerbang hanya membaca
`?1049h/l` dan `?1047h/l`; dikunci test.

## Kontrol negatif 2 — jendela 16 ms tak menggabungkan ketikan manusia

Jeda antar-tekan manusia 120–200 ms, jauh di atas jendela 16 ms. Terukur di harness, RTT 200 ms,
TUI claude:

| jeda ketik | prediksi | frame masuk | byte masuk |
| --- | --- | --- | --- |
| 120 ms (manusia) | mati | 10 | 180 |
| 120 ms (manusia) | hidup | **10** | **180** |
| 12 ms (burst) | mati | 10 | 180 |
| 12 ms (burst) | hidup | **5** | **95** |

Coalescing **tak berbuat apa pun** pada pengetikan normal — itu memang desainnya (jendela dipatok
≤ 16 ms supaya tak pernah menambah latensi terasa). Yang dipanennya adalah burst: autorepeat,
IME/swipe-type ponsel, papan tombol layar, dan paste.

## Hasil terukur — sebelum vs sesudah

Satu build, satu variabel (sakelar operator), harness ujung-ke-ujung di atas. `keydown → glyph`
diukur dari event `keydown` asli sampai karakter benar-benar ada di model layar xterm pada kolomnya
— satu frame sebelum piksel, dan dilabeli begitu.

| jalur | RTT | prediksi | keydown→glyph p50 | p90 |
| --- | --- | --- | --- | --- |
| bash | 0 ms | mati | 30,6 ms | 39,8 ms |
| bash | 0 ms | **hidup** | **0,4 ms** | 2,7 ms |
| bash | 200 ms | mati | 233,3 ms | 239,5 ms |
| bash | 200 ms | **hidup** | **1,7 ms** | 4,7 ms |
| TUI claude | 200 ms | mati | 242,1 ms | 251,7 ms |
| TUI claude | 200 ms | **hidup** | **2,7 ms** | 12,4 ms |

**90× lebih cepat** pada jalur yang paling sering dipakai. Bahkan di localhost (RTT 0) prediksi
memangkas 30,6 ms → 0,4 ms: jendela coalesce keluar 16 ms milik SPEC-812 ditambah satu-dua rAF
tetap terasa, dan prediksi menghapusnya.

Burst (jeda 12 ms), TUI claude, RTT 200 ms — di sinilah coalescing input membayar:

| prediksi | frame masuk | byte masuk | byte keluar | keydown→glyph p50 |
| --- | --- | --- | --- | --- |
| mati | 10 | 180 | 20 524 | 222,8 ms |
| **hidup** | **5** | **95** | **11 370** | **12,1 ms** |

**Setengah frame masuk, 1,8× lebih sedikit byte keluar**, dan glyph tetap 18× lebih cepat.

### Anchor RTT nyata

Angka 200 ms bukan karangan. Dari Mac yang sama dengan servernya, lewat domain publik:

| ukuran | nilai |
| --- | --- |
| ICMP RTT ke edge Cloudflare (`hm-dena.tumbuh.ai`) | **26,5 ms** (min 26,4 / max 26,7) |
| round-trip aplikasi lewat tunnel (`time_starttransfer`) | **140,8 ms** |
| idem, `hanoman.nafanesia.id` | 143,9 ms |

Round-trip aplikasi 141 ms terjadi **dari LAN yang sama dengan server**, karena request tetap naik
ke edge lalu turun lewat tunnel. Dari data seluler, 200 ms adalah representatif, bukan pesimistis.

## Invarian keselamatan — dan buktinya

> Begitu satu byte pun datang dari pty, prediksi di-rollback **sebelum** byte itu ditulis, dalam
> **satu** panggilan `term.write`. Layar sesudah setiap frame server karena itu byte-identik dengan
> layar tanpa prediksi.

Karena rollback dan data server masuk sebagai satu string, keadaan antara tak pernah dirender.
Diuji di harness terhadap TUI claude nyata, dua kecepatan ketik, membandingkan model layar xterm
**dan** `tmux capture-pane` (yaitu byte yang benar-benar sampai ke pty):

| ketik | layar klien identik? | pty identik? | kemunculan teks di pty (mati / hidup) |
| --- | --- | --- | --- |
| jeda 120 ms | **ya** | **ya** | 1 / 1 |
| jeda 12 ms (coalesce + reapply ekor) | **ya** | **ya** | 1 / 1 |

Tak ada karakter ganda, tak ada yang hilang, tak ada sisa.

## Perbaikan

Seluruhnya di klien; `server/**` tak disentuh.

1. `src/src/screens/terminal-predict.ts` (baru) — modul murni tanpa React & tanpa xterm:
   klasifikasi input, gerbang, `applySeq`/`rollbackSeq`, rekonsiliasi, TTL/suspend, batcher input.
   Komponen menyuplai pandangan layar (`View`) sebagai data, jadi seluruh keputusan bisa diuji
   sebagai fungsi murni — persyaratan brief.
2. `src/src/screens/TerminalPane.tsx` — wiring. **Hanya `term.onData`** yang lewat jalur baru;
   `sendInput` mentah tetap dipakai apa adanya oleh clipboard (SPEC-289/511), tap dialog
   (SPEC-452/800), lampiran (SPEC-816), dan papan tombol layar (SPEC-800), sehingga jaminan
   "satu keystroke = satu frame" milik keempatnya tak berubah. `pendingInput` (SPEC-771) utuh.
3. `src/src/screens/TerminalScreen.tsx` — sakelar operator di panel tampilan,
   `usePersistedState("terminal", "predict", true, isBool)` → `hn.ui.v1.terminal.predict`.
   State tampilan lokal per browser seperti ukuran font (SPEC-740/ADR-0115), bukan payload
   workspace kanonik per-user (ADR-0118). Sakelar ini sekaligus **alat ukur** di atas.

### Gerbang — kapan prediksi TIDAK jalan

| gerbang | sinyal |
| --- | --- |
| sakelar operator mati | `predict === false` |
| socket belum `open` | jalur `pendingInput` SPEC-771 tak disentuh |
| alternate screen | `?1049h`/`?1047h` sampai pasangan `l`-nya — **bukan** `?47`/`?2004` |
| input bukan teks | escape, arrow, Enter, Tab, ctrl, DEL |
| paste / IME | input >1 karakter — satu frame, tak pernah diprediksi |
| dua kolom terakhir | prediksi yang membungkus baris tak bisa di-rollback dengan CUB |
| ekor baris tak kosong | prasyarat `\x1b[K` |
| baris berpola password | `password`/`passphrase`/`pass`/`PIN` di ujung baris |
| **pernah meleset** | satu prediksi mencapai TTL 500 ms tanpa pernah ter-echo → suspend 30 dtk |

**Password: hanya satu karakter yang pernah tampil.** Lapis pertama gerbang isi baris. Bila polanya
tak dikenali, karakter pertama tampil lalu TTL berakhir tanpa echo → rollback + suspend, dan
karakter berikutnya tak pernah diprediksi. Model mosh; batasnya diakui, bukan disembunyikan.

**Suspend ber-cooldown 30 detik, bukan permanen.** Brief meminta "mati begitu meleset sekali";
cooldown memenuhinya (berhenti seketika) sekaligus menyembuhkan diri — satu `sudo` di tengah sesi
shell panjang tak boleh membunuh fitur sampai pane ditutup. `onopen` mereset seluruh state: tmux
memutar ulang layar penuh saat attach, jadi tak ada yang boleh diwarisi lintas sambungan.

## Gotcha yang wajib dijaga

1. **`view.cursorX` dibaca hidup dari xterm dan SUDAH memuat karakter yang diprediksi.** Menambahkan
   `pending.length` lagi terhadap tepi baris menghitungnya dua kali dan menutup prediksi jauh sebelum
   kolom terakhir. `reapply`, yang memprobe beberapa karakter sekaligus, memajukan kursornya sendiri.
2. **Penanda prediksi wajib netral SGR.** `\x1b[4m…\x1b[24m` hanya men-toggle underline; `\x1b[m`
   akan mereset warna/latar dan membuat `\x1b[K` di rollback mengecat dengan latar yang salah.
3. **Rollback dan data server WAJIB satu panggilan `term.write`.** Dua panggilan membuka celah render
   di antaranya — di situlah "layar rusak saat TUI menggambar ulang" akan lahir.
4. **`setInterval` TTL lahir di dalam effect.** Test yang memasang `vi.useFakeTimers()` *sesudah*
   render meninggalkan interval yang berjalan pada jam sungguhan dan TTL tak akan pernah menyala.
5. **Coalescing hanya aktif saat prediksi aktif.** Tanpa itu sakelar mati justru menambah latensi.

## Yang sengaja TIDAK dikerjakan

- **Jendela coalescing > 16 ms.** Kontrol negatif 2 menunjukkan 16 ms tak memanen ketikan manusia,
  dan Temuan 2 menunjukkan ada 11× menunggu di sana. Jendela 40–60 ms akan memanennya — tetapi brief
  mematok ≤ 16 ms dan menaikkannya menunda byte yang benar-benar sampai ke agen. Lever berikutnya,
  berikut angkanya.
- **ACK/flow control atau nomor urut frame.** Tak dibutuhkan: rekonsiliasi memakai isi layar xterm
  yang sudah otoritatif. Menambahkannya berarti tipe frame WS baru + ADR.
- **Menyentuh arah keluar SPEC-812.** `COALESCE_MS`, `COALESCE_MAX_BYTES`, `perMessageDeflate` tak
  diubah; nol perubahan server.
- **Deteksi "ini claude/codex".** Diganti sinyal perilaku terukur; nama program bukan invarian.

## Batas yang diakui

- **codex tak bisa diprobe di mesin ini** — biner vendored-nya ENOENT
  (`@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex`). TUI-nya sekelas claude
  (redraw ber-posisi absolut) dan seluruh gerbang berbasis perilaku, jadi tak ada satu pun cabang
  kode yang bergantung pada asumsi itu.
- Menggabungkan dua keystroke dalam jendela 16 ms secara teori bisa menyatukan dua digit menjadi
  burst yang ditelan dialog Ink (SPEC-452). Interval antar-tekan manusia tercepat ± 50 ms; risiko
  nyatanya autorepeat, dan autorepeat pada digit bukan cara memilih baris dialog.
- Angka RTT 200 ms disuntik di jembatan probe. Verifikasi akhir di perangkat nyata lewat domain
  publik adalah langkah manusia.

## Test yang mengunci

- `src/test/terminal-predict.test.ts` — 49 test murni: klasifikasi, kedua sekuens, seluruh gerbang
  (termasuk kontrol negatif `?47h`/`?2004h` dan "pending tak dihitung dua kali"), `echoedPrefixLen`,
  transisi `onInput`/`onServerData`/`reapply`/`onTick`/`onReattach` — dengan frame repaint claude
  nyata sebagai fixture — dan batcher input.
- `src/test/terminal-pane.test.tsx` — 7 test kontrak call site di atas mock xterm yang sudah ada:
  tulis lokal bergaris bawah lalu kirim setelah 16 ms; `rollback+data` sebagai **satu** write;
  control seketika tanpa prediksi; paste satu frame tanpa prediksi; sakelar mati = nol tulis lokal;
  TTL me-rollback lalu berhenti memprediksi; baris password tak pernah diprediksi. Ke-25 test lama
  (clipboard, wheel, touch, lampiran, reconnect) tetap hijau.
- `src/test/terminal-screen.test.tsx` — sakelar hidup secara default, tersimpan lintas render.

**Catatan menjalankan test di mesin ini:** `node` default v25.6.1 memasang `localStorage` global
bawaan yang menang atas milik jsdom, sehingga `src/test/setup.ts` melempar
`localStorage.clear is not a function` di **setiap** test `src/**` — gagal palsu 100 %, identik di
base. Jalankan dengan node 24: `PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"
node node_modules/vitest/vitest.mjs --run --root src test/<berkas>`.
