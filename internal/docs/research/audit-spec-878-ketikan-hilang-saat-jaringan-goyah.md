# Audit SPEC-878 — ketikan hilang & tertukar saat jaringan goyah

**Sumber:** backlog SPEC-878 (qa, prioritas kritis) · hanoman 0.1.53
**Pendahulu:** SPEC-812 (coalesce+deflate arah keluar), SPEC-856 (echo prediktif arah masuk),
SPEC-860 (karakter liar dari replay handshake), SPEC-863/ADR-0133 (gerbang alt-screen dari tmux).
Keempatnya **ditegakkan**, tak satu pun dicabut atau diulang di sini.
**Keputusan:** Spec & Plan **dijalankan penuh**. Alasannya bukan jumlah temuan melainkan satu di
antaranya: apa yang boleh terjadi pada ketikan yang terlanjur diantre saat sambungan putus adalah
**keputusan kontrak operator**, bukan bug dengan satu jawaban benar — dan memperbaikinya menambah
satu varian frame WebSocket, jadi ia butuh ADR sendiri (preseden ADR-0133).

## Ringkasan

Brief benar pada kedua dugaannya, dan **kurang satu** yang justru dominan.

**(A) benar.** Selagi socket tak `OPEN`, prediksi menolak total: **0 tulis lokal untuk 10 keystroke**
(harness jsdom) dan **0 tulis lokal untuk 14 keystroke** (harness ujung-ke-ujung, xterm 6 asli).
Layar benar-benar diam.

**(B) benar, dan bukan sekadar jendela balapan.** Diukur di jalur nyata: mengetik `z` lalu menekan
satu tombol papan tombol di layar mengirim ke pty dalam urutan **`["\x1b", "z"]`** — Escape yang
ditekan **belakangan** mendarat **lebih dulu**. Transposisi harfiah, deterministik selama batcher
16 ms masih memegang ketikan.

**(C) benar dan terbukti sampai akibatnya.** Antrean outage dikuras sebagai **satu** blob:
`{"t":"in","d":"rahasia\rlanjut"}`. `capture-pane` sesudah pulih memperlihatkan `rahasia` **sudah
masuk sebagai baris yang ter-submit** ke TUI dan `lanjut` tertinggal di baris input — persis "baris
yang salah ikut ter-submit" yang membuat severity-nya kritis.

**Yang kurang di brief, dan yang paling menjelaskan gejala "layar diam berkepanjangan":** kasus
terburuk bukan socket yang **tertutup**, melainkan socket yang **masih `OPEN` sementara bytenya
tidak mengalir** — lubang hitam TCP, bentuk normal dari "pindah sel / sinyal turun" jauh sebelum
browser menyatakan socket mati. Di sana `view.connected` **true**, jadi prediksi menyala, glyph
muncul — lalu **TTL 500 ms menghapus semuanya** (`\x1b[9D\x1b[K`) dan menyalakan
`suspendedUntil = now + 30_000`. Sesudah itu **0 tulis lokal** untuk setiap ketikan berikutnya
selama **30,5 detik**, dan **tak ada satu pun banner** — `link` terukur tetap `"open"`.

> Satu kedip 500 ms karena itu membeli **30,5 detik layar bisu**, tanpa tanda apa pun.

Akar tunggalnya bisa dinyatakan satu kalimat: **gerbang prediksi dan TTL-nya membaca fakta
transport (`readyState`) dan memperlakukannya sebagai fakta pengiriman (byte sampai ke pty).**
Ketiga gejala di brief adalah tiga wajah dari kekeliruan yang sama, ditambah satu jalur input kedua
yang memang tak pernah melewati titik cekik yang sama.

## Cara mengukur

Dua lapis, keduanya sekali pakai di scratchpad, tanpa dependensi baru.

1. **Probe deterministik** — `TerminalPane` **asli** di jsdom dengan `FakeWebSocket` (bentuk yang
   sudah dipakai `src/test/terminal-pane.test.tsx`). Yang dimock hanya *renderer* xterm; besaran
   yang diukur — jumlah `term.write` lokal dan urutan frame `{t:"in"}` — tak bergantung pada
   renderer. Enam probe: P1 layar diam, P2 transposisi, P3 blob antrean, P4 balasan terminal basi,
   P5 urutan resize, P6 lubang hitam TCP.
2. **Harness ujung-ke-ujung** — jembatan WS (`ws`, `perMessageDeflate` level 6 memLevel 7, coalesce
   keluar 16 ms / 64 KiB, scrollback + replay saat attach, frame `alt` dari `#{alternate_on}`) di
   atas node-pty 1.1.0 + tmux 3.7b pada socket privat, menyajikan halaman berisi `@xterm/xterm`
   **6.0.0 asli** + `terminal-predict.ts` **asli** (di-bundle esbuild) dirangkai persis seperti
   plumbing input `TerminalPane`. Disetir Chrome 151 headless lewat CDP dengan throttling tab latar
   dimatikan. **RTT 200 ms dan pemadamannya disuntik DI JEMBATAN** — `Network.emulateNetworkConditions`
   tak menyentuh frame WebSocket yang sudah terhubung, jadi menahan frame di jembatan adalah
   satu-satunya penundaan yang benar-benar terukur (temuan SPEC-856, dipakai ulang apa adanya).

Jembatan punya dua bentuk pemadaman yang sengaja dibedakan:

- **`hold`** — frame keluar ditahan, frame masuk dibuang, socket **tidak** ditutup. Ini lubang hitam
  TCP: `readyState` di browser tetap `OPEN`.
- **`cut`** — socket di-`terminate()` dan koneksi baru ditolak. Ini putus bersih: `onclose` → backoff.

Program di dalam pane adalah tiruan TUI agen dengan bentuk repaint yang **diukur** SPEC-856
(`\x1b[H` … `\x1b[8;1H❯ <buf>\x1b[K` … penempatan absolut + `\x1b[K`), dan ia **men-submit** pada
`\r` — itulah yang membuat akibat dugaan (C) bisa dibaca dari `capture-pane`, bukan disimpulkan.

## Temuan 1 — lubang hitam TCP: glyph muncul, lalu dihapus, lalu 30,5 detik bisu

Jalur nyata, `hold` dinyalakan selagi socket `OPEN`, sembilan karakter diketik:

| yang diukur | nilai |
|---|---|
| `link` selama pemadaman | `"open"` — tak ada banner, tak ada `onclose` |
| tulis lokal saat diketik | 9 × `\x1b[4m<c>\x1b[24m` (glyph muncul) |
| tulis lokal berikutnya | `\x1b[9D\x1b[K` — **kesembilannya dihapus** |
| 2 karakter sesudah itu | `[]` — **nol** tulis lokal |
| layar saat padam vs sesudah pulih | **identik**, dan identik dengan `capture-pane` |

Baris terakhir itu yang paling mahal: sembilan karakter tadi **tidak pernah sampai ke pty sama
sekali**. Di harness ia hilang karena jembatan membuangnya; di jaringan nyata ia hilang saat socket
akhirnya ditutup dengan `bufferedAmount` masih terisi. Ini "sebagian terasa hilang" di brief —
bukan perasaan, kehilangan data betulan, dan operator tak diberi tahu apa pun.

Mekanismenya ada di dua baris:

- `terminal-predict.ts:76` — `if (!enabled || !view.connected || state.altScreen) return false;`
- `terminal-predict.ts:136-143` — `onTick` menghapus `pending` dan menyetel
  `suspendedUntil = now + SUSPEND_MS` begitu `now >= since + TTL_MS`.

`since` dipasang saat karakter **diketik** (`onInput`), bukan saat ia **sampai**. TTL karena itu
mengukur "sudah berapa lama saya menunggu", padahal yang ingin dijawab SPEC-856 adalah "pty sudah
menerima byte ini dan sengaja tak membalas apa-apa" — dua pertanyaan yang jawabannya hanya sama
selama jaringan sehat. `SUSPEND_MS = 30_000` memang benar untuk pertanyaan pertama (`read -s` dan
tombol yang ditelan dialog sama-sama membalas nol byte, SPEC-856) dan **salah total** untuk yang
kedua.

Probe deterministik P6 memberi bentuk yang sama pada skala lebih kecil: 4 glyph → `\x1b[4D\x1b[K` →
`0` tulis lokal untuk 5 karakter berikutnya, `banner = (tidak ada)`.

## Temuan 2 — putus bersih: nol glyph selama seluruh outage

`cut`, lalu 14 karakter diketik:

| yang diukur | nilai |
|---|---|
| `link` | `"retrying 1"` (banner **ada**) |
| tulis lokal | `[]` — **nol** untuk 14 keystroke |
| `pendingInput` | 14 byte |

Ini dugaan (A) brief, terkonfirmasi apa adanya. Bytenya memang tidak hilang — ia diantre — tetapi
umpan balik visualnya nol, dan itu cukup untuk membuat operator mengetik ulang, menekan Enter untuk
"membangunkan", atau menghapus dengan Backspace yang juga ikut mengantre.

Probe P1 memberi angka pembanding di dalam satu run: 1 tulis lokal per karakter saat `OPEN`,
**0 untuk 10 karakter** sesudah `onclose`.

## Temuan 3 — antrean dikuras sebagai satu blob, dan blob itu men-submit

Lanjutan Temuan 2 — `heal`, klien menyambung ulang, lalu dibaca apa yang benar-benar sampai ke pty:

```
["rahasia\rlanjut", " resize:100x30", "\x1b[?1;2c", "\x1b[>0;276;0c", …]
```

dan `capture-pane` sesudahnya:

```
— tiruan TUI agen —

> …halo rahasia          ← baris ter-SUBMIT
❯ lanjut                 ← sisa ketikan
```

Tiga hal sekaligus terbaca di sini:

1. **`\r` di tengah blob = submit yang tak diniatkan.** Operator mengetik ke layar yang **beku**
   sejak beberapa detik lalu; apa yang mereka kira sedang mereka jawab bukan apa yang ada di pty
   saat blob mendarat. `TerminalPane.tsx:141-145` menguras `pendingInput` sebagai satu
   `send({t:"in", d})` tanpa memeriksa isinya.
2. **Input mendahului `resize`.** `onopen` menguras antrean di baris 141 dan baru mengirim
   `{t:"resize"}` di baris 150 — sesudah `if (!visibleRect()) return;`. Geometri yang berubah selagi
   putus (rotasi, papan tombol layar naik/turun) hilang senyap karena `send()` no-op saat socket tak
   `OPEN`, jadi blob digambar TUI memakai **geometri lama** lalu layar di-rewrap. Probe P5 memberi
   urutan yang sama di jalur jsdom: `{"t":"in","d":"hai"}` lalu `{"t":"resize","cols":80,"rows":24}`.
3. **`pendingInput` tak berbatas.** Ia tumbuh selama seluruh anggaran reconnect (~76 dtk), tak
   dikosongkan saat `gone` (4004) maupun `lost`, dan **hilang senyap** saat pane di-unmount
   (`batcher.dispose()` menguras ke `sendInput` → `pendingInput` → closure mati). Menekan
   "Sambungkan lagi" sesudah `lost` menguras seluruh akumulasi itu sekaligus.

## Temuan 4 — dua jalur input: yang mentah menyalip yang di-batch

Diukur di jalur nyata dengan satu ekspresi JS, dua panggilan berurutan dalam turn yang sama:

```
hn.type("z");        // term.onData → batcher (ditahan 16 ms selagi prediksi aktif)
hn.raw("\x1b");    // sendInput mentah — papan tombol SPEC-800 / dialog SPEC-452 / clipboard SPEC-289
```

Yang sampai ke pty: **`["\x1b", "z"]`**. Probe P2 mengulangnya lewat tombol papan tombol sungguhan
(`.hn-terminal-key`, Escape) dan memberi urutan yang sama.

Sebabnya struktural dan sudah tertulis apa adanya di `TerminalPane.tsx:99-101`: hanya `term.onData`
yang lewat `createInputBatcher`. `batcher.push` memang menjaga urutan **untuk apa pun yang lewat
dirinya** (`flush()` lebih dulu untuk control/bulk, `terminal-predict.ts:174`) — tetapi jalur mentah
tak pernah menyentuh `flush()` itu, jadi jaminan tersebut berhenti tepat di pintu masuknya.

Jendelanya 16 ms saat main thread lapang, dan melar sejauh main thread ponsel melar — `setTimeout`
adalah antrean yang sama dengan repaint terminal. Ia juga **hanya aktif saat prediksi hidup**
(`batcher.push(d, wasPredicting || r.write.length > 0)`), yaitu justru keadaan normal mengetik di
prompt TUI agen (`alternate_on` = 0, SPEC-863).

## Temuan 5 — balasan terminal basi bisa menembus gerbang SPEC-860 (sempit, tak terjadi di run nyata)

Dicatat dengan honesty penuh karena ia **tidak** muncul di run ujung-ke-ujung.

`isTerminalResponse` (`server/src/services/pty.ts`) menjaga agar balasan handshake terminal dari
klien non-pertama tak ditulis ke pty (SPEC-860). Ia menilai **seluruh** payload:

```
isTerminalResponse("\x1b[?1;2c")    → true    (dibuang)
isTerminalResponse("\x1b[?1;2cya")  → false   (ditulis ke pty)
```

Bila socket putus **di antara** pertanyaan tmux dan jawaban xterm, jawaban itu masuk `pendingInput`
dan dikuras bercampur ketikan manusia — dan blob campuran itu lolos. Probe P4 membangun jendela
sempit itu dengan sengaja dan mendapat `{"t":"in","d":"\x1b[?1;2cya"}`.

Di run ujung-ke-ujung jendela ini **tidak** kena: balasan lahir sesudah socket kembali `OPEN` dan
terkirim sebagai frame tersendiri (`"\x1b[?1;2c"` terpisah di wire di atas), sehingga gerbang
SPEC-860 tetap menangkapnya. Jadi ini **kemungkinan yang terbukti bisa terjadi, bukan penyebab
terukur dari laporan ini**. Ia tetap layak ditutup karena harganya satu baris: balasan handshake
milik sambungan yang sudah mati tak punya arti apa pun bagi sambungan berikutnya.

## Yang TIDAK terbukti / sengaja tidak dituduh ulang

- **CPU/renderer ponsel** — ditutup SPEC-812 (antrean `WriteBuffer` xterm 0 ms pada throttle 6×).
- **Echo prediktif sebagai sumber karakter liar** — ditutup SPEC-860 (`predict=0` identik).
- **Gerbang alt-screen berbasis aliran** — ditutup SPEC-863/ADR-0133. `#{alternate_on}` dipakai apa
  adanya di harness ini dan berperilaku benar sepanjang pengukuran.
- **Coalesce 16 ms arah keluar (SPEC-812)** — tak menyentuh arah masuk; tak ada satu pun angka di
  sini yang berubah karenanya.
- **Batcher masuk 16 ms sebagai sumber latensi** — bukan. Pada kecepatan ketik manusia ia tak
  menggabungkan apa pun (SPEC-856); ia hanya jadi masalah karena jalur kedua menyalipnya.

## Akar masalah

Satu kekeliruan kategori, empat akibat:

> `view.connected` = `ws.readyState === OPEN` adalah fakta **transport**. Prediksi dan TTL-nya
> memperlakukannya sebagai fakta **pengiriman** ("byte ini sampai ke pty").

- Transport mati, pengiriman **tertunda** (byte diantre, pasti terkirim) → prediksi menolak, padahal
  seharusnya boleh. → Temuan 2.
- Transport hidup, pengiriman **gagal** (lubang hitam) → prediksi menyala lalu TTL menghukumnya 30,5
  detik, padahal pty tak pernah diberi kesempatan menjawab. → Temuan 1.
- Pengiriman yang tertunda dikuras tanpa kebijakan → satu blob yang bisa men-submit. → Temuan 3.

Ditambah satu cacat yang berdiri sendiri:

> Batcher input adalah titik cekik urutan, tetapi **bukan satu-satunya pintu keluar** — empat jalur
> lain menulis langsung ke `sendInput`. → Temuan 4.

## Arah perbaikan (ditetapkan Spec, bukan di sini)

Tiga hal yang audit ini anggap sudah terjawab oleh data:

1. **Pisahkan "terkirim" dari "tersambung".** Prediksi boleh hidup selagi byte diantre untuk sambungan
   yang masih diharapkan pulih, dan wajib di-rollback saat antrean itu dinyatakan tak akan pernah
   terkuras (`gone`/`lost`).
2. **TTL butuh titik nol yang benar.** Ia hanya boleh berjalan sejak byte diketahui **sampai di
   server**. Tanpa sinyal itu, tak ada cara membedakan `read -s` dari sinyal yang turun — dan menebak
   ke arah "hukum 30 detik" adalah tebakan yang salah paling mahal. `ws.bufferedAmount` **bukan**
   sinyal yang cukup: payload sekecil satu keystroke lolos ke buffer kernel dan terbaca `0` meski tak
   ada satu byte pun sampai. Yang cukup hanyalah pengakuan dari sisi server.
3. **Satu pintu keluar untuk semua input.** Ini yang brief sebut "perbaikan paling murah" dan datanya
   setuju.

Satu hal yang **belum** terjawab oleh data dan karena itu masuk Spec sebagai keputusan:
apa yang boleh terjadi pada antrean saat sambungan pulih. Menguras diam-diam adalah perilaku hari
ini dan terbukti bisa men-submit baris yang salah; membuang diam-diam menukar satu kehilangan
dengan kehilangan lain; menahannya butuh permukaan yang dilihat operator.

## Batas yang diakui

- Tiruan TUI dipakai sebagai program di pane, bukan `claude` sungguhan — alasan yang sama dengan
  SPEC-856/863: bentuk repaint-nya sudah diukur dari `claude` asli dan dipakai apa adanya, sementara
  men-spawn agen sungguhan untuk harness memakai subscription dan menaruh agen otonom di working
  tree. `alternate_on` TUI `claude` terukur `0` (SPEC-863), jadi lengan gerbang yang relevan sama.
- Harness memodelkan lubang hitam TCP dengan **membuang** byte masuk. Di jaringan nyata byte itu bisa
  juga **datang terlambat** bila koneksi TCP-nya selamat. Kedua arm memberi gejala yang sama bagi
  operator (layar bisu, lalu semuanya datang sekaligus); yang berbeda hanya apakah ia berakhir
  sebagai kehilangan atau sebagai ledakan tertunda. Angka "hilang" di Temuan 1 karena itu adalah
  batas atas, bukan satu-satunya akhir yang mungkin.
- `pendingInput` yang hilang saat pane di-unmount dibaca dari kode, tidak diukur; ia tak ikut
  menjelaskan laporan ini dan hanya dicatat.
- Durasi browser mempertahankan `readyState === OPEN` di atas lubang hitam nyata tidak diukur di
  sini (ia milik tumpukan TCP OS, bukan aplikasi). Yang diukur adalah perilaku klien **selama**
  keadaan itu, dan itu yang menentukan perbaikannya.

## Verifikasi

Diukur ulang **sesudah** perbaikan, pada harness yang sama persis (tmux 3.7b + node-pty + xterm 6
asli + `terminal-predict.ts` asli + Chrome 151 headless, RTT 200 ms, pemadaman disuntik di jembatan)
dengan jembatan ikut membalas `{t:"ack", seq}`.

### Lengan yang berbalik

| skenario | sebelum | sesudah |
| --- | --- | --- |
| lubang hitam TCP · 9 keystroke | 9 glyph lalu **`\x1b[9D\x1b[K`** (semuanya dihapus) | 9 glyph, **nol rollback** |
| lubang hitam TCP · 2 keystroke berikutnya | `[]` — prediksi disuspend 30 dtk | **2 glyph** — prediksi masih hidup |
| putus bersih · 13 keystroke | `[]` — nol tulis lokal | **13 glyph** |
| antrean ber-`\r` saat pulih | `["rahasia\rlanjut", " resize:100x30", …]` — terkirim, ter-submit | `[" resize:100x30"]` — **antrean tak dikirim**, `{n:14, held:true}` |
| `capture-pane` sesudah pulih | `> …halo rahasia` (baris ter-submit) | **tak berubah** sampai operator menekan `Kirim` |
| sesudah `Kirim` | — | `["…resize…", "rahasia\rlanjut"]`, `capture-pane` menampilkan submit yang **diminta** |
| urutan `z` lalu Escape | `["\x1b","z"]` | **`["z","\x1b"]`** |
| `resize` vs byte antrean | input lebih dulu | **`resize` lebih dulu** |

Bukti akhir yang sama dengan SPEC-856/860/863 tetap berdiri: layar klien dan `tmux capture-pane`
**identik** di akhir run —
`— tiruan TUI agen — / > …halo XYrahasia / ❯ lanjutz` di keduanya, teks muncul persis 1×.

Satu nuansa yang layak dicatat karena ia bukan cacat melainkan invarian SPEC-856 yang bekerja:
selama pemadaman, layar menampilkan ketikan yang **belum** sampai; begitu sambungan pulih dan byte
pertama dari pty tiba, `onServerData` menggulung balik prediksi sebelum menulisnya, sehingga byte
yang benar-benar hilang di jaringan **lenyap dari layar** alih-alih berbohong. Di harness, `hold`
memodelkan paket yang dibuang, jadi `dunia ini` memang tak pernah sampai dan layar akhir menunjukkan
kebenaran pty. Yang berubah bukan apakah byte bisa hilang di jaringan — melainkan apakah operator
melihat apa yang mereka ketik selama itu, dan apakah layar berbohong sesudahnya.

### Test yang mengunci

| berkas | hasil |
| --- | --- |
| `shared/src/terminal-io.test.ts` | 3 lulus |
| `src/test/terminal-predict.test.ts` | 55 lulus (7 di antaranya baru) |
| `src/test/terminal-pane.test.tsx` | 45 lulus (13 di antaranya baru) |
| `src/test/terminal-screen.test.tsx` (tetangga yang merender strip) | ikut hijau: predict + pane + screen = **167 lulus** dalam satu run |
| `server/test/pty-queries.test.ts` | 8 lulus, tanpa satu baris pun perubahan test (gerbang SPEC-860 utuh) |
| `server/test/terminal.route.test.ts` | **69 lulus** vs **68 di base** — ack-nya yang bertambah |

Typecheck `shared`, `src`, dan `server`: ketiganya keluar 0.

**Sembilan kegagalan di `terminal.route.test.ts` TIDAK diperbaiki dan bukan regresi.** Ia diukur,
bukan diasumsikan: berkas versi base `b9082276` dijalankan apa adanya di mesin ini dan memberi
**9 gagal / 68 lulus** dengan nama test yang sama persis (`sesi backlog`, `sesi reverse`, `sesi prd`,
`sesi scaffold`, `sesi breakdown` — semuanya timeout peluncuran sesi). Sesudah perbaikan angkanya
**9 gagal / 69 lulus**. Dua env shell wajib di-unset untuk menjalankan suite server di mesin ini,
dan keduanya bukan bagian dari perubahan ini: `HANOMAN_CONTROL_ORIGINS` (membuat seluruh route
menjawab 404) dan `NODE_ENV` yang bukan `test` (membuat admission WebSocket menolak 401).

### Smoke terhadap server hidup

Endpoint WebSocket ikut berubah, jadi ia diuji sekali di akhir terhadap server yang benar-benar
boot (`tsx server/src/server.ts`, `HANOMAN_HOME` sementara + `migrate deploy`, port 8799), dengan
sesi tmux milik smoke sendiri (`hanoman-s878smoke`) — **bukan** `POST /terminal/sessions`, yang akan
men-spawn `claude` sungguhan.

```
ACK = [{"t":"ack","seq":1},{"t":"ack","seq":2}]
JENIS FRAME = ["alt","ack","data"]
capture-pane: sh-3.2$ echo SPEC878-SMOKE-OK
              SPEC878-SMOKE-OK
```

Frame ketiga sengaja dikirim **tanpa** `seq` dan tak membalas apa pun — itu jalur mundur untuk klien
lama. Sesi smoke dibunuh per-nama sesudahnya; dua sesi tetangga di socket `hanoman` yang sama tak
tersentuh.

### Yang TIDAK dijalankan

Suite penuh, lint penuh, dan build penuh **tidak** dijalankan — itu tugas manusia sebelum merge
(ADR-0080/SPEC-376). Yang dijalankan hanya berkas test yang bersinggungan dengan perubahan ini.
Perilaku di jaringan seluler sungguhan lewat Cloudflare Tunnel juga tak diukur di sini; yang diukur
adalah keadaan yang dimodelkan harness, dan pemilihannya dijelaskan di §Cara mengukur.
