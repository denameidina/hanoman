# SPEC-1150 — Worktree di luar `.worktrees` kini deletable; hanya checkout utama dikecualikan

Source of Truth: ADR-0163 (mengamandemen [ADR-0132](../../../internal/docs/adr/0132-permukaan-penghapusan-worktree.md) §3 dan [ADR-0162](../../../internal/docs/adr/0162-pemungutan-worktree-yatim-dengan-konfirmasi.md)).

## Perilaku

Tab Worktrees di IDE (`GET /projects/:id/worktrees`, `POST /projects/:id/worktrees/delete`)
kini menandai `deletable:false` **hanya** untuk baris yang merupakan checkout utama repo
— baik karena `path === repoDir` project (kasus normal) maupun karena ia benar-benar working
tree utama git-nya (kasus dogfooding: project ter-bind ke checkout yang berada DI BAWAH
`.worktrees/` milik repo git yang sesungguhnya). Worktree lain — termasuk yang dibuat manual
lewat `git worktree add` DI LUAR `<repoDir>/.worktrees/` (kasus b pada brief) — kini
`deletable:true`, bisa dicentang lewat checkbox baris/"Pilih semua yang boleh", dan dihapus
lewat tombol Hapus per baris maupun bulk, persis seperti worktree biasa.

Badge `blocked:"checkout project"` tetap tampil untuk baris yang dikecualikan. Badge/alasan
`"di luar .worktrees project ini"` dihapus — tak ada lagi baris yang ditolak karena posisinya
di luar container.

## Kenapa bukan sekadar `deletable = path !== repoDir`

Pendekatan paling naif — mengganti `ownsWorktree(baseReal, path)` dengan `path !== baseReal`
langsung di `worktree-list.ts` — punya lubang keamanan nyata pada skenario dogfooding yang
sudah didokumentasikan ADR-0132 §Konsekuensi: ketika `repoDir` project ter-bind ke checkout
yang merupakan worktree TERTAUT (bukan working tree utama git-nya), `git worktree list`
yang dijalankan dari checkout itu tetap mendaftar seluruh worktree repo tersebut —
**termasuk working tree utama yang sesungguhnya**. `path !== baseReal` hanya mengecualikan
`repoDir`-nya project (checkout tertaut itu sendiri), sehingga working tree utama yang
sesungguhnya ikut lolos `deletable:true` — persis kelas insiden yang memicu SPEC-362.

Diverifikasi empiris (git 2.x, lihat catatan di ADR-0163): `git worktree list --porcelain`
SELALU memancarkan working tree utama sebagai baris **pertama**, apa pun cwd pemanggilnya
— sinyal yang berasal dari struktur repo git itu sendiri, independen dari binding `repoDir`
project di DB hanoman. `deletable` karena itu dihitung sebagai
`path !== baseReal && path !== mainPath`, dengan `mainPath` diambil dari baris pertama
`parseWorktreePorcelain()`. Pada kasus normal `mainPath === baseReal` (tak ada perubahan
perilaku); pada kasus dogfooding, keduanya berbeda dan keduanya dikecualikan.

`ownsWorktree()` (`server/src/services/session-worktree.ts`) **tidak diubah** — ia tetap
gerbang untuk kelas kerja BERBEDA: pelepasan worktree OTOMATIS saat sesi ditutup
(`session-close.ts`) dan saat spec direset (`spec-reset.ts`), yang sengaja tetap sempit
("hanya yang hanoman buat sendiri di bawah container-nya") karena keduanya dipicu tanpa
pilihan eksplisit operator per-baris. Tab Worktrees adalah tindakan manusia yang eksplisit
per-baris dengan dialog konfirmasi (`useConfirm` + `impact[]`, ADR-0127) — gerbang yang
lebih longgar di situ masih aman karena pengecualian working-tree-utama di atas tetap berdiri,
dan operasi git level (`trashWorktree`/`removeWorktree`, `runner/src/git.ts`) sudah menolak
keras bila target === repo.

## Arsitektur

Perubahan terkonsentrasi di `server/src/services/worktree-list.ts`, fungsi `listWorktrees()`:

- Ambil `mainPath` dari baris pertama `parseWorktreePorcelain(text)` (sebelum filter `.trash`).
- Ganti `const deletable = ownsWorktree(baseReal, path)` menjadi
  `const deletable = path !== baseReal && path !== mainPath`.
- Sederhanakan `blocked`: `deletable ? null : "checkout project"` (cabang
  `"di luar .worktrees project ini"` dihapus).
- Import `ownsWorktree` dihapus dari file ini (tak lagi dipakai di sini).

`deleteWorktrees()` dan `collectOrphanWorktrees()` tidak berubah — keduanya sudah menurunkan
ulang laporan lewat `listWorktrees()` dan menegakkan `w.deletable` di jalur tulis, jadi
perubahan gerbang otomatis ikut tegak di sana (double-enforcement client+server tetap utuh).

`WorktreesPanel.tsx` tidak berubah secara fungsional (sudah generik atas `w.deletable`/
`w.blocked` dari server) — hanya komentar berkas di baris atas yang menyebut `ownsWorktree`
diperbarui supaya tidak menyesatkan.

## Acceptance criteria

1. Worktree yang dibuat via `git worktree add` DI LUAR `<repoDir>/.worktrees/` tampil dengan
   `deletable:true`, `blocked:null`, bisa dicentang & dihapus lewat `POST …/worktrees/delete`.
2. Baris yang `path === repoDir` (checkout utama, kasus normal) tetap `deletable:false`,
   `blocked:"checkout project"`.
3. Kasus dogfooding — project ter-bind ke checkout DI BAWAH `.worktrees/` milik repo lain —
   working tree utama git yang sesungguhnya (baris pertama porcelain) TETAP `deletable:false`;
   checkout yang di-bind (`repoDir` project) juga tetap `deletable:false`; worktree LAIN di
   repo itu (di luar keduanya) kini `deletable:true`.
4. `POST /projects/:id/worktrees/delete` menolak nama yang menunjuk baris `deletable:false`
   dengan `error` yang menyebut `blocked`-nya (jalur tulis tetap menegakkan gerbang, bukan
   sekadar UI).
5. `WorktreesPanel.tsx` checkbox baris & "Pilih semua yang boleh" mengikuti `w.deletable` —
   tak ada perubahan kode diperlukan di sana selain komentar.

## Batas

Tidak menyentuh `ownsWorktree()` atau perilaku `DELETE /terminal/sessions/:id` /
`spec-reset.ts` (pelepasan worktree otomatis saat sesi ditutup/spec direset tetap sempit ke
container `.worktrees` — di luar scope SPEC-1150). Tidak ada migration, kolom, atau endpoint
baru. Tidak menambah field baru ke `WorktreeView` DTO.
