# ADR-0133 — Keadaan pane datang dari tmux, bukan dari aliran byte klien

Status: accepted · 2026-08-20

## Konteks

Echo prediktif SPEC-856 mematikan dirinya di alternate screen. Alasannya sah: rollback
`\x1b[<n>D\x1b[K` bersandar pada ekor baris di kanan kursor yang kosong, dan di layar alternatif
sebuah tombol jarang berarti "sisipkan karakter di kursor" — memprediksinya berarti menggambar
glyph yang tak pernah diminta program.

Gerbang itu dibangun dengan memindai mode DEC dari aliran byte yang tiba di klien
(`scanAltScreen`, `?1049h/l` dan `?1047h/l`). Premisnya: aliran itu memberi tahu apa yang sedang
dilakukan program di dalam pane. **Premis itu salah di bawah tmux**, dan SPEC-863 mengukurnya:

1. **`?1049h` yang sampai ke klien selalu milik tmux sendiri.** Ia `smcup` terminfo yang dikirim
   klien tmux saat attach — byte **pertama** aliran (`\e[?1049h\e[22;0;0t…`) — dan pasangan
   `rmcup`-nya baru dikirim saat **detach**, yaitu ketika klien itu sudah dibunuh. Selama umur
   sebuah sambungan WebSocket, `?1049h` karena itu **selalu tanpa pasangan**.
2. **`?1049h/l` milik program di dalam pane tak pernah diteruskan.** Kontrol positif: program yang
   masuk lalu keluar alternate screen menggerakkan `#{alternate_on}` `0 → 1 → 0`, sementara
   hitungan di klien tak bergerak sama sekali (`?1049h` tetap 1, `?1049l` tetap 0). tmux
   mengemulasi terminal pane dan menggambar ulang sendiri; keadaan itu internal miliknya.

Keduanya diukur **identik** pada tmux **3.4**, **3.5a**, dan **3.7b** — jadi ini bukan regresi versi
melainkan sifat tmux, dan bentuk sekuens yang muncul di kawat adalah fungsi terminfo klien
(`vt100`/`ansi` tanpa `smcup` tak melahirkan `?1049h` sama sekali).

Akibatnya gerbang alt-screen berbasis aliran hanya bisa **salah-positif**, tak pernah
benar-positif. Terukur di jalur nyata (tmux + node-pty + `@xterm/xterm` 6 asli + Chrome headless,
RTT 200 ms disuntik di jembatan): `altScreen: true` sejak frame pertama, **nol** tulis lokal, dan
`predict=1` tak bisa dibedakan dari `predict=0` (**225,5 ms** vs **225,8 ms**). Fitur yang dibayar
penuh berjalan **inert**, tanpa satu pun galat, log, atau tanda di UI.

Mencabut `?1049` dari daftar tidak memperbaikinya: gerbangnya lalu **tak pernah menyala**, dan
prediksi hidup juga di dalam `vim`.

## Keputusan

**Keadaan pane yang tak bisa diturunkan dari aliran byte diambil dari tmux dan dikirim sebagai
frame WebSocket tersendiri.**

1. `FMT` milik `listPanes()` bertambah `#{alternate_on}` → `Pane.altScreen`. Loop poll 500 ms yang
   sudah ada (satu `tmux list-panes -a` untuk seluruh sesi terbuka) menjadi satu-satunya sumbernya;
   **tak ada invokasi tmux tambahan**.
2. Kontrak frame terminal bertambah satu varian: **`{ t: "alt"; on: boolean }`**. Ia lahir saat
   berubah (dedup `lastAlt`, cermin `lastPhases`) dan **sekali ke setiap klien baru di `attach()`**
   — siaran-saat-berubah saja tak akan pernah sampai ke klien yang mendarat di tengah keadaan yang
   tak berubah lagi (pelajaran yang sama dengan pil "Selesai" SPEC-433).
3. Klien mencabut `scanAltScreen()` dan daftar `ALT_ON`/`ALT_OFF` sepenuhnya. `onServerData` tak
   lagi memindai mode DEC; satu-satunya jalan masuk adalah `onPaneAltScreen(state, on)`, setter
   murni yang **tidak** menyentuh `pending` — rollback tetap milik dua jalur yang sudah ada (byte
   server berikutnya, atau TTL), dan mengosongkannya di sini akan meninggalkan glyph tanpa pemilik.

Aturan umumnya, dan itulah yang dipertaruhkan ADR ini:

> Aliran byte klien tmux adalah **gambar**, bukan laporan keadaan. Apa pun yang perlu diketahui
> klien tentang **pane** — bukan tentang piksel — datang dari tmux lewat frame, tidak ditebak dari
> sekuens escape.

`?1049h` yang tetap lewat di aliran **tidak** dibuang: ia sah bagi `@xterm/xterm` sebagai instruksi
gambar, dan menyunatnya adalah perubahan render yang jauh lebih besar daripada bug yang diperbaiki.

## Konsekuensi

- Echo prediktif SPEC-856 hidup kembali di layar kerja biasa. Diukur ulang di jalur nyata, bukan
  disalin: keydown→glyph **225,3 ms → 0,6 ms** pada RTT 200 ms, **21,0 ms → 0,4 ms** di localhost.
- Gerbangnya **tidak** melemah: pane yang benar-benar di alternate screen tetap menolak segalanya
  (terukur: `altScreen` true sejak attach, **0** tulis lokal, latensi sama dengan prediksi mati).
- Invarian keselamatan SPEC-856 tak tersentuh — layar klien identik `tmux capture-pane` dan teks
  muncul persis 1× di setiap lengan.
- **Transisi alternate screen terlambat ≤ 500 ms**, sebesar periode poll. Selama jendela itu satu
  huruf bergaris bawah bisa tergambar di dalam TUI layar penuh; ia dilepas oleh byte server pertama
  yang datang (TUI layar penuh menggambar ulang pada setiap tombol) atau oleh TTL 500 ms. Harganya
  dibayar sadar: mempercepat poll membebani seluruh sesi terbuka demi jendela yang sudah pendek.
- Menegakkan [ADR-0016](0016-sesi-terminal-hidup-di-tmux.md) (tmux pemilik keadaan sesi) dan
  [ADR-0014](0014-pty-terminal-di-proses-api.md); **tidak** menyentuh
  [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md), skema, endpoint, maupun arah keluar SPEC-812.
- Klien lama mengabaikan varian frame yang tak dikenalnya; klien baru tanpa frame `alt` berjalan
  dengan `altScreen: false`. Keduanya gagal ke arah "seperti sebelum ADR ini", bukan ke arah rusak —
  dan pada paket npm global keduanya satu artefak, jadi tak pernah terpisah.

## Alternatif yang ditolak

- **Mencabut `?1049` dari `ALT_ON`/`ALT_OFF`.** Terukur salah: gerbangnya lalu tak pernah menyala,
  prediksi hidup juga di `vim`. Ini menukar bug diam dengan bug yang merusak layar.
- **Membuang `?1049h` milik tmux dari aliran di server.** Menghilangkan gejalanya tanpa memberi
  klien satu pun cara mengetahui alternate screen pane — hasil akhirnya sama dengan di atas.
- **Menyuntikkan `?1049h`/`l` sintetis sebagai terjemahan `#{alternate_on}`.** Menjaga kontrak frame
  tetap utuh, tetapi membuat `@xterm/xterm` benar-benar berpindah ke buffer alternatifnya di
  browser — mengubah render dan scrollback jauh melampaui perbaikan ini.
- **Menggantungkan gerbang pada nama program di pane** (claude/codex/vim). Ditolak SPEC-856 dan
  tetap ditolak: gerbangnya perilaku terukur, bukan daftar nama. `#{alternate_on}` justru bentuk
  paling murni dari prinsip itu.
- **Mode kontrol tmux (`-CC`)** sebagai kanal notifikasi keadaan. Memberi peristiwa alih-alih poll,
  tetapi mengganti seluruh cara `pty.ts` berbicara dengan tmux demi satu boolean.
