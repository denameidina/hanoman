# ADR-0162 — Worktree yatim dipungut setelah konfirmasi operator

Status: accepted · 2026-09-05 · SPEC-1109. Kebijakan direkomendasikan sesudah audit dan
disetujui melalui instruksi pengguna untuk melanjutkan. Menegakkan
[0084](0084-melanjutkan-sesi-backlog.md), [0016](0016-sesi-terminal-hidup-di-tmux.md),
[0116](0116-penutupan-sesi-asinkron-worktree-trash.md), dan memperluas
[0132](0132-permukaan-penghapusan-worktree.md).

Boot mendeteksi worktree sesi yatim tetapi **tidak memindahkan atau menghapusnya**.
Operator memungut lewat tab Worktrees yang sudah ada, dengan dialog dampak. Keputusan
ini mempertahankan pekerjaan yang belum diintegrasikan dan kemampuan Lanjutkan.
Menghapus semua yatim ditolak karena crash bukan persetujuan membuang pekerjaan;
“hanya yang bersih” juga ditolak karena status bersih tidak meliputi commit detached
dan berkas ignored.

Yatim adalah checkout terdaftar git yang riwayat terbaru untuk cwd fisiknya masih
terbuka atau berakhir `reconciled`, tanpa pane tmux dengan id sesi yang sama ataupun
cwd di checkout itu. Pane `exited` tetap melindungi checkout: operator masih dapat
membaca hasilnya. History lama yang sudah direkonsiliasi tetap disertakan; riwayat
`closed` yang lebih baru membatalkan klaim yatim dari riwayat lama. Tidak ada tabel,
kolom, cache durable, atau tebakan kepemilikan dari nama direktori.

Deteksi boot membaca tmux sebelum rekonsiliasi history dan sekali lagi ketika
menurunkan laporan worktree. Kegagalan tmux menghentikan deteksi, bukan menjadi
daftar kosong. Boot melaporkan jumlah di log; tab Worktrees menurunkan status dari
sumber yang sama setiap muat ulang. Menghapus history menghilangkan bukti yatim,
tetapi worktree tetap terlihat sebagai checkout biasa yang bisa diperiksa manual.

Dua pagar turunan audit implementasi: snapshot mempertahankan seluruh pane, karena
dua pane dengan cwd sama tetap mempunyai id yang berbeda; error koneksi tmux hanya
berarti nol sesi untuk ENOENT/ECONNREFUSED. EACCES dan EMFILE dilempar di pembaca
sinkron maupun asinkron. Regex lama `error connecting to` saja membacanya sebagai
daftar kosong palsu dan tidak boleh dipakai untuk izin pemungutan.

`POST /projects/:id/worktrees/delete` menerima `orphanOnly: true`. Mode ini
menurunkan ulang kandidat per baris dan membaca ulang tmux tepat sebelum rename,
tanpa await di antara pemeriksaan terakhir dan rename. Sesi yang kembali hidup
menjadi kegagalan per baris, **tidak ditutup**. Mode ini tidak menghapus branch.
Checkout project, path non-kanonik, nama ambigu, dan kandidat tanpa bukti yatim
ditolak. Path dibandingkan secara fisik, termasuk symlink macOS (ADR-0132).
Gateway Telegram mengikuti konfirmasi inline yang sudah ada untuk endpoint hapus
worktree, termasuk mode yatim; correlation saja tidak mengizinkan penghapusan.

Pemindahan memakai varian ketat `releaseWorktreeToTrash`: rename gagal berarti
worktree dipertahankan dan galat dikembalikan. Tidak memakai fallback penghapusan
sinkron ADR-0116. Fallback lama tetap hanya milik jalur penutupan normal. Setelah
rename, byte dihapus oleh reaper `fs.promises.rm`, tetap terbatas `.trash/**`.

Dialog selalu menjelaskan bahwa seluruh isi direktori, termasuk berkas ignored,
akan hilang. Statistik git yang gagal dibaca bernilai `null`, bukan nol, dan
ditampilkan sebagai dampak tidak diketahui. Nol bukan jaminan bahwa pekerjaan aman.

Path `wt-spec-1099` di luar `.worktrees` tidak ditemukan pembuatnya di jalur produk
saat ini; seluruh peluncur membentuk path kanonik. Ia tetap ditampilkan bila
terdaftar git, dengan alasan blokir. Pemindahan checkout non-kanonik dikecualikan
karena kepemilikannya tidak terbukti; tidak ada migrasi diam-diam.

Rincian implementasi: [spec](../../../docs/superpowers/specs/2026-09-05-spec-1109-worktree-yatim-design.md)
dan [plan](../../../docs/superpowers/plans/2026-09-05-spec-1109-worktree-yatim.md).
