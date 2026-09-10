# ADR-0163 — Tab Worktrees: hanya checkout utama yang dikecualikan dari hapus, bukan lagi seluruh isi di luar `.worktrees`

- Status: Accepted
- Tanggal: 2026-09-10
- SPEC: SPEC-1150
- Mengamandemen: [0132](0132-permukaan-penghapusan-worktree.md) §3 & butir terakhir Konsekuensi
  (gerbang `deletable` di `GET|POST /projects/:id/worktrees*`), dan
  [0162](0162-pemungutan-worktree-yatim-dengan-konfirmasi.md) (paragraf yang mengecualikan
  checkout non-kanonik "karena kepemilikannya tidak terbukti"). **Tidak menyentuh** gerbang
  `ownsWorktree()` itu sendiri — `session-close.ts` (SPEC-362) dan `spec-reset.ts` tetap
  memakainya apa adanya untuk pelepasan worktree OTOMATIS saat sesi ditutup/spec direset.

## Konteks

ADR-0132 memakai `ownsWorktree(repoDir, path)` sebagai satu-satunya gerbang `deletable` di
tab Worktrees: hanya worktree yang path-nya benar-benar DI DALAM `<repoDir>/.worktrees/` yang
bisa dicentang & dihapus. Predikat itu ditulis untuk kelas masalah lain — SPEC-362, pelepasan
worktree OTOMATIS saat sesi ditutup — dan sengaja sempit di sana: sesi ditutup tanpa operator
memilih baris mana pun, jadi gerbangnya harus membuktikan hanoman sendiri yang membuat
direktori itu sebelum melepasnya.

Dipakai ulang sebagai gerbang tab Worktrees, predikat yang sama punya efek samping yang tak
diinginkan: worktree yang dibuat manual lewat `git worktree add` DI LUAR
`<repoDir>/.worktrees/` — checkout topik lama, eksperimen operator, apa pun yang terdaftar sah
di git — ikut tertolak `deletable:false` dengan alasan `"di luar .worktrees project ini"`.
ADR-0162 bahkan mendokumentasikan ini sebagai keputusan sadar ("kepemilikannya tidak
terbukti"). Operator yang ingin membersihkannya harus turun ke terminal (`git worktree
remove` manual) — persis kebuntuan yang ADR-0132 dibuat untuk menutup di sisi branch/worktree
lain.

Tab Worktrees BUKAN pelepasan otomatis: setiap baris dicentang eksplisit oleh operator, lewat
dialog `useConfirm` + `impact[]` (ADR-0127) yang menyebut sesi yang ikut ditutup, commit yang
akan hilang, dan berkas belum tersimpan. Kelas risiko yang membenarkan gerbang sempit
`ownsWorktree` di SPEC-362 (pelepasan tanpa pilihan operator) tidak berlaku di sini.

## Keputusan

`deletable` di tab Worktrees tidak lagi dihitung dari `ownsWorktree()`. Satu-satunya baris
yang dikecualikan adalah **checkout utama repo** — dan itu diuji dari DUA sisi sekaligus,
bukan satu:

1. `path === baseReal` — `repoDir` project itu sendiri (kasus normal, sama seperti sebelumnya).
2. `path === mainPath` — baris **pertama** yang dipancarkan `git worktree list --porcelain`.

Poin kedua bukan hiasan. `git worktree list --porcelain` SELALU memancarkan working tree
utama sebagai baris pertama, **apa pun cwd pemanggilnya** — diverifikasi langsung (git 2.x):
menjalankannya dari checkout utama, dari worktree tertaut mana pun, hasilnya identik, working
tree utama selalu di posisi pertama. Ini sinyal dari STRUKTUR REPO git itu sendiri, independen
dari `repoDir` yang di-bind project di DB hanoman.

Bedanya kentara justru pada skenario yang memotivasi `ownsWorktree` semula: hanoman
didogfood di dalam worktree-nya sendiri, sehingga sebuah project bisa ter-bind ke checkout
yang berada DI BAWAH `.worktrees/` milik repo lain (§Konteks ADR-0132). Pada skenario itu,
`baseReal` (checkout yang di-bind) BUKAN working tree utama yang sesungguhnya — dan
`git worktree list` yang dijalankan dari sana tetap mendaftar working tree utama sebagai
baris lain. `path !== baseReal` saja akan meloloskan working tree utama itu sebagai
`deletable:true` — kelas insiden PERSIS SPEC-362, hanya berpindah baris. Mengecualikan
`mainPath` di samping `baseReal` menutup lubang itu: keduanya dikecualikan, worktree LAIN di
repo tersebut (yang benar-benar bukan checkout mana pun) boleh dihapus.

`blocked` disederhanakan jadi `deletable ? null : "checkout project"` — cabang
`"di luar .worktrees project ini"` dihapus, tak ada lagi yang menghasilkannya.

`ownsWorktree()` (`server/src/services/session-worktree.ts`) tidak diubah sama sekali dan
tetap dipakai `session-close.ts` & `spec-reset.ts` — dua jalur yang melepas worktree TANPA
konfirmasi per-baris operator, di mana kesempitannya masih tepat.

## Konsekuensi

- Worktree yang dibuat manual di luar `.worktrees/` kini terlihat, bisa dicentang lewat
  checkbox baris atau "Pilih semua yang boleh", dan terhapus lewat jalur yang sama dengan
  worktree biasa (rename ke `.trash`, `git worktree prune`, opsional hapus branch).
- Pada instance dogfood yang project-nya ter-bind ke checkout DI BAWAH `.worktrees/`: checkout
  yang di-bind DAN working tree utama yang sesungguhnya tetap `deletable:false` (dua baris,
  bukan nol seperti sebelumnya) — worktree lain di repo itu kini boleh dihapus. Butir
  Konsekuensi ADR-0132 yang menyebut "tak ada baris yang deletable" pada skenario ini sudah
  tidak berlaku; digantikan uraian di atas.
- Paragraf ADR-0162 tentang checkout non-kanonik yang "tidak ditemukan pembuatnya" dan karena
  itu dikecualikan pemindahannya sudah tidak berlaku untuk gerbang `deletable` tab Worktrees —
  keberadaannya di git terdaftar cukup, dan `mainPath`/`baseReal` sudah menjaga satu-satunya
  path yang benar-benar berbahaya untuk dipindah.
- Operasi git level (`trashWorktree`/`removeWorktree`, `runner/src/git.ts`) tetap menolak keras
  bila `target === repo` — lapisan pertahanan kedua yang tak berubah dan tak bergantung pada
  gerbang `deletable` di atasnya.
- Nol kolom, nol migration, nol endpoint baru. `WorktreeView` DTO tak berubah bentuk (`blocked`
  sudah `string | null` bebas isi).

## Gotcha terukur

**`git worktree list --porcelain` selalu menaruh working tree utama di baris pertama, apa pun
cwd pemanggilnya.** Diverifikasi git 2.x: dijalankan dari checkout utama, dari
`.worktrees/spec-1`, maupun dari `.worktrees/wt-feat` yang lain, urutan barisnya identik —
utama selalu pertama, sisanya menyusul dalam urutan penambahan. Ini yang membuat `mainPath`
bisa dipakai sebagai sinyal aman tanpa perlu menandai baris secara eksplisit di
`parseWorktreePorcelain` (porcelain sendiri tak punya penanda "ini yang utama").
