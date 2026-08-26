# ADR-0156 — Entri tersembunyi di Explorer: toggle, direktori terabaikan diruntuhkan, isi dimuat per tingkat

- Status: Accepted
- Tanggal: 2026-08-26
- SPEC: —
- Terkait: **memperluas** [0121](0121-operasi-berkas-ide-explorer.md) (penjaga path & capability
  `ide` yang diturunkan dari METHOD dipakai apa adanya — tak ada domain capability baru),
  [0034](0034-ide-mutasi-working-tree-utama.md) (pohon Explorer dibangun klien dari daftar path datar),
  [0115](0115-state-tampilan-dashboard-persisten.md) (togglenya state tampilan per project).
  **Tidak mencabut apa pun.** Tanpa migration, tanpa kolom.

## Konteks

`GET /projects/:id/tree` memakai `git ls-files --cached --others --exclude-standard`. Flag terakhir
itu berarti apa pun yang `.gitignore` sembunyikan **tak pernah** terlihat dari Explorer: `.env`,
berkas basis data lokal, keluaran build, dan `.worktrees/**` — justru tempat kerja agen hanoman
sendiri berlangsung. Satu-satunya cara membacanya adalah terminal.

Melepas `--exclude-standard` saja bukan jawabannya. Terukur di repo ini: entri terabaikan berjumlah
**22 686 berkas, 2,0 MB path** — hampir seluruhnya `node_modules`. Satu klik toggle akan mengirim
semuanya ke browser setiap kali, dan `maxBuffer` git yang terlampaui dijawab `catch` sebagai pohon
**kosong** — gagal senyap, bukan pesan galat.

## Keputusan

1. **Toggle, bukan default.** `hidden=1` (dan tombol "Tersembunyi" di Explorer) opt-in, persisten
   per project. Mati → balasan identik dengan sebelumnya, sampai ke bentuk arraynya.
2. **Direktori yang seluruhnya diabaikan DIRUNTUHKAN.**
   `git ls-files --others --ignored --exclude-standard --directory --no-empty-directory` menjawab
   satu nama untuk `node_modules`, bukan isinya. Di repo ini: **8 entri, 111 KB** menggantikan
   22 686 / 2,0 MB. Nama-nama itu masuk `dirs` — terpisah dari `files` karena pohon dibangun dari
   path datar dan tanpa daftar tersendiri "dist" berbentuk persis seperti berkas bernama `dist`.
3. **Isinya dimuat satu tingkat per klik.** `under=<dir>` menjawab isi langsung sebuah direktori
   lewat `readdir`, bukan git: apa pun di dalam direktori terabaikan juga terabaikan, jadi git tak
   punya jawaban yang lebih baik, dan `readdir` tak pernah melebar melampaui satu tingkat.
   Penjaga path-nya `repoAbsPath` yang sama dengan endpoint berkas → 400 untuk keluar repo/`.git`.
4. **Bersama `ref`, flag-nya diabaikan.** Sebuah commit tak pernah memuat berkas terabaikan; toggle
   di UI mati saat sedang melihat ref, bukan diam-diam menjawab daftar yang sama.
5. **`ignored` menamai entri terabaikan** supaya UI meredupkannya. Tanpa itu toggle terbaca sebagai
   daftar yang tiba-tiba memanjang tanpa sebab.

## Konsekuensi

- Balasan `/tree` bertambah tiga field opsional; klien lama yang hanya membaca `files` tak berubah.
- Direktori terabaikan yang besar tetap bisa ditelusuri, tapi biayanya dibayar per klik, bukan di
  muka. Tak ada satu balasan pun yang tumbuh sebanding dengan `node_modules`.
- `listDirEntries` memotong di 5 000 entri per tingkat dan menandainya `truncated` — batas yang
  disebut, bukan pemotongan senyap.
- Tool MCP `hanoman_ide_tree` ikut menerima `hidden` & `under` (capability `ide:read`, tak berubah).
