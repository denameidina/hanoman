# SPEC-856 — echo prediktif lokal + coalescing input terminal

**Sumber:** backlog SPEC-856 (brief, prioritas tinggi)
**Pendahulu:** SPEC-812 menyelesaikan arah KELUAR (coalesce 16 ms + `perMessageDeflate`; 1 464 KB → 24,1 KB)
dan menyisakan arah MASUK sebagai lever berikutnya. Dokumen ini adalah lever itu.
**ADR:** tidak ada. Tak ada tipe frame WS baru, tak ada kolom, tak ada endpoint — kontrak
`t:"in"` / `t:"data"` yang diukur SPEC-812 tetap apa adanya.

## Yang diukur lebih dulu

Semua angka di bawah dari probe `node-pty` + `tmux` nyata, meniru `open()` di
`server/src/services/pty.ts` (socket tmux terpisah, opsi global identik). Bukan pembacaan kode.

| skenario | balasan pty untuk SATU keystroke |
| --- | --- |
| `bash --noprofile --norc` | **1 byte** (`h`) |
| TUI claude (v2.1.237, 100×30) | **1 540 byte** — repaint layar penuh |
| `read -s -p PASS:` | **0 byte** |
| dialog trust claude (tombol tak dikenal) | **0 byte** |

Bentuk repaint claude untuk keystroke `h`:

```
\x1b[38;5;174m\x1b[H ▐…Claude Code v2.1.237\x1b[K…
…\x1b[8;1H❯ h\x1b[K\x1b[38;5;244m\r\n──────…\x1b[10;1H…\x1b[K\x1b[8;4H
```

Tiga sifat yang menentukan seluruh desain:

1. Frame dibuka `\x1b[H` dan ditutup `\x1b[8;4H` — **penempatan absolut**, tak satu pun bergantung
   pada posisi kursor sebelumnya. Prediksi yang menggeser kursor karenanya tak bisa merusaknya.
2. Baris prompt digambar `\x1b[8;1H❯ h\x1b[K` — **`\x1b[K` menghapus sampai akhir baris**, jadi
   ekor baris di kanan kursor selalu kosong dan kursor selalu duduk di ujung teks.
3. Karakter yang diketik **ada di dalam frame** (`❯ h`), jadi "sudah ter-echo atau belum" bisa
   dijawab dari isi layar sesudah frame ditulis.

Ini membalik premis brief. Brief menyuruh mematikan prediksi di TUI agen; ukuran menunjukkan di
sanalah prediksi paling aman (repaint absolut) sekaligus paling berharga (echo 1 540 byte, bukan
1 byte). **Keputusan operator: gerbangnya perilaku terukur, bukan nama program.**

### Coalescing input membeli arah KELUAR, bukan hanya masuk

TUI agen menggambar ulang sekali **per event input**, bukan per karakter. `hello world` di kotak
prompt claude:

| cara kirim | frame balik | byte balik |
| --- | --- | --- |
| 11 keystroke terpisah (jeda 120 ms) | 22 | 16 999 |
| 1 frame berisi 11 karakter | 2 | 1 551 |

**11× lebih sedikit byte balik.** Brief menduga coalescing input hanya menghemat frame masuk;
ukuran menunjukkan penghematan terbesarnya justru di arah keluar yang sudah dibayar SPEC-812.
Catatan jujurnya di §"Batas yang diakui".

### Kontrol negatif — `?47h`/`?2004h` BUKAN milik agen

`\x1b[?47h` (alternate screen bentuk lama) dan `\x1b[?2004h` (bracketed paste) muncul **1×**
di aliran claude — dan **1× juga di `bash --noprofile --norc` polos**. Keduanya lahir dari
handshake attach tmux, bukan dari program di dalamnya. Gerbang alt-screen yang mempercayai `?47`
karena itu akan mematikan prediksi selamanya pada **setiap** attach. Gerbang hanya membaca
`?1049h/l` dan `?1047h/l`.

## Bentuk perbaikan

### Invarian keselamatan (satu kalimat)

> Begitu satu byte pun datang dari pty, prediksi di-rollback **sebelum** byte itu ditulis, dalam
> **satu** panggilan `term.write`. Layar sesudah setiap frame server karena itu byte-identik dengan
> layar tanpa prediksi.

Karena rollback dan data server masuk sebagai satu string, keadaan antara tak pernah dirender.
Prediksi tak pernah bisa merusak frame server, sekacau apa pun tebakannya — paling buruk ia hanya
salah selama < 1 RTT lalu hilang tanpa sisa.

### Modul murni `src/src/screens/terminal-predict.ts`

Tanpa React dan tanpa xterm, supaya seluruh logika rekonsiliasi diuji sebagai fungsi murni
(constraint brief). Komponen menyuplai "pandangan" layar (kursor, lebar, isi baris) sebagai data.

| fungsi | tanggung jawab |
| --- | --- |
| `classifyInput(d)` | `"text"` (satu grafem cetak) \| `"control"` (escape/arrow/Enter/Tab/ctrl) \| `"bulk"` (>1 karakter = paste/IME) |
| `applySeq(chars)` | `\x1b[4m` + chars + `\x1b[24m` — **netral SGR**: hanya underline yang di-toggle, warna/latar tak tersentuh |
| `rollbackSeq(n)` | `\x1b[<n>D\x1b[K` — mundur n kolom, hapus ke akhir baris dengan SGR yang sama seperti sebelum prediksi |
| `canPredict(state, d, view, now)` | seluruh gerbang, satu tempat |
| `echoedPrefixLen(before, pending)` | berapa karakter `pending` yang sudah digambar server, dari isi baris di kiri kursor |
| `scanAltScreen(data, alt)` | `?1049h/l` + `?1047h/l` saja (lihat kontrol negatif) |
| `looksLikePasswordPrompt(line)` | `password`/`passphrase`/`PIN`/`pass:` di ujung baris |
| `onInput` / `onServerData` / `onTick` | transisi state; mengembalikan `{write, send, state}` |

`rollbackSeq` bekerja karena gerbang menjamin ekor baris di kanan kursor kosong — yang justru
dipastikan `\x1b[K` milik TUI agen sendiri (sifat 2 di atas).

### Gerbang — kapan prediksi TIDAK jalan

| gerbang | sinyal |
| --- | --- |
| sakelar operator mati | `predict === false` |
| socket belum `open` | `link.state !== "open"` (jalur `pendingInput` SPEC-771 tak disentuh) |
| alternate screen aktif | `?1049h`/`?1047h` terlihat di aliran, sampai pasangan `l`-nya |
| input bukan teks | `classifyInput !== "text"` — escape, arrow, Enter, Tab, ctrl |
| paste / IME | `classifyInput === "bulk"` — dikirim sebagai satu frame, tak pernah diprediksi |
| kursor dekat tepi kanan | `cursorX + pending + 1 > cols - 2` (wrap tak bisa di-rollback dengan CUB) |
| ekor baris tak kosong | ada karakter non-spasi di kanan kursor |
| baris berpola password | `looksLikePasswordPrompt(line)` |
| **pernah meleset** | satu prediksi mencapai TTL tanpa pernah ter-echo → suspend |

**Suspend punya cooldown 30 detik**, bukan permanen. Brief meminta "mati begitu meleset sekali";
cooldown memenuhinya (berhenti seketika) sekaligus menyembuhkan diri — satu `sudo` di tengah sesi
shell panjang tak boleh membunuh fitur sampai pane ditutup. `onopen` mereset seluruh state:
tmux memutar ulang layar penuh saat attach, jadi tak ada yang boleh diwarisi lintas sambungan.

### Password: hanya satu karakter yang pernah tampil

Dua lapis. Pertama gerbang isi baris (`Password:`) mencegah prediksi sama sekali pada kasus umum.
Bila polanya tak dikenali, karakter pertama tampil lalu TTL berakhir tanpa echo → rollback +
suspend, dan **karakter berikutnya tak pernah diprediksi**. Ini persis model mosh; batasnya diakui,
bukan disembunyikan.

### Rekonsiliasi & ekor yang masih terbang

Pada frame server: tulis `rollbackSeq(n) + data`, lalu baca kursor + baris dari xterm (kini
otoritatif karena xterm sudah mem-parse frame itu) dan hitung `echoedPrefixLen`. Sisa yang belum
ter-echo di-**apply ulang** di posisi kursor baru bila gerbang masih lolos; bila tidak, sisa itu
dibuang begitu saja — ia akan muncul sendiri saat echo-nya tiba. Tak ada jalur yang meninggalkan
karakter tanpa pemilik.

### Coalescing input

`createInputBatcher({ windowMs: 16, send })`, **hanya aktif saat prediksi aktif** — brief menegaskan
coalescing tak boleh berdiri sendiri sebagai penambah latensi. `control` dan `bulk` **mengalir
seketika** dan menguras buffer lebih dulu, jadi Enter, panah, paste, path lampiran (SPEC-816),
digit pilihan dialog (SPEC-452), dan papan tombol layar (SPEC-800) tetap satu keystroke = satu frame
seperti sekarang.

Hanya `term.onData` yang lewat batcher. `sendInput` mentah tetap dipakai apa adanya oleh
clipboard, tap dialog, lampiran, dan `TerminalKeys` — semua jaminan SPEC-289/452/800/816 utuh
tanpa perlu diuji ulang.

### Sakelar

`usePersistedState("terminal", "predict", true, isBool)` di `TerminalScreen`, diturunkan sebagai
prop `predict` persis seperti `showKeys`. State tampilan lokal per browser (SPEC-740/ADR-0115),
bukan payload workspace kanonik (ADR-0118) dan bukan `Setting` server — sejajar presedennya
`fontSize` & papan tombol. Kontrol duduk di panel `displayControls`, bukan toolbar.

Sakelar ini sekaligus **alat ukur**: satu build, satu variabel, sebelum vs sesudah.

## Yang sengaja TIDAK dikerjakan

- **Jendela coalescing > 16 ms.** Ukuran 11× di atas berasal dari burst; pada kecepatan ketik
  manusia (jeda 120–200 ms) jendela 16 ms tak menggabungkan apa pun. Jendela 40–60 ms akan memanen
  penghematan itu untuk pengetikan nyata, tetapi brief mematok ≤ 16 ms dan menaikkannya menunda
  byte yang benar-benar sampai ke agen. Dicatat sebagai lever berikutnya, berikut angkanya.
- **ACK/flow control atau nomor urut frame.** Tak dibutuhkan: rekonsiliasi memakai isi layar xterm
  yang sudah otoritatif. Menambahkannya berarti tipe frame WS baru + ADR.
- **Menyentuh arah keluar SPEC-812.** `COALESCE_MS`, `COALESCE_MAX_BYTES`, `perMessageDeflate` tak
  diubah, dan tak ada perubahan server sama sekali.
- **Deteksi "ini claude/codex".** Diganti sinyal perilaku terukur; nama program bukan invarian.

## Batas yang diakui

- codex tak bisa diprobe di mesin ini (biner vendored-nya ENOENT). TUI-nya sekelas claude (redraw
  penuh ber-posisi absolut) dan gerbangnya berbasis perilaku, jadi tak ada cabang kode khusus yang
  bergantung pada asumsi itu.
- Menggabungkan dua keystroke dalam jendela 16 ms secara teori bisa menyatukan dua digit menjadi
  burst yang ditelan dialog Ink (SPEC-452). Interval antar-tekan manusia tercepat ± 50 ms; risiko
  nyatanya autorepeat, dan autorepeat pada digit bukan cara memilih baris dialog.

## Verifikasi

- Unit murni: `src/test/terminal-predict.test.ts` — seluruh tabel fungsi di atas, termasuk fixture
  frame claude 1 540 byte yang nyata sebagai input `echoedPrefixLen`/`scanAltScreen`.
- Kontrak call site: `src/test/terminal-pane.test.tsx` — mock xterm yang sudah ada, ditambah
  `cursorX`/`cursorY`/isi baris. Yang dikunci: urutan tulis lokal, `rollback+data` sebagai **satu**
  `write`, control/bulk lolos seketika, sakelar mati = nol tulis lokal + kirim seketika.
- Ukur sebelum/sesudah pada server hidup + tmux + node-pty nyata lewat Chrome headless (CDP), RTT
  disuntik `Network.emulateNetworkConditions`: frame masuk/detik, byte, dan keydown→glyph.
- Verifikasi akhir manusia di perangkat nyata lewat domain publik.
- Doc-of-record: `internal/docs/research/audit-spec-856-echo-prediktif-terminal.md`, ter-link di
  `internal/docs/README.md`.
