# SPEC-878 — ketikan terminal saat jaringan goyah: pengiriman, urutan, dan antrean

**Sumber:** backlog SPEC-878 (qa, prioritas kritis)
**Audit:** `internal/docs/research/audit-spec-878-ketikan-hilang-saat-jaringan-goyah.md` — semua angka
di bawah berasal dari sana, bukan dari pembacaan kode.
**Pendahulu yang DITEGAKKAN, bukan diubah:** SPEC-812 (arah keluar: coalesce 16 ms + deflate),
SPEC-856 (echo prediktif + invarian rollback-sebelum-byte-server), SPEC-860 (satu penjawab
handshake, replay dibersihkan), SPEC-863/ADR-0133 (`altScreen` dari `#{alternate_on}`),
SPEC-761 (plafon backoff 8 dtk), ADR-0014/0016/0117 (revalidasi principal per frame & 60 dtk).
**ADR:** **ADR-0134** — kontrak frame WebSocket terminal bertambah satu pasang (`in.seq` / `t:"ack"`).
Preseden bentuk: ADR-0133 (`t:"alt"`).

## Masalah dalam satu kalimat

`view.connected` = `ws.readyState === OPEN` adalah fakta **transport**, tetapi prediksi dan TTL-nya
memakainya sebagai fakta **pengiriman** ("byte ini sampai ke pty") — dan batcher input, yang
seharusnya jadi titik cekik urutan, bukan satu-satunya pintu keluar.

Empat akibat terukur:

| # | gejala terukur | angka |
| --- | --- | --- |
| 1 | socket `OPEN` tapi byte tak mengalir → glyph muncul lalu **dihapus**, prediksi mati 30 dtk, **tanpa banner** | 9 glyph → `\x1b[9D\x1b[K` → 0 tulis lokal; `link` tetap `"open"` |
| 2 | socket tertutup → **nol** umpan balik selama seluruh outage | 0 tulis lokal untuk 14 keystroke |
| 3 | antrean dikuras sebagai SATU blob → **submit yang tak diniatkan** | `{"t":"in","d":"rahasia\rlanjut"}` → `capture-pane`: `rahasia` masuk sebagai baris ter-submit |
| 4 | jalur input mentah menyalip batcher → **transposisi harfiah** | ketik `z`, tekan Escape → pty menerima `["\x1b","z"]` |

## Keputusan yang diambil dokumen ini

Audit menyisakan satu pertanyaan terbuka: **apa yang boleh terjadi pada ketikan yang terlanjur
diantre saat sambungan pulih.** Tiga kandidat, dan alasan memilih:

| kandidat | ditolak/dipilih karena |
| --- | --- |
| kuras diam-diam (**hari ini**) | terbukti men-submit baris yang salah ke agen — akar severity kritis |
| buang diam-diam | menukar satu kehilangan dengan kehilangan lain; melanggar janji SPEC-800 bahwa antrean adalah *penyelamat* ketikan |
| **tahan bila ia memuat submit, lalu tanyakan** | **dipilih** — menjaga bytenya, dan menjaga agar keputusan "kirim" tetap milik manusia yang sudah melihat layar yang benar |

Aturannya satu kalimat, dan sengaja **tidak** memecah antrean:

> **Antrean tak pernah mengirim byte yang men-submit.** Bila `pendingInput` memuat `\r` atau `\n`,
> ia **seluruhnya** ditahan dan operator diberi `Kirim` / `Buang`. Bila tidak, ia dikuras seperti
> hari ini.

Memecah di `\r` pertama ditolak: itu mengirim separuh kalimat operator dan menahan separuhnya —
"sebagian mendarat" adalah keluhan yang sedang diperbaiki, bukan yang boleh diciptakan. Kedip 1–2
detik di tengah kalimat (kasus paling sering) tetap terkuras otomatis dan tak terlihat, persis
seperti hari ini.

## Bentuk perbaikan

### 1 · Pengakuan pengiriman: `{t:"in", d, seq}` → `{t:"ack", seq}` (ADR-0134)

TTL SPEC-856 menjawab pertanyaan "**pty menerima byte ini dan sengaja tak membalas apa-apa**"
(`read -s`, tombol yang ditelan dialog — keduanya terukur 0 byte). Pertanyaan itu hanya bisa
ditanyakan setelah byte-nya benar-benar sampai. Hari ini `since` dipasang saat karakter **diketik**,
jadi TTL menghukum jaringan lambat dengan hukuman yang dirancang untuk pty yang bungkam.

`ws.bufferedAmount` **bukan** penggantinya: payload satu keystroke lolos ke buffer kernel dan
terbaca `0` meski tak satu byte pun sampai ke server. Satu-satunya sinyal yang benar-benar tahu
adalah pengakuan dari sisi server.

- Klien menomori setiap frame masuk: `{t:"in", d, seq}` — `seq` monoton per socket, mulai 1.
- Route membalas `{t:"ack", seq}` **sesudah** `writeTo` selesai. Artinya persis "server menerima
  frame ini dan menyerahkannya ke pty".
- `seq` **opsional** di sisi server (`typeof m.seq === "number"`), jadi klien lama tetap jalan dan
  server lama hanya membuat klien baru berhenti memulai jam TTL — merosot ke perilaku aman
  (prediksi bertahan, tak pernah dihukum), bukan ke perilaku berbahaya.

Ongkosnya: satu frame ~20 byte per frame masuk. Frame masuk sudah dibatasi batcher ke ≤1 per 16 ms
saat mengetik, dan lewat socket yang sama yang sudah `perMessageDeflate` (SPEC-812). Bandingannya
1 540 byte repaint yang dikirim TUI agen untuk keystroke yang sama. Arah keluar SPEC-812 tak
disentuh; `WsMessageGuard` hanya menghitung frame **masuk**, jadi kuota 6 000/menit tak bergeser.

### 2 · `View.connected` → `View.deliverable`

Nama field di modul murni ikut berubah karena kekeliruannya ada di nama itu:

```
deliverable = antrean masih bisa menerima byte ini DAN suatu saat akan terkuras
```

- `open`, `retrying`, `lost` → **true** (byte diantre; `lost` masih punya tombol "Sambungkan lagi")
- `gone` (4004 — sesi tmux memang lenyap) → **false**
- antrean penuh → **false** (lihat §4)

Konsekuensinya prediksi hidup selama outage: operator melihat ketikannya. Sesuai janji brief
"Setiap karakter yang diketik muncul di layar segera dan tetap muncul".

### 3 · Jam TTL berjalan hanya sejak byte diketahui sampai

Modul murni bertambah satu transisi dan mengubah satu:

- `onInput` menyetel `since = null` — jam **berhenti** setiap kali ada prediksi baru.
- **baru** `onDelivered(state, now)` — bila ada `pending` dan `since === null`, `since = now`.
- `onTick` tak berubah bentuknya: `since === null` → tak pernah memicu.
- `reapply` menyetel `since = null` (bukan `now`); pemanggil menyalakan jamnya lewat jalur yang sama.

Komponen memanggil `onDelivered` **hanya** saat: ack diterima **dan** tak ada lagi frame yang
belum di-ack **dan** socket `OPEN`. Satu helper, dua call site (sesudah ack, sesudah `reapply`).

Efeknya pada Temuan 1: selama lubang hitam tak ada ack, jam tak berjalan, glyph **bertahan**,
`suspendedUntil` tak pernah menyala. `SUSPEND_MS = 30_000` tetap 30 dtk — ia sekarang hanya
menyala pada kejadian yang memang dirancang untuknya.

### 4 · Antrean: berbatas, tak pernah men-submit, dan terlihat

- `MAX_PENDING_INPUT = 4096` byte. Penuh → byte baru **tidak** diterima, `deliverable` jadi false
  (jadi tak ada glyph yang menjanjikan sesuatu yang dibuang), dan strip mengatakannya.
- Saat pulih: `\r`/`\n` di dalam antrean → **seluruh antrean ditahan** (`held`), strip menawarkan
  `Kirim` / `Buang`. Selama `held`, ketikan baru **ikut mengantre** — bukan dikirim mendahului
  antrean, yang justru transposisi yang sedang diperbaiki.
- `Kirim` mengirim seluruh antrean apa adanya (operator sudah melihat layar yang benar dan memilih);
  `Buang` mengosongkannya.
- Strip juga menyebut jumlah saat sekadar diantre: `menyambung ulang… (3/12) · 12 ketikan diantre`.
  Ini jawaban langsung atas "operator melihat tandanya, bukan layar yang diam".

### 5 · Satu pintu keluar untuk semua input

```
sendRaw(d)  =  batcher.push(d, /* coalesce */ false)   →  flush() lalu send(d)
```

Papan tombol (SPEC-800), tap dialog (SPEC-452), clipboard (SPEC-289), dan lampiran (SPEC-816)
memakai `sendRaw`, bukan `sendInput` langsung. Urutan byte ke pty jadi benar **secara konstruksi**,
bukan karena jendela 16 ms kebetulan tak kena. Jaminan masing-masing SPEC tak berubah: `push` dengan
`coalesce=false` meneruskan payload **utuh dalam satu frame**, jadi "satu tekan = satu keystroke"
(SPEC-452) dan "paste utuh" (SPEC-289) tetap berlaku.

### 6 · `resize` mendahului kuras antrean

`onopen` menata ulang urutannya: rollback prediksi → `onReattach()` → (bila pane terlihat) `resize` +
`focus` → baru kuras antrean. Geometri yang berubah selagi putus tak lagi mendarat sesudah bytenya.

### 7 · Balasan handshake terminal tak pernah mengantre

`isTerminalResponse` pindah ke `@hanoman/shared` (`shared/src/terminal-io.ts`); `pty.ts` mengimpor
dan mengekspornya ulang sehingga gerbang SPEC-860 dan test-nya tak bergeser. `sendInput` memakainya:
balasan handshake milik sambungan yang **sudah mati** tak punya arti bagi sambungan berikutnya, jadi
ia dibuang alih-alih diantre. Ini menutup jendela sempit yang audit catat sebagai **mungkin, tapi
tak terjadi di run nyata** — harganya satu kondisi, dan menghapus satu-satunya jalan blob campuran
menembus gerbang `isTerminalResponse`.

### 8 · Rollback saat menyambung ulang

Prediksi yang lahir selama outage adalah satu-satunya hal yang menulis ke terminal selama itu, jadi
kursor duduk persis di ujungnya dan `rollbackSeq` (CUB + `\x1b[K`) tetap sah — prasyarat yang sama
yang sudah dipegang modul. `onopen` menuliskannya **sebelum** apa pun dari server, lalu
`P.onReattach()`. Prediksi tak pernah wrap ke baris berikutnya karena `EDGE_MARGIN` menolak dua
kolom terakhir dan `cursorX` dibaca hidup dari xterm.

## Yang sengaja TIDAK dikerjakan

- **Tak ada perubahan arah keluar.** `COALESCE_MS`, `COALESCE_MAX_BYTES`, `perMessageDeflate`,
  `trimScrollback` — semua SPEC-812 utuh.
- **Tak ada heartbeat/ping periodik.** Ack hanya lahir sebagai balasan atas frame masuk; pane yang
  diam tak menghasilkan satu byte pun tambahan. Menambah denyut akan membalik justru yang dibeli
  SPEC-812.
- **Antrean tidak dipersistensi lintas unmount.** Pindah sel/layar selagi putus tetap membuang
  antrean. Ia bukan state tampilan (ADR-0115) dan menaruh ketikan mentah di storage adalah keputusan
  tersendiri; audit mencatatnya, spec ini tak mengambilnya.
- **Backoff, plafon 8 dtk, dan anggaran 12 percobaan tak disentuh** (SPEC-761).
- **`SUSPEND_MS` tak diturunkan.** Ia tak pernah salah; yang salah adalah kapan ia dipicu.
- **Tak ada knob baru.** Sakelar `hn.ui.v1.terminal.predict` (ADR-0115) tetap satu-satunya.

## Batas yang diakui

- Ack menyatakan "sampai di **server**", bukan "diserap **program di dalam pane**". Cukup untuk
  memisahkan jaringan dari pty — dan itu satu-satunya pemisahan yang TTL butuhkan.
- Bila server lebih tua dari klien (rilis campuran), ack tak pernah datang → jam TTL tak pernah
  berjalan → prediksi bertahan sampai byte server berikutnya. Aman, sedikit lebih longgar dari hari
  ini pada `read -s` yang tak tertangkap regex — dan `looksLikePasswordPrompt` tetap gerbang
  pertamanya.
- `held` menahan seluruh antrean, termasuk ketikan yang lahir sesudahnya. Itu memang jadi
  "input terkunci sampai operator memutuskan"; strip mengatakannya dan prediksi tetap menampilkannya.

## Kriteria terima

1. Selama socket tak `OPEN` **maupun** selama socket `OPEN` tanpa ack, setiap karakter yang diketik
   menghasilkan tepat satu glyph lokal dan glyph itu **tidak** dihapus oleh TTL.
2. Frame `{t:"in"}` yang diterima pty berurutan persis seperti operator memasukkannya, apa pun
   campuran jalur (ketik / papan tombol / tap dialog / paste / lampiran).
3. Antrean yang memuat `\r` atau `\n` **tidak pernah** dikirim tanpa tindakan operator.
4. Antrean tak pernah melebihi `MAX_PENDING_INPUT`, dan keadaan penuh terlihat.
5. Sesudah pulih: `{t:"resize"}` mendahului byte antrean.
6. Layar klien identik `tmux capture-pane`, teks muncul persis 1×, di setiap lengan.
7. Ack tak mengubah satu pun angka arah keluar SPEC-812.
