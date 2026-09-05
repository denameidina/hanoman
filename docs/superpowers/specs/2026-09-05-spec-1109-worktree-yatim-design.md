# SPEC-1109 — Deteksi dan pemungutan worktree sesi yatim

Source of Truth: [ADR-0162](../../../internal/docs/adr/0162-pemungutan-worktree-yatim-dengan-konfirmasi.md).

## Perilaku

Boot mengenali checkout yatim dari git, riwayat sesi, dan tmux, melaporkan jumlah
yang menunggu operator. Worktrees menampilkan badge “sesi yatim”, ringkasan jumlah,
dan tombol “Pungut yatim”. Dialog konfirmasi menyebut jumlah checkout, berkas kotor,
commit yang tidak dirujuk di tempat lain, ketidakpastian statistik, dan hilangnya
seluruh isi termasuk ignored. Batal mempertahankan semuanya. Persetujuan mengirim
mode `orphanOnly: true` ke endpoint hapus yang sudah ada.

## Arsitektur

`worktree-project.ts` merakit input DB/tmux untuk daftar API dan deteksi boot;
`worktree-list.ts` tetap menerima input/deps, mengklasifikasi yatim, dan mengorkestrasi
pemungutan. History berasal dari pembaca di `session-history.ts`, termasuk baris
tertutup agar riwayat terbaru bisa membatalkan klaim lama. DTO shared dan cermin
client mendapat `orphan?: {historyId, sessionId}`; hitungan statistik menjadi nullable.
`worktree-reaper.ts` menyediakan pelepasan ketat tanpa mengubah domain penyapu.

## Acceptance criteria

1. Ketika history terbaru suatu cwd terbuka atau `reconciled`, dan tmux sukses dibaca
   tanpa id/cwd sesi yang cocok, checkout git itu diberi `orphan`.
2. Ketika ada pane (termasuk exited), cwd dipakai sesi lain atau sesi yang sama pindah
   cwd, atau history terbaru `closed`, checkout tidak ditandai yatim.
3. Deteksi boot membaca history setelah rekonsiliasi dan melaporkan kandidat tanpa
   memindahkan apa pun. Kegagalan tmux tidak dianggap nol sesi.
4. Riwayat `reconciled` dari boot sebelumnya tetap ditemukan; worktree tanpa history
   tidak dianggap yatim. Pencocokan memakai path fisik.
5. Operator melihat dan mengonfirmasi pemungutan di tab Worktrees yang sudah ada.
   Penghapusan normal tetap tersedia dengan kontrak sebelumnya.
6. Mode pemungutan memeriksa ulang kandidat dan tmux per baris sebelum rename. Sesi
   yang muncul kembali, nama ambigu, path non-kanonik, dan checkout project ditolak;
   tidak memanggil closeSession atau menghapus branch.
7. Rename gagal mempertahankan checkout dan melaporkan galat per baris. Rename sukses
   memberi nama cleanup dan menghapus byte hanya lewat reaper `.trash/**` asinkron.
8. Statistik yang gagal dibaca bernilai null dan dialog mengakui dampak tidak
   diketahui. Commit detached tetap dihitung dengan pola rev-list ADR-0132.
9. Test memakai deps injected, fixture git/tmux/DB terisolasi; tidak menyentuh worktree
   operator. Typecheck hanya shared, server, app; smoke endpoint sekali di akhir.

## Batas

Tanpa penghapusan otomatis, skema/migrasi, layar baru, atau penghapusan worktree
operator selama pengembangan. Checkout non-kanonik tetap tampil terblokir: pembuat
`wt-spec-1099` tidak terbukti berasal dari jalur produk saat ini. Bootstrap/boot tidak
menunggu pengukuran `du`; daftar statistik tetap dimuat per baris.
