# SPEC-882 · Kolom ketik terminal untuk tablet & ponsel

**Tanggal:** 2026-08-22
**Status:** design, disetujui operator
**Menyentuh:** `src/src/screens/**` saja. Nol perubahan `server/**`, nol skema, nol endpoint, nol ADR.

## Masalah

Mengetik di sesi terminal dari tablet lewat `hm-dena.tumbuh.ai` terasa tertahan: huruf hilang,
kadang berganda atau kacau urutannya, dan sesudah satu karakter operator harus menunggu beberapa
detik sebelum yang berikutnya terasa mendarat.

Investigasi 2026-08-21/22 **tidak** menemukan akarnya, tetapi mencoret hampir semua tersangka
dengan pengukuran nyata (Chrome sungguhan, emulasi tablet, lewat tunnel publik): baseline
keydown→glyph p50 9,8 ms; RTT 300 & 700 ms; CPU throttle 6×; reconnect dengan replay scrollback
124 KB tanpa satu pun stall main-thread; input lewat IME `Input.imeSetComposition` mendarat 26/26
utuh dan berurutan; `permessage-deflate` terbukti menembus Cloudflare Tunnel; ack RTT lewat tunnel
p50 113 ms / p90 171 ms / max 298 ms.

Dua sifat yang **terukur** dan menjelaskan rasanya, apa pun pemicunya di lapangan:

1. **Glyph di layar bukan bukti byte terkirim.** Terukur: 26 glyph tampil dalam ~21 ms sementara
   `tmux capture-pane` menunjukkan prompt kosong. `deliverable` (`TerminalPane.tsx:168`) hanya
   menilai `!gone && !full`; keadaan socket tak ikut dinilai.
2. **Saat ack berhenti sementara socket tetap `OPEN`, prediksi tak pernah di-rollback.** `since`
   hanya menyala lewat `onDelivered` yang menuntut `unacked === 0`, dan `onTick` diam selama
   `since === null` (ADR-0134). Terukur di transport: RTT 800 ms sehat → 10/10 ack (p50 808 ms) dan
   semua huruf mendarat; lubang hitam 6 dtk → **0/10 ack, `readyState` tetap 1**.

Artinya operator bisa melihat baris utuh yang meyakinkan padahal tak satu byte pun sampai ke agen.

## Keputusan

Sediakan **kolom ketik (composer)** di bawah setiap pane terminal di perangkat sentuh. Operator
mengetik ke kolom itu — umpan balik lokal, nol RTT, tak bergantung kesehatan sambungan — dan isinya
mengalir ke pty secara debounce. Kolom ini **melengkapi**, bukan menggantikan, mengetik langsung ke
pane.

Ini sengaja **bukan** perbaikan akar. Akarnya masih dicari lewat perekam diagnostik
(`~/.hanoman/diag/<id>.jsonl`). Yang ditawarkan di sini adalah jalur ketik yang rasanya tak
bergantung pada latensi sama sekali, plus tampilan yang jujur soal apakah byte sudah sampai.

## Arsitektur

Pola cermin `terminal-predict.ts` (SPEC-856): mesin keadaan sebagai fungsi murni, komponen tipis,
wiring minimal.

| Berkas | Isi |
| --- | --- |
| `src/src/screens/terminal-composer.ts` | **Baru.** Modul murni. Nol DOM, nol WebSocket, nol xterm. |
| `src/src/screens/TerminalComposer.tsx` | **Baru.** Komponen presentasional: satu `<input>` + penanda status. |
| `src/test/terminal-composer.test.ts` | **Baru.** Uji modul murni. |
| `src/src/screens/TerminalPane.tsx` | Sisip komponen di antara host terminal dan `<TerminalKeys>`; sambungkan ke `sendKey.current`. |
| `src/test/terminal-pane.test.tsx` | Tambahan uji wiring & urutan tata letak. |

Seluruh byte keluar lewat `sendKey.current` (= `sendRaw` = `batcher.push(d, false)`), satu-satunya
pintu keluar sejak SPEC-878 — jadi urutan FIFO, antrean outage, dan penahanan `\r` berlaku tanpa
kode baru.

### Keadaan modul

```ts
type ComposerState = { text: string; sentPrefix: string };
```

`text` = yang dilihat operator. `sentPrefix` = yang diyakini sudah mendarat di baris pty dari
kolom ini.

### Mekanika delta — satu aturan untuk tiga kasus

```
k    = panjang awalan sama antara sentPrefix dan text, dihitung PER CODE POINT
send = "\x7f" × (jumlah code point sentPrefix setelah k) + text.slice(dari code point k)
sentPrefix = text
```

- Menambah di ujung → murni append.
- Menghapus di ujung → murni backspace.
- Menyunting di tengah → mundur sampai titik pisah, lalu ketik ulang sisanya.

**`\x15` (Ctrl-U) ditolak sebagai mekanisme selaraskan-ulang.** Artinya berbeda per program —
readline memotong sampai awal baris, `vim` dalam mode sisip melakukan hal lain, dan pane tak selalu
berisi shell. Backspace bekerja di mana-mana; ongkos beberapa byte ekstra pada suntingan tengah tak
terasa dibanding RTT.

**Perhitungan wajib per code point, bukan unit UTF-16.** Emoji yang dihitung sebagai dua unit
menghasilkan jumlah backspace yang salah dan merusak baris pty.

### Penjaga agar `sentPrefix` tak berbohong

- `onExternalInput()` — dipanggil saat operator mengetik langsung ke pane (papan tombol fisik, tap,
  tombol Esc/Tab/panah, tempel). Ia **menguras delta yang belum terkirim lebih dulu**, baru
  mengosongkan kolom dan menihilkan `sentPrefix`. Tanpa kuras itu, huruf yang sudah diketik operator
  tapi belum melewati debounce 350 ms akan lenyap tanpa jejak.

  Urutannya mengikat: pemanggilan terjadi **di awal `onTyped`, sinkron, sebelum
  `batcher.push(d, …)`** — dengan begitu delta kolom masuk antrean FIFO mendahului byte eksternal.
  Memanggilnya sesudah `batcher.push` menukar urutan byte di pty dan menghasilkan baris yang salah.

  Sesudah reset, menebak isi baris pty adalah tebakan, dan tebakan di sini berarti byte salah —
  karena itu `sentPrefix` nol, bukan dipertahankan.
- `onSubmit()` — `flush` dulu, lalu `\r`, lalu `reset`. Urutan ini tak boleh terbalik.

### Irama kirim

- Debounce **350 ms** sesudah ketikan terakhir.
- Kuras paksa tiap **1 detik** saat mengetik terus-menerus, supaya terminal di atasnya tak pernah
  tertinggal lebih dari sedetik.
- Kuras langsung saat kolom kehilangan fokus.
- Enter pada papan ketik layar = submit, langsung, tanpa menunggu debounce.

## Enter saat sambungan sakit

Tanpa kode penahan baru. `sendRaw` sudah mengendapkan byte ke `pendingInput` saat socket tak
`OPEN`, dan `drainPending` menahan seluruh isi yang memuat `\r` (`SUBMIT`) sampai operator menekan
"Kirim" di strip yang sudah ada. Ini menegakkan pelajaran SPEC-878: `capture-pane` membuktikan blob
lama yang membawa `\r` benar-benar men-submit baris yang salah ke agen.

Yang ditambahkan hanya kejujuran tampilan — satu penanda di sisi kanan kolom dengan tiga keadaan:

| Keadaan | Syarat | Teks |
| --- | --- | --- |
| terkirim | `link.state === "open"` dan antrean kosong | `terkirim` |
| diantre | `queue.n > 0` dan tak ditahan | `diantre {n}` |
| tertahan | `queue.held` | `tertahan — Kirim di atas` |

Tanpa penanda ini kolom ketik memperburuk masalah yang sedang diselidiki: ia terasa mulus persis
ketika byte-nya tidak ke mana-mana.

## Tata letak

Urutan di dalam pane, atas ke bawah: **strip status → terminal (`flex: 1`) → kolom ketik → bar
tombol Esc/Tab/panah**. Tombol aksi turun ke paling bawah.

- Muncul mengikuti sakelar "Papan tombol layar" (`showKeys`) yang sudah ada — tanpa setelan baru,
  default menyala di perangkat sentuh dan mati di desktop.
- Tampil di **setiap** pane pada grid, bukan hanya pane aktif.
- Tinggi sasaran sentuh 44 px, `font-family: var(--font-mono)`.
- Atribut wajib: `autoCapitalize="off"`, `autoCorrect="off"`, `spellCheck={false}`,
  `autoComplete="off"`, `enterKeyHint="send"`. Tanpa ini papan ketik Android mengapitalkan dan
  mengoreksi otomatis perintah shell, dan fitur ini akan mengirim teks yang bukan diketik operator.
- `aria-label` menyebut sesi yang dituju, mis. `Ketik untuk sesi spec-882`.
- Menyalakan/mematikan kolom mengubah tinggi pane → wajib memicu `fit.fit()` **dan** frame
  `resize`. Tanpa itu tmux menggambar untuk geometri lama.
- Mengikuti design system `internal/docs/design-system/**` (editorial, bone paper, brass accent).

## Pengujian

**Modul murni — `src/test/terminal-composer.test.ts`, tanpa DOM:**

1. tambah di ujung → hanya karakter baru yang dikirim
2. hapus di ujung → hanya `\x7f` sebanyak selisih
3. sunting di tengah → `\x7f` sampai titik pisah lalu sisa teks
4. `flush` tanpa perubahan → mengirim string kosong
5. `onSubmit` menguras sebelum `\r`, dan `reset` sesudahnya
6. `onExternalInput` menguras delta yang tertunda LEBIH DULU, baru menihilkan `text` dan
   `sentPrefix` — delta yang belum melewati debounce tak boleh hilang
7. teks non-ASCII (emoji, huruf beraksen) → jumlah backspace per code point, bukan unit UTF-16
8. teks kosong → `\r` tetap terkirim saat submit (Enter di baris kosong tetap sah)

**Wiring — `src/test/terminal-pane.test.tsx`:**

9. kolom tak dirender saat `showKeys` mati
10. urutan DOM: host terminal → kolom → bar tombol
11. Enter mengosongkan kolom
12. mengetik langsung ke terminal mengosongkan kolom, dan delta kolom yang tertunda mendarat di
    pty MENDAHULUI byte eksternal itu
13. penanda status mengikuti `link`/`queue`

## Yang sengaja TIDAK dikerjakan

- Tidak memperbaiki akar lag tablet — masih menunggu bukti dari perekam diagnostik.
- Tidak mengubah `deliverable`, TTL prediksi, maupun ADR-0134.
- Tidak menyentuh `server/**`.
- Tidak menambah riwayat/history untuk kolom ketik (YAGNI).
- Tidak mendukung multi-baris di kolom (Enter = kirim, bukan baris baru).
