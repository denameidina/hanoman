# Diagnostik jalur ketik terminal

**Status:** alat investigasi aktif, opt-in, mati secara default.
**Latar:** keluhan berulang "input terminal inkonsisten dan sangat lambat, terutama di tablet",
yang **belum** terjelaskan oleh SPEC-812 (arah keluar), SPEC-856/863 (echo prediktif) maupun
SPEC-878/ADR-0134 (jam TTL berbasis ack).

## Apa yang sudah terukur

Semua angka di bawah diambil dari instance lokal `hm-dena.tumbuh.ai` (Cloudflare Tunnel →
`127.0.0.1:8787`, hanoman 0.1.54), tablet iPad + Chrome, desktop di `localhost`.

| Besaran | Publik (tablet) | localhost (desktop) |
| --- | --- | --- |
| RTT `GET /api/health` | 110–147 ms | 0,4–1,6 ms |
| Sambungan pertama (dingin) | 2 080 ms | — |

**Rekaman pty (cuplik `capture-pane` per 150 ms, sesi `d1eefae8`, operator mengetik abjad):**
sembilan karakter pertama mendarat **sempurna** dan berurutan (`a`…`i`, jarak 0,22–0,62 dtk).
Mulai karakter ke-10 yang mendarat **bukan lagi lanjutan abjad**: hasil akhirnya
`abcdefghilmiochdhhdjdndchcjfhbf`, sebagian datang **3 karakter dalam satu cuplikan 150 ms**.
Percobaan kontrol berikutnya kehilangan tepat `w e r t` — satu pita bersebelahan di baris atas
QWERTY — **tanpa** substitusi.

Dua bentuk kerusakan yang berbeda (mengganti vs menghilangkan) hampir selalu berarti dua sebab.

## Mengapa tambalan TTL/suspend ditolak

Usulan awal — hakimi `TTL_MS` terhadap RTT terukur dan pangkas `SUSPEND_MS` 30 dtk — **dibatalkan
sebelum ditulis**, karena tiga alasan yang saling menguatkan:

1. **Jam TTL sudah netral terhadap jaringan.** Sejak ADR-0134 `since` menyala saat **ack tiba**.
   Ack dan echo pty menempuh WebSocket yang sama dan terurut: echo tak bisa mendahului ack, dan
   keterlambatan jaringan menimpa keduanya sama besar. 500 ms itu mengukur **diamnya pty**.
2. **Memangkas suspend membuka kembali kebocoran password.** `read -s`, prompt passphrase ssh
   (SPEC-862), dan tombol yang ditelan dialog trust sama-sama terukur membalas **nol byte** —
   tak terbedakan dari jaringan lambat kecuali lewat TTL. Suspend pendek = satu karakter password
   ter-echo di layar tiap beberapa detik.
3. **Pada rekaman di atas TTL hampir pasti tak pernah menyala.** `onInput` menyetel `since = null`
   setiap ada karakter baru, dan `clockIfDelivered` hanya menyalakan jam saat `unacked === 0`.
   Selama operator mengetik beruntun — dan di fase rusak ia mengetik sampai 3 karakter per 150 ms —
   jam itu tak pernah sempat berjalan. Menambalnya berarti menambal mekanisme yang sedang tidur.

## Batas yang belum terukur, dan alat ini

Di hilir `term.onData` seluruh jalur sudah ditelusuri dan **tak ada yang bisa mengganti byte**:
`createInputBatcher` hanya menyambung dan mengurutkan, `sendInput` hanya bisa **membuang**
(antrean 4 KiB penuh, atau `isTerminalResponse`), dan rollback prediksi ditulis ke terminal lokal
lewat `term.write` sehingga tak pernah menyentuh pty. Yang belum pernah diukur adalah **hulunya**:
antara jari operator di kaca perangkat dan byte yang keluar dari `term.onData`.

Perekam ini menutup batas itu tanpa DevTools di perangkat — yang di tablet praktis mustahil.

### Cara memakai

1. Halaman **Terminal** → **"Rekam jalur ketik"** → **Nyalakan**. Sakelarnya per-browser
   (`usePersistedState`), jadi menyalakannya di tablet tak menyalakannya di desktop.
2. Ketik di pane seperti biasa, lalu **Matikan** lagi. Ia merekam **setiap tombol**, jadi jangan
   biarkan menyala saat mengetik rahasia.
3. Baca hasilnya di mesin yang menjalankan server:

```bash
cat "$HANOMAN_HOME/diag/<id-sesi>.jsonl" | tail -80
```

### Bentuk berkas

Satu peristiwa per baris, `t` = ms sejak peristiwa pertama perekam itu:

| `k` | arti | `v` | `n` |
| --- | --- | --- | --- |
| `key` | `keydown` mentah papan tombol/IME | `event.key` | `keyCode` |
| `comp` | composition IME | `<tipe>:<data>` | — |
| `data` | muatan yang keluar dari `term.onData` | byte, ESC ditampilkan `\e` | — |
| `ack` | ack server (ADR-0134) | `seq` | **RTT terukur (ms)** |
| `pred` | echo prediktif **menolak** menyala | alasan + posisi kursor | — |

### Cara membacanya

Sandingkan `key`/`comp` dengan `data` yang mengikutinya:

- `key: j` diikuti `data: l` → **hanoman merusak byte**. Sampai hari ini tak ada jalur yang bisa
  melakukannya, jadi temuan ini akan mengejutkan dan wajib diverifikasi ulang.
- `key: j` diikuti `data: j`, tapi pty menerima `l` → kerusakan di **server atau tmux**.
- Tak ada `key: j` sama sekali, dan `data: l` muncul sendiri → browser/IME/papan tombol perangkat
  yang mengirimkannya. hanoman bersih; perbaikannya bukan di repo ini.
- Deret `comp` panjang tanpa `key` yang sepadan → papan tombol lunak memakai composition, dan
  koreksi otomatisnya yang menulis ulang teks.

`ack.n` memberi **distribusi RTT nyata dari perangkat itu**, bukan dari `curl` di mesin server —
angka yang selama ini hanya bisa ditaksir.

## Batas alat ini

- Ia merekam apa yang **browser** laporkan. Tombol yang tak pernah menjadi event browser (mis.
  sentuhan yang tak diregistrasi digitizer) **tak terlihat** — kalau `key` untuk `j` memang tak
  pernah ada, itu bukti kuat sebabnya di luar hanoman, tapi bukan penunjuk penyebab persisnya.
- Muatan `diag` menempuh WebSocket yang sama dengan yang sedang diselidiki. Kegagalan menulisnya
  sengaja ditelan (`try/catch` di `routes/terminal.ts`): diagnostik tak boleh menjatuhkan sesi.
- Berkas per sesi dipangkas di `DIAG_MAX_BYTES` (2 MiB). `$HANOMAN_HOME` juga rumah `hanoman.db`.

## Berkas

- `src/src/screens/terminal-diag.ts` — perekam murni (ring buffer, batch 250 ms, `showBytes`)
- `src/src/screens/TerminalPane.tsx` — listener `keydown`/`composition*`, pencatat `data`/`ack`/`pred`
- `src/src/screens/TerminalScreen.tsx` — sakelar `hn.ui.v1.terminal.diag`
- `server/src/services/terminal-diag.ts` — sink JSONL + gerbang id sesi
- `server/src/routes/terminal.ts` — frame WS `diag`
