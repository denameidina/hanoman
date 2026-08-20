# Audit SPEC-863 — echo prediktif mati diam-diam di bawah tmux

**Sumber:** backlog SPEC-863 (qa, prioritas tinggi) · hanoman 0.1.52
**Pendahulu:** SPEC-856 membangun echo prediktif; SPEC-860 menemukan matinya sebagai temuan sampingan
dan sengaja tidak memperbaikinya (scope-nya karakter liar).
**Keputusan:** Spec & Plan **skipped** — akar tunggal, terukur pada tiga versi tmux, dan perbaikannya
satu field format + satu varian frame + satu penukaran gerbang. Dokumen ini doc-of-record
perbaikannya. **ADR-0133** menyertainya karena kontrak frame WebSocket terminal bertambah satu
varian; ADR-0014, ADR-0016, ADR-0117, ADR-0118 **ditegakkan** (tak ada endpoint, kolom, skema, atau
perubahan arah keluar SPEC-812).

## Ringkasan

Brief benar soal gejalanya dan salah soal sebabnya.

**Benar:** prediksi memang mati total dan diam-diam. Direproduksi di jalur nyata (tmux + node-pty +
`@xterm/xterm` 6.0.0 asli + modul `terminal-predict.ts` asli + Chrome 151 headless, RTT 200 ms
disuntik di jembatan): `altScreen: true` sejak frame pertama sesudah attach, **nol** byte pernah
ditulis klien secara lokal, dan `predict=1` **tak bisa dibedakan** dari `predict=0` —
**225,5 ms vs 225,8 ms** median keydown→glyph.

**Salah:** ini bukan regresi tmux 3.7b. tmux **3.4**, **3.5a** (dibangun dari sumber di mesin ini)
dan **3.7b** berperilaku **identik**, byte per byte, sampai ke `head` aliran yang sama persis.
Tak ada versi yang pernah diuji di sini yang mengirim `?1049l` pasangannya selama sambungan hidup,
dan tak satu pun mengirim `?47h`. Yang berubah bukan tmux.

**Yang menentukan perbaikan** adalah pertanyaan yang diminta brief diukur lebih dulu, dan jawabannya
menutup jalur "cabut `?1049` dari daftar":

> tmux **tidak pernah** meneruskan `\x1b[?1049h`/`l` milik program di dalam pane ke klien luar.
> Setiap `?1049` yang sampai ke klien SELALU milik tmux sendiri.

Jadi gerbang alt-screen berbasis sekuens DEC di bawah tmux hanya bisa **salah-positif**; ia tak
pernah bisa benar-positif. Mencabut `?1049` dari daftar akan membuat gerbang itu **tak pernah
menyala** — bukan memperbaikinya, hanya memindahkan kematiannya ke sisi lain. Penggantinya harus
sinyal yang memang tahu: `#{alternate_on}` milik tmux.

## Cara mengukur

Tiga lapis, semuanya sekali pakai di scratchpad, tanpa dependensi baru.

1. **Probe kawat** — `new-session` + `attach-session -d` di atas node-pty 1.1.0 dengan opsi global
   yang meniru `open()` di `server/src/services/pty.ts` apa adanya (`remain-on-exit`, `status off`,
   `prefix None`, `mouse on`, `history-limit 50000`, `default-terminal screen-256color`,
   `-f /dev/null`, `name: "xterm-256color"`, 100×30). Setiap chunk `onData` direkam mentah.
2. **Probe kontrol positif** — program di dalam pane yang **sendiri** masuk lalu keluar alternate
   screen, sementara `#{alternate_on}` dibaca dari luar tiap detik.
3. **Harness ujung-ke-ujung** — jembatan WS (`ws`, `perMessageDeflate` level 6 memLevel 7, coalesce
   keluar **16 ms / 64 KiB**, `MAX_SCROLLBACK`/`SCROLLBACK_SLACK` SPEC-812) menyajikan halaman
   berisi `@xterm/xterm` 6.0.0 asli + `terminal-predict.ts` asli (di-bundle esbuild), dirangkai
   persis seperti `TerminalPane`. Disetir Chrome 151 headless lewat CDP, throttling tab latar
   dimatikan. **RTT disuntik di jembatan** — `Network.emulateNetworkConditions` tak menyentuh frame
   WebSocket yang sudah terhubung, jadi menahan frame di jembatan adalah satu-satunya penundaan
   yang benar-benar terukur.

Program di pane pada lapis 3 adalah tiruan TUI agen dengan bentuk repaint yang **diukur** SPEC-856
(`\x1b[H` … `\x1b[8;1H❯ <buf>\x1b[K` … `\x1b[8;<n>H`, penempatan absolut, `\x1b[K` mengosongkan ekor
baris). `claude` sungguhan sengaja tidak di-spawn untuk harness — lihat §Temuan 4 untuk apa yang
tetap diukur langsung darinya.

keydown→glyph diukur **di dalam halaman**: stempel diambil saat `keydown`, lalu setiap `term.write`
(prediksi maupun frame server) memanggil callback yang memeriksa apakah baris prompt sudah memuat
teks yang diharapkan. Kedua lengan diukur dengan alat yang sama persis.

## Temuan 1 — `?1049h` tanpa pasangan `l` adalah handshake attach tmux, bukan regresi versi

`head` aliran, identik pada 3.4, 3.5a, dan 3.7b:

```
\e[?1049h\e[22;0;0t\e[?1h\e=\e[H\e[2J\e[?12l\e[?25h…
```

| tmux | `?1049h` | `?1049l` | `?1047h` | `?47h` | `?2004h` |
| --- | --- | --- | --- | --- | --- |
| 3.4 (dibangun dari sumber) | **1** | **0** | 0 | **0** | 1 |
| 3.5a (dibangun dari sumber) | **1** | **0** | 0 | **0** | 1 |
| 3.7b (`/opt/homebrew/bin/tmux`) | **1** | **0** | 0 | **0** | 1 |

`\e[?1049h\e[22;0;0t` adalah `smcup` terminfo apa adanya. Ia lahir dari **TERM klien**, bukan dari
versi tmux — dan pasangannya memang ada, hanya saja ia `rmcup` yang dikirim saat **detach**, yaitu
di akhir umur klien:

| TERM klien | `?1049h` saat attach | `?1049l` saat attach | `?47h` | `?1049l` sesudah detach |
| --- | --- | --- | --- | --- |
| `xterm-256color` (yang dipakai `spawnPty`) | 1 | **0** | 0 | 1 |
| `screen-256color` | 1 | **0** | 0 | 1 |
| `tmux-256color` | 1 | **0** | 0 | 1 |
| `xterm` | 1 | **0** | 0 | 1 |
| `vt100` / `ansi` / `dumb` (tanpa `smcup`) | 0 | 0 | 0 | 0 |

Jadi pernyataan yang benar bukan "tmux 3.7b lupa mengirim `l`-nya", melainkan:

> Sepanjang umur sebuah sambungan WebSocket, `?1049h` **selalu** tanpa pasangan — pasangannya baru
> datang ketika klien tmux-nya dibunuh, dan saat itu tak ada lagi yang membacanya.

**Koreksi terhadap brief dan terhadap audit SPEC-856.** Angka `?1049h` 0× / `?47h` 1× di kontrol
negatif SPEC-856 **tak bisa direproduksi** — bukan pada 3.4, 3.5a, maupun 3.7b, dan bukan pada satu
pun dari tujuh TERM di atas (`?47h` = 0 di semuanya). Sebabnya tidak ditemukan dan tidak ditebak di
sini; yang pasti, gerbang `?1049` sudah salah sejak ditulis, hanya belum terlihat. Konsekuensinya
untuk perbaikan justru menguatkan: bentuk sekuens yang muncul di kawat adalah fungsi TERM, versi,
dan setelan — **tak satu pun boleh jadi tumpuan gerbang**.

## Temuan 2 — tmux tidak pernah meneruskan alternate screen milik pane (kontrol positif)

Ini kendala yang brief minta diukur lebih dulu. Program di dalam pane menulis `\x1b[?1049h`, diam
4 detik, lalu `\x1b[?1049l`. Selama itu `#{alternate_on}` dibaca dari luar dan aliran klien dihitung:

| t | `#{alternate_on}` | klien `?1049h` | klien `?1049l` |
| --- | --- | --- | --- |
| 1 s | 0 | 1 | 0 |
| 2–5 s | **1** | 1 | 0 |
| 6–9 s | 0 | 1 | 0 |

`#{alternate_on}` bergerak `0 → 1 → 0` persis mengikuti program. Hitungan klien **tak bergerak sama
sekali**: `?1049h` tetap 1 (milik handshake), `?1049l` tetap 0. Hal yang sama berlaku untuk bentuk
lama — pane yang menulis `\x1b[?47h`/`\x1b[?47l` juga tak melahirkan satu pun `?47h` di klien.

tmux mengemulasi terminal pane dan menggambar ulang sendiri; keadaan alternate screen pane adalah
keadaan **internal tmux**, tak pernah bocor ke terminal luar sebagai mode DEC. Karena itu:

- `scanAltScreen()` **benar menurut kontraknya** dan tetap tak berguna di sini: satu-satunya
  masukan yang pernah ia lihat adalah alternate screen **tmux**, yang menyala di byte pertama dan
  tak pernah padam.
- Mencabut `?1049` dari `ALT_ON`/`ALT_OFF` akan membuat `state.altScreen` **selamanya `false`** —
  prediksi menyala juga di dalam `vim`, persis bahaya yang gerbang itu ada untuk mencegah.

## Temuan 3 — `#{alternate_on}` adalah sinyal pengganti yang benar, di semua versi

| pane menjalankan | `#{alternate_on}` (3.7b) |
| --- | --- |
| `bash --noprofile --norc` | **0** |
| `vim` | **1** |
| TUI `claude` v2.x, idle di prompt | **0** |

Formatnya ada dan berperilaku sama di **3.4**, **3.5a**, dan **3.7b** (diuji: pane `bash` → `0` di
ketiganya). Ia dibaca dari `tmux list-panes -a -F …` yang **sudah** dijalankan loop poll 500 ms
milik `pty.ts` untuk seluruh sesi terbuka — menambah satu field ke `FMT` tidak menambah satu pun
invokasi tmux.

`codex` tidak bisa diukur di mesin ini: binernya `ENOENT`
(`…/aarch64-apple-darwin/codex/codex`), tak berhubungan dengan pekerjaan ini.

## Temuan 4 — dampak terukur: fitur inert, bukan salah

Harness, RTT 200 ms disuntik di jembatan, TUI tiruan, `hello` diketik satu huruf per 320 ms.
Modul prediksi apa adanya di base SHA (`63ccb72e`):

| lengan | `altScreen` saat attach | tulis lokal klien | median keydown→glyph |
| --- | --- | --- | --- |
| `predict=1` | **true** | **0** | **225,5 ms** |
| `predict=0` | **true** | **0** | **225,8 ms** |

Selisihnya **0,3 ms** — di dalam derau. Tak ada galat, tak ada log, tak ada tanda di UI; layar klien
identik dengan `tmux capture-pane` dan teks muncul persis **1×** di kedua lengan. Itulah bentuk bug
ini: fitur yang dibayar penuh dan tak menghasilkan apa-apa.

Nomor sesudah perbaikan ada di §Verifikasi.

## Perbaikan

Akarnya satu: **aliran byte klien tmux bukan sumber kebenaran soal keadaan pane.** Perbaikannya
memindahkan pertanyaan ke pihak yang memang tahu.

1. **Server — `server/src/services/pty.ts`.** `FMT` bertambah `#{alternate_on}` → `Pane.altScreen`.
   Frame baru `{ t: "alt"; on: boolean }` disiarkan saat berubah (dedup `lastAlt`, cermin
   `lastPhases`) dari loop poll 500 ms yang sudah ada, dan dikirim sekali ke setiap klien baru di
   `attach()` supaya klien kedua tak perlu menunggu perubahan yang mungkin tak akan datang — persis
   alasan `phase` dikirim per klien di sana (SPEC-433).
2. **Klien — `src/src/screens/terminal-predict.ts`.** `scanAltScreen()` dan daftar `ALT_ON`/`ALT_OFF`
   **dicabut**; `onServerData` tak lagi memindai mode DEC. Penggantinya `onPaneAltScreen(state, on)`,
   setter murni yang **tidak** menyentuh `pending`: rollback tetap milik dua jalur yang sudah ada
   (byte server berikutnya, atau TTL), sehingga invarian keselamatan SPEC-856 tak tersentuh.
3. **Klien — `src/src/screens/TerminalPane.tsx`.** Frame `alt` diteruskan ke `onPaneAltScreen`.

Gerbang alt-screen **tidak dilemahkan**: alternate screen sungguhan tetap mematikan prediksi, dan
sejak sekarang ia mematikannya pada saat yang benar, bukan pada setiap attach.

## Yang sengaja TIDAK dikerjakan

- **Mencabut `?1049` dari daftar dan berhenti di situ.** Terukur salah: gerbangnya akan tak pernah
  menyala lagi (Temuan 2).
- **Membuang `?1049h` tmux dari aliran di server.** Itu memindahkan gejalanya tanpa memberi klien
  satu pun cara mengetahui alternate screen pane, hasilnya sama dengan poin di atas.
- **Menyuntikkan `?1049h`/`l` sintetis ke aliran data** sebagai terjemahan `#{alternate_on}`. Itu
  akan membuat `@xterm/xterm` benar-benar berpindah ke buffer alternatifnya di browser — perubahan
  perilaku render dan scrollback yang jauh lebih besar daripada bug yang sedang diperbaiki.
- **Menyentuh arah keluar SPEC-812** (`COALESCE_MS`, `COALESCE_MAX_BYTES`, `perMessageDeflate`,
  `MAX_SCROLLBACK`, `SCROLLBACK_SLACK`) maupun `stripTerminalQueries` SPEC-860.
- **Mempercepat poll.** 500 ms tetap; konsekuensinya diakui di §Batas.

## Batas yang diakui

- **Transisi alternate screen terlambat ≤ 500 ms**, sebesar periode poll. Selama jendela itu satu
  huruf bergaris bawah bisa tergambar di dalam TUI layar penuh; ia di-rollback oleh byte server
  pertama yang datang (dan TUI layar penuh menggambar ulang pada setiap tombol), atau oleh TTL
  500 ms bila tak ada byte sama sekali. Invarian keselamatan tak berubah — layar sesudah setiap
  frame server tetap byte-identik dengan layar tanpa prediksi.
- **TUI di pane pada harness adalah tiruan**, berdasar bentuk repaint yang diukur SPEC-856. Yang
  menentukan akar masalah adalah lapisan tmux ↔ klien, dan lapisan itu identik untuk program apa
  pun di dalam pane. `#{alternate_on}` TUI `claude` sungguhan tetap diukur langsung (Temuan 3).
- **Server lama + klien baru** (atau sebaliknya) tak pernah terjadi pada paket npm global — keduanya
  satu artefak. Bila toh terjadi, klien baru tanpa frame `alt` berjalan dengan `altScreen: false`
  dan klien lama mengabaikan frame yang tak dikenalnya; keduanya gagal ke arah "seperti sekarang",
  bukan ke arah rusak.
- **`?1049h` 0× / `?47h` 1×** milik audit SPEC-856 tak bisa direproduksi dan sebabnya tak ditemukan.
  Kesimpulan dokumen ini tidak bergantung padanya.
- **`codex`** tak bisa diukur di mesin ini (biner `ENOENT`).

## Verifikasi

Empat lapis, semuanya dengan `tmux capture-pane` sebagai kebenaran.

**1. Harness ujung-ke-ujung, angka diukur ulang** (bukan disalin dari SPEC-856). Sama persis
setelan §Cara mengukur, `hello` diketik satu huruf per 320 ms:

| lengan | `altScreen` saat attach | frame `alt` | tulis lokal | median keydown→glyph | teks muncul | layar = `capture-pane` |
| --- | --- | --- | --- | --- | --- | --- |
| **sebelum**, RTT 200 ms, predict on | true | — | 0 | 225,5 ms | 1× | ya |
| **sebelum**, RTT 200 ms, predict off | true | — | 0 | 225,8 ms | 1× | ya |
| **sesudah**, RTT 200 ms, predict on | **false** | `[false]` | 5 | **0,6 ms** | 1× | ya |
| **sesudah**, RTT 200 ms, predict off | false | `[false]` | 0 | 225,3 ms | 1× | ya |
| **sesudah**, localhost, predict on | false | `[false]` | 5 | **0,4 ms** | 1× | ya |
| **sesudah**, localhost, predict off | false | `[false]` | 0 | 21,0 ms | 1× | ya |

**225,3 ms → 0,6 ms** lewat RTT 200 ms; **21,0 ms → 0,4 ms** di localhost. Invarian keselamatan
SPEC-856 utuh di **setiap** lengan: layar klien identik `capture-pane`, teks muncul persis 1×.

**2. Gerbang tidak melemah.** Lengan yang sama dengan pane yang benar-benar di alternate screen:

| lengan | `altScreen` saat attach | frame `alt` | tulis lokal | median |
| --- | --- | --- | --- | --- |
| alt screen, predict on | **true** | `[true]` | **0** | 225,7 ms |
| alt screen, predict off | true | `[true]` | 0 | 226,6 ms |

Nol tulis lokal dan latensi sama dengan prediksi mati — alternate screen sungguhan tetap menolak
segalanya.

**3. Smoke server sungguhan** (`node --import tsx src/server.ts`, HOME + DB + socket tmux khusus,
HTTP + WS bertiket lewat `POST /ws-tickets` + cookie sesi):

```
attach          → frame alt: [false]              | tmux alternate_on: 0
pane masuk alt  → frame alt: [false,true]         | tmux alternate_on: 1
pane keluar alt → frame alt: [false,true,false]   | tmux alternate_on: 0
byte data: 1452 | ?1049h di aliran: 1 (handshake tmux) | ?1049l: 0
```

Frame mengikuti pane di kedua arah, dan hitungan `?1049h` **tetap 1** sesudah pane dua kali
berpindah — bukti hidup bahwa yang ada di aliran memang cuma handshake tmux.

**4. Test.** `server/test/pty-altscreen.test.ts` 3/3 dan `server/test/pty.test.ts` 56/56 +
`custom-agents.pty.test.ts` 13/13 (**72/72**) dengan tmux nyata; `src/test/terminal-predict.test.ts`
48/48 dan seluruh test yang menyentuh `TerminalPane.tsx`/`terminal-predict.ts` **250/250** (27
berkas). `pnpm --filter ./server typecheck` dan `--filter ./src typecheck` bersih.

Dua gagal-palsu lingkungan dipisahkan dengan kontrol, bukan diasumsikan:

- Test `src/**` di **Node 25.6.1** gagal 100 % dengan `localStorage.clear is not a function` (Node
  25 memasang global `localStorage` yang menang atas milik jsdom). Dijalankan dengan node 24:
  250/250 lulus.
- `terminal.route.test.ts` punya **9 kegagalan**; kontrol bedah — `server/src/services/pty.ts`
  diganti versi base SHA lalu berkas yang sama dijalankan — memberi **9 kegagalan yang identik**
  (prompt/argv & breakdown, 7 timeout + 2 `400`). Pra-ada, bukan milik SPEC-863. Test route lain
  hanya hijau dengan `env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR
  -u DATABASE_URL NODE_ENV=test`.

## Test yang mengunci

- `src/test/terminal-predict.test.ts` — **frame handshake attach tmux nyata** sebagai fixture tidak
  menyalakan `altScreen`; `onServerData` tak memindai satu pun mode DEC; `onPaneAltScreen`
  menyalakan/memadamkan dan **tidak** menyentuh `pending`; aliran tak bisa mematikan sinyal pane.
- `server/test/pty-altscreen.test.ts` — tmux **sungguhan**: frame mengikuti pane masuk lalu keluar
  alternate screen; klien baru langsung menerima keadaan yang berlaku; dan kontrol negatif inti —
  byte `?1049` yang benar-benar ditulis program ke pty **tak pernah** muncul di aliran klien.
