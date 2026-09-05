# Audit SPEC-1109 — Worktree sesi yatim setelah crash

Tanggal: 2026-09-05. Basis: `a0ac6da8515106613782bd81d8e85edd69ad02ad`.
Severity: major. Confidence akar masalah: tinggi.

## Temuan dan bukti

1. `server/src/server.ts` mengambil daftar tmux saat boot lalu memanggil
   `reconcileHistory(liveIds)` dan `reconcileAgentInvocations(liveIds)` secara terpisah.
   `server/src/services/session-history.ts:reconcileHistory` hanya menutup baris terbuka
   yang sessionId-nya tidak ada di tmux. Query-nya tidak mengambil `cwd`/`projectId`, dan
   tidak ada pemanggilan pelepasan worktree. Sesudah baris ditandai `reconciled`, boot
   berikutnya bahkan tidak membacanya lagi karena query hanya memilih `endedAt: null`.
2. `server/src/services/worktree-reaper.ts:sweepRepo` hanya membaca
   `<repoDir>/.worktrees/.trash/`. Ini batas yang benar menurut
   [ADR-0116](../adr/0116-penutupan-sesi-asinkron-worktree-trash.md), bukan cacat reaper.
   `releaseWorktree` memindahkan checkout ke sana pada jalur penutupan normal;
   crash host melewati jalur itu. Memperlebar domain reaper bukan perbaikan yang sah.
3. Permukaan operator sudah ada: `server/src/routes/ide.ts:worktreeInputs` mengumpulkan
   Spec dan sesi tmux, lalu `worktree-list.ts:listWorktrees` menggabungkannya dengan
   daftar git. Belum ada input SessionHistory atau penanda yatim. `WorktreesPanel.tsx`
   sudah menyediakan hapus satu/banyak dengan dialog dampak, sesuai
   [ADR-0132](../adr/0132-permukaan-penghapusan-worktree.md). Daftar tanpa sesi tidak
   membuktikan bahwa worktree pernah dimiliki sesi hanoman.
4. Pemungutan otomatis seluruh yatim bertentangan dengan kontrak pemulihan
   [ADR-0084](../adr/0084-melanjutkan-sesi-backlog.md): worktree sesi yang
   terputus sengaja dipakai apa adanya ketika operator memilih Lanjutkan. Bahkan
   `git status` bersih tidak membuktikan seluruh isinya boleh dibuang: commit detached
   bisa belum dirujuk branch lain, dan berkas ignored tidak masuk hitungan status.
5. Statistik sekarang tidak layak menjadi bukti penghapusan otomatis.
   `worktree-list.ts:out` mengubah kegagalan git menjadi string kosong;
   `dirtyCount`/`orphanCount` kemudian menjawab nol. UI juga memakai nol ketika stats
   gagal dimuat. Kebijakan yang memakai bukti kebersihan wajib membedakan gagal baca
   dari nol, bukan menggunakan kembali statistik itu sebagai izin destruktif.
6. `releaseWorktree` memiliki fallback `realGit.removeWorktree` sinkron ketika rename
   gagal (keputusan lama ADR-0116). Jalur pemungutan baru harus mengikuti batasan
   SPEC-1109: gagal memindahkan berarti pertahankan worktree dan laporkan kegagalan;
   jangan menjalankan penghapusan pohon sinkron maupun menghapus path asal di latar.

## Path non-kanonik

Scout menelusuri seluruh pemanggil pembuatan worktree. Jalur backlog di
`server/src/services/session-launch.ts`, flow project-level di
`server/src/routes/terminal.ts`, scheduler cron, dan worktree integrasi membentuk
path di bawah `<repoDir>/.worktrees/`. Pencarian literal `wt-spec` dalam source,
docs, test, dan riwayat commit yang ditelusuri tidak menemukan pembuatnya.

Asal khusus `wt-spec-1099` belum terbukti; tidak boleh disebut hasil jalur produk
saat ini tanpa bukti. Jika masih terdaftar di git, ia sudah tampil di tab Worktrees
dengan alasan blokir `di luar .worktrees project ini`. Migrasi/penghapusan checkout
non-kanonik tetap di luar pemungutan otomatis: hubungan kepemilikannya tidak boleh
disimpulkan dari basename, dan direktori sesi lain tidak disentuh dalam audit ini.

## Verifikasi audit

Test terbatas, serial, dengan `TEST_DATABASE_URL` di direktori temporer khusus serta
`HANOMAN_CONTROL_ORIGINS` dan `SSH_ASKPASS` dibersihkan:

```sh
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run server/test/session-history.service.test.ts \
  server/test/worktree-list.test.ts server/test/worktree-reaper.test.ts \
  --no-file-parallelism
```

Hasil: **3 berkas, 49 test lulus**. Ini baseline perilaku komponen, bukan bukti bahwa
pemungutan yatim sudah tersedia. Belum ada perubahan kode produk atau penghapusan
worktree operator. Angka disk dan kernel panic pada brief adalah laporan operator,
tidak diukur ulang oleh audit ini.

## Keputusan pasca-Audit

**Jalankan Spec → Plan → Execute penuh.** Ini perubahan kebijakan retensi yang
destruktif serta kontrak pemulihan sesi, bukan perbaikan kecil yang boleh langsung
execute. Pengguna menyetujui rekomendasi konfirmasi operator melalui instruksi
“lanjutkan”; kebijakan ditetapkan di [ADR-0162](../adr/0162-pemungutan-worktree-yatim-dengan-konfirmasi.md).

Keputusan yang disetujui: boot mengenali yatim dari SessionHistory dan pembacaan tmux yang sukses,
menampilkannya untuk dipungut di tab Worktrees; pemindahan ke `.trash` dilakukan
setelah konfirmasi operator. Ini mempertahankan kemampuan Lanjutkan dan isi yang
belum terintegrasi. Alternatifnya pemungutan otomatis hanya setelah seluruh bukti
keamanan terpenuhi, dengan keadaan kotor/tidak diketahui tetap menunggu operator;
pilihan itu memerlukan definisi eksplisit untuk commit, berkas ignored, dan
kelayakan melanjutkan sesi di ADR.

Pagar implementasi untuk kedua pilihan: tmux gagal dibaca berarti tidak memungut;
riwayat lama yang sudah `reconciled` tetap bisa ditemukan; sesi yang kembali hidup
atau memakai ulang cwd dilindungi; path dibandingkan secara fisik; reaper tetap
`.trash/**`; efek samping pemungutan di-inject untuk test; perubahan docs dan index
ikut commit implementasi.

## Penyelesaian

Implementasi dan verifikasi dicatat pada [plan SPEC-1109](../../../docs/superpowers/plans/2026-09-05-spec-1109-worktree-yatim.md): 106 test terkait, typecheck tiga paket, dan smoke HTTP terisolasi lulus. Pemungutan operator tidak dijalankan terhadap worktree nyata pada mesin ini.
