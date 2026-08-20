# Audit SPEC-860 — karakter liar muncul sendiri di terminal sesi

**Sumber:** backlog SPEC-860 (qa, prioritas tinggi) · hanoman 0.1.52
**Keputusan:** Spec & Plan **skipped** — akar tunggal, terbukti terukur, diff kecil dan seluruhnya di
`server/src/services/pty.ts` + satu titik plumbing di `routes/terminal.ts`. Dokumen ini doc-of-record
perbaikannya. Tanpa ADR baru: tak ada tipe frame WS baru, kolom, endpoint, maupun skema — ADR-0014,
ADR-0016, ADR-0117 **ditegakkan**, dan preseden bentuknya audit SPEC-856 (perbaikan perilaku, audit
sebagai doc-of-record).

## Ringkasan

Karakter yang muncul sendiri di baris prompt agen **bukan** echo prediktif dan bukan glyph yang hanya
ada di klien. Ia **balasan pertanyaan terminal milik xterm.js yang benar-benar diketikkan ke pty** —
`\x1b[?1;2c` (Device Attributes 1) dan `\x1b[>0;276;0c` (DA2), yang di layar agen tampil sebagai
`[?1;2c[>0;276;0c`.

Sebabnya satu kalimat:

> `attach()` memutar ulang **aliran byte mentah** pty ke setiap klien WebSocket baru, dan aliran itu
> memuat **pertanyaan** yang dikirim tmux saat handshake attach. Klien baru menjawab pertanyaan lama;
> tmux sudah lewat handshake-nya, jadi jawaban itu diteruskan apa adanya ke pane — sebagai ketikan.

Satu salinan per attach, dan **menumpuk**. Setiap reconnect WS (jaringan seluler, revalidasi
principal 60 dtk SPEC-800, restart server saat update SPEC-405, refresh tab, perangkat kedua)
menambah satu.

Premis "glyph yang tidak ada di pty" pada brief **terbalik**: byte-nya justru ADA di pty —
`capture-pane` memperlihatkannya. Yang tidak pernah ada adalah manusia yang mengetiknya.

## Cara mengukur

Harness sekali pakai di scratchpad, tanpa dependensi baru, meniru `server/src/services/pty.ts` apa
adanya: satu klien `tmux attach-session -d` di atas node-pty (`name: "xterm-256color"`), opsi global
identik (`status off`, `prefix None`, `mouse on`, `history-limit 50000`,
`default-terminal screen-256color`, `remain-on-exit`), coalesce keluar **16 ms / 64 KiB** (SPEC-812),
`perMessageDeflate` level 6 memLevel 7, `scrollback` dipotong di `MAX_SCROLLBACK + SCROLLBACK_SLACK`,
dan `attach()` yang memutar ulang scrollback ke klien kedua. Halaman menyajikan **`@xterm/xterm`
6.0.0 asli** + modul **`terminal-predict.ts` asli** (di-bundle esbuild), dirangkai persis seperti
`TerminalPane`. Disetir Chrome 151 headless lewat CDP, throttling tab latar dimatikan.

Program di dalam tmux adalah tiruan TUI agen dengan bentuk repaint yang **diukur** di audit SPEC-856
(`\x1b[H` … `\x1b[8;1H❯ <buf>\x1b[K` … `\x1b[8;<n>H`, penempatan absolut, `\x1b[K` mengosongkan ekor
baris) — TUI claude sungguhan sengaja tidak dipakai: men-spawn `claude` untuk smoke memakai langganan
pengguna dan menaruh agen otonom di working tree.

Bukti yang dituntut brief — `tmux capture-pane` vs layar klien pada sesi yang sama — diambil di
setiap langkah.

## Temuan 1 — akarnya replay scrollback yang MENGULANG PERTANYAAN

Empat attach berurutan, **nol tombol ditekan**, baris prompt dibaca dari `capture-pane -p -J`:

| attach ke- | baris prompt di pty |
| --- | --- |
| — (belum ada klien) | `❯ ` |
| 1 | `❯ ` |
| 2 | `❯ [?1;2c[>0;276;0c` |
| 3 | `❯ [?1;2c[>0;276;0c[?1;2c[>0;276;0c` |

Attach #1 bersih karena pertanyaan tmux tiba **hidup** dan tmux memang sedang menunggu jawabannya
(`TTY_HAVEDA` belum terpasang). Sejak attach #2 pertanyaan yang sama datang dari **scrollback** —
tmux tak lagi menunggu, jadi jawabannya lewat ke pane.

Frame `t:"in"` yang dikirim klien per attach, tanpa satu tombol pun disentuh:

```
IN "[?1;2c"                              ← DA1
IN "[>0;276;0c"                          ← DA2
IN "]10;rgb:ffff/ffff/ffff\\"      ← OSC 10 (warna teks)
IN "]11;rgb:0000/0000/0000\\"      ← OSC 11 (warna latar)
```

Empat, kali jumlah attach. Yang lolos ke pane adalah dua DA — tmux menanyakan warna **setiap** attach
sehingga jawaban OSC-nya masih ditunggu dan tertelan; DA hanya ditanyakan sekali seumur klien tmux.

**Kontrol positif.** Dengan pertanyaan dibuang dari replay (hanya replay; aliran hidup tak disentuh),
**empat** attach berurutan: prompt tetap `❯ ` di keempatnya, dan jumlah frame `t:"in"` yang lahir
tanpa ketikan **0**.

## Kontrol negatif — echo prediktif TIDAK bersalah

Brief menuntut ini dites lebih dulu, bukan diasumsikan. Skenario identik dengan `?predict=0`:

| attach ke- | `predict=1` | `predict=0` |
| --- | --- | --- |
| 1 | `❯ ` | `❯ ` |
| 2 | `❯ [?1;2c[>0;276;0c` | `❯ [?1;2c[>0;276;0c` |
| 3 | `❯ …[?1;2c[>0;276;0c` (2×) | `❯ …[?1;2c[>0;276;0c` (2×) |

**Identik.** Dan pada skenario yang persis seperti langkah reproduksi brief — pane terbuka 10 detik
tanpa satu tombol pun disentuh, TUI terus repaint — layar klien **identik dengan `capture-pane` di
setiap sampel**, sementara daftar tulis lokal klien (`applySeq`/`rollbackSeq`, satu-satunya glyph
yang bisa dilahirkan prediksi) **kosong**:

```
== IDLE t+2s … t+10s == pred={"pending":"","since":null,"altScreen":true,"suspendedUntil":0}
   layar klien IDENTIK dengan capture-pane
localWrites: []
```

Itu memang harus begitu: `pending` hanya bisa terisi lewat `onInput` (butuh `term.onData`) dan
`reapply` (butuh `pending`). Tanpa ketikan, modul prediksi **inert secara struktural**. `reapply`,
TTL `setInterval`, dan penanda SGR `\x1b[4m`/`\x1b[24m` yang disebut brief semuanya tak pernah
dijalankan pada jalur ini. **Prediksi tidak dicabut** — SPEC-856 tetap utuh.

## Temuan 2 — cabang kedua: setiap penonton menjawab, jawabannya berlipat

tmux **meneruskan** sebagian pertanyaan program ke terminal luar (terukur sampai ke klien:
`\x1b[18t`, `\x1b[14t`, `\x1b]4;1;?`). Karena satu attachment menyiarkan ke **semua** klien, setiap
klien menjawab. Program hanya membaca satu; sisanya jadi ketikan.

Diukur dengan program yang bertanya `\x1b]4;1;?` tiap 3 detik, replay sudah dibersihkan:

| penonton | frame balasan per klien |
| --- | --- |
| 1 klien | c1: 7 |
| 2 klien | c1: 7 · **c2: 7** |

Aliran pertanyaan yang sama, jawaban **dua kali lipat**. Ini tak butuh reconnect sama sekali —
cukup satu sesi dibuka di ponsel **dan** desktop, persis situasi yang dilaporkan.

## Inventaris — pertanyaan apa saja yang sampai ke klien

Dari dump kawat (36 sekuens unik). Yang **bertanya**:

| sekuens | asal | dijawab xterm.js 6.0.0? |
| --- | --- | --- |
| `\x1b[c` (DA1) | handshake attach tmux | **ya** → `\x1b[?1;2c` |
| `\x1b[>c` (DA2) | handshake attach tmux | **ya** → `\x1b[>0;276;0c` |
| `\x1b[>q` (XTVERSION) | handshake attach tmux | tidak |
| `\x1b[?996n` (skema warna) | handshake attach tmux | tidak |
| `\x1b]10;?` / `\x1b]11;?` | handshake attach tmux | **ya** → `rgb:…` |
| `\x1b]4;<n>;?` | program di pane (diteruskan tmux) | **ya** → `rgb:…` |
| `\x1b[18t` / `\x1b[14t` | program di pane (diteruskan tmux) | tidak |

Yang **tidak** dijawab hari ini tetap dibuang dari replay: yang menentukan bukan versi xterm yang
kebetulan terpasang, melainkan bahwa **replay adalah gambar, bukan percakapan**.

## Temuan sampingan (di luar scope SPEC-860, wajib dicatat)

**Echo prediktif SPEC-856 saat ini mati total di mesin ini** — dan diam-diam. tmux 3.7b membuka
handshake attach dengan `\x1b[?1049h` (`smcup`) dan tak pernah mengirim pasangan `l`-nya:

```
head: "[?1049h[22;0;0t[?1h=[H[2J…"
?1049h 1 · ?1049l 0 · ?1047h 0 · ?47h 0 · ?2004h 1
```

`scanAltScreen` membaca `?1049h` sebagai alternate screen — benar menurut kontraknya — sehingga
`canPredict` menolak segalanya sejak frame pertama (`altScreen: true` di setiap sampel di atas).
Audit SPEC-856 mengukur `?1049h` **0 kali**; yang berubah tmux-nya, bukan kodenya. Ini membuat
prediksi inert, **bukan** salah, jadi ia tak menyebabkan SPEC-860 dan **tidak diperbaiki di sini** —
mengaktifkan kembali sebuah fitur adalah perubahan perilaku tersendiri yang butuh pengukuran
ulang (SPEC-856 mematok keydown→glyph 242,1 → 2,7 ms sebagai buktinya). Layak jadi backlog sendiri.

## Perbaikan

Seluruhnya di server; `src/**` tak disentuh.

1. **`stripTerminalQueries()`** — fungsi murni di `server/src/services/pty.ts`, dipakai **hanya pada
   replay** `attach()`. Aliran hidup tidak disentuh: di sanalah tmux memang sedang menunggu jawaban,
   dan attach #1 terbukti bersih. Dipasang di replay pane hidup **dan** replay pane mati.
2. **Satu penjawab per attachment.** `writeTo()` menerima klien pengirim; frame yang isinya
   **seluruhnya** balasan terminal hanya diteruskan bila pengirimnya klien pertama attachment itu.
   Ketikan manusia tak pernah tersentuh gerbang ini — bentuk balasan (`…c`, `…R`, `…n`, `…$y`,
   `\x1b]…;rgb:…`, DCS `…\x1b\\`) tak beririsan dengan sekuens tombol (`\x1b[A`, `\x1bOA`, `\r`, …).
   Klien pertama pergi → klien berikutnya jadi penjawab.

Biaya replay: satu pemindaian regex atas scrollback (≤ 256 KiB) **per attach**, bukan per chunk —
sengaja tidak dipasang di `flushOutput`, karena di sanalah SPEC-812 mengukur 178 µs/chunk sebagai
masalah nyata.

## Yang sengaja TIDAK dikerjakan

- **Membuang pertanyaan dari aliran hidup juga.** Itu akan menghapus jawaban yang tmux tunggu di
  attach pertama dan menurunkan deteksi fitur tmux (mis. RGB) ke terminfo `xterm-256color`.
  Hari ini sesi tanpa penonton memang berjalan tanpa jawaban, tetapi membuat semua sesi begitu
  adalah perubahan perilaku, bukan perbaikan bug.
- **Mencabut atau menyunat echo prediktif.** Terbukti bukan penyebabnya; SPEC-856 mematok angkanya
  dan mencabutnya butuh ADR.
- **Menyentuh arah keluar SPEC-812.** `COALESCE_MS`, `COALESCE_MAX_BYTES`, `perMessageDeflate`,
  `MAX_SCROLLBACK`, `SCROLLBACK_SLACK` tak diubah.
- **Menghidupkan kembali prediksi di bawah tmux 3.7b** (lihat temuan sampingan).

## Batas yang diakui

- TUI agen di harness adalah **tiruan** berdasar bentuk repaint yang diukur SPEC-856, bukan `claude`
  sungguhan. Yang menentukan akar masalah adalah lapisan tmux ↔ klien, dan lapisan itu identik untuk
  program apa pun di dalam pane.
- Berapa banyak salinan yang menumpuk di sesi produksi adalah fungsi jumlah reconnect, bukan angka
  tetap.
- Nilai balasan (`\x1b[>0;276;0c`) khas xterm.js 6.0.0; bentuknya, bukan angkanya, yang dipagari test.

## Verifikasi

Tiga lapis, semuanya dengan `capture-pane` sebagai kebenaran:

1. **Harness** (tmux + xterm 6 asli + Chrome headless), regex yang BENAR-BENAR dikirim diekstrak
   mekanis dari `pty.ts`: **empat** attach berurutan, nol tombol ditekan → baris prompt tetap `❯ `
   di keempatnya dan **0** frame `t:"in"` lahir. Sebelum perbaikan: `❯ [?1;2c[>0;276;0c` di attach
   #2, dua kali lipat di #3.
2. **Regresi ketik** di harness yang sama: ketik lalu diam 8 detik sementara TUI terus repaint →
   layar klien identik `capture-pane` di setiap sampel, tulis lokal klien kosong.
3. **Smoke server sungguhan** (`tsx src/server.ts`, HOME + DB + socket tmux khusus, HTTP + WS
   bertiket): replay klien kedua **657 byte, nol pertanyaan**; balasan penonton **tak sampai** ke
   pty sementara penanda sesudahnya sampai (urutan terbukti, bukan sekadar belum tiba); balasan
   penjawab **sampai**. `capture-pane` menutupnya: `["RX[sesudah]","RX[\\e[24;1R]","RX[akhir]"]` —
   tepat SATU balasan di pane, dari penjawab saja.

`server/test/pty.test.ts` 56/56 dan `custom-agents.pty.test.ts` 13/13 hijau;
`terminal.route.test.ts` punya **9 kegagalan yang identik sebelum dan sesudah** perubahan
(pre-existing di base SHA, soal prompt/argv — bukan milik SPEC-860). `pnpm --filter ./server
typecheck` bersih.

## Test yang mengunci

- `server/test/pty-queries.test.ts` — `stripTerminalQueries` atas **inventaris kawat nyata** di atas
  (yang dibuang & yang wajib selamat), `isTerminalResponse` atas balasan terukur vs sekuens tombol,
  dan dua test tingkat attachment: klien kedua tak pernah menerima pertanyaan pada replay, dan
  balasan dari klien non-penjawab tak pernah sampai ke pty.
