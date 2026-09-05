# ADR-0132 — Permukaan penghapusan worktree: tab Worktrees, daftar turunan git, hapus lewat `.trash`

- Status: Accepted
- Amandemen SPEC-1109: [ADR-0162](0162-pemungutan-worktree-yatim-dengan-konfirmasi.md) menambah penanda yatim dari history/tmux, mode pemungutan dengan konfirmasi tanpa menutup pane, serta statistik gagal baca bernilai null.
- Tanggal: 2026-08-20
- SPEC: SPEC-861
- Terkait: **menegakkan** [0116](0116-penutupan-sesi-asinkron-worktree-trash.md) (domain penyapu
  tetap `.trash/**` dan HANYA itu; yang berubah adalah APA yang masuk ke `.trash`),
  [0077](0077-hapus-branch-tak-terpakai-pagar-per-branch.md) (pagar kunci per-branch dipakai ulang
  apa adanya — tak ada jalur hapus branch kedua), [0002](0002-git-worktree-isolation.md) &
  [0015](0015-one-session-per-backlog.md) (worktree detached ber-id deterministik dari id spec),
  [0018](0018-coverage-nilai-turunan.md)/[0011](0011-docs-realtime-filesystem.md) (daftar adalah
  nilai turunan, tanpa kolom & tanpa cache), [0127](0127-satu-kontrak-konfirmasi-destruktif.md)
  (`useConfirm` + `impact[]`), dan [0121](0121-operasi-berkas-ide-explorer.md) (capability domain
  `ide` diturunkan DARI METHOD). **Tidak mencabut apa pun.** Tanpa migration, tanpa kolom, tanpa
  domain capability baru. `DELETE /terminal/sessions/:id` berperilaku identik.

## Konteks

Satu backlog = satu sesi = satu git worktree di `<repoDir>/.worktrees/<session-id>` (ADR-0002/0015).
Sisi **branch**-nya sudah punya permukaan bersih-bersih sejak SPEC-360/ADR-0077: tab **Branches**
mendaftar branch ter-merge, memberi badge alasan kunci (`BranchLock`), dan menghapus lokal/remote.

Sisi **worktree**-nya tidak. Satu-satunya yang terlihat dari dashboard adalah `WorktreeCleanupView`
(SPEC-742/ADR-0116), dan itu hanya membaca `<repoDir>/.worktrees/.trash/` — worktree yang **sudah**
dilepas dan sedang dihapus byte-nya. Worktree yang masih **HIDUP** di `.worktrees/` tak terdaftar
di mana pun.

Akibatnya worktree yatim — sesi yang mati tak wajar, penutupan yang gagal di tengah, sisa migrasi/
rename repo, worktree buatan tangan — hanya bisa ditemukan lewat `git worktree list` di terminal.
Reaper tak pernah menyentuhnya: domainnya sengaja `.trash/**` dan HANYA itu, dan invarian itulah
yang membuat desainnya bebas kunci. Sisa-sisa itu memakan disk, **dan** registrasinya membuat
`BranchLock: "worktree"` mengunci branch di tab Branches sehingga branch-nya pun tak bisa
dibersihkan — dua kebuntuan yang saling mengait, tanpa satu pun jalan keluar di layar.

## Keputusan

Tab **Worktrees** di IDE (bersebelahan dengan Explorer / Git Graph / Branches) dengan tiga endpoint
di bawah capability domain `ide` yang sudah ada.

### 1. Daftar adalah nilai turunan penuh, dan servicenya MURNI

`GET /projects/:id/worktrees` menurunkan seluruh daftar dari `git worktree list --porcelain` **tiap
request** (ADR-0018/0011): tak ada kolom DB, tak ada cache. Servicenya
(`server/src/services/worktree-list.ts`) adalah pasangan `branch-cleanup.ts` untuk sisi worktree dan
menirunya sampai ke detail: `out()` yang **tak pernah melempar** (repo rusak / tanpa commit → daftar
kosong, bukan 500), `execFile` async — bukan `spawnSync`, karena route ini melayani event loop yang
sama dengan terminal PTY — dan sinyal non-git (Spec + stage, sesi tmux hidup) yang masuk sebagai
`Map` parameter, bukan import. Modul itu karena itu bisa dites tanpa DB maupun tmux. Seluruh efek
samping penghapusan (tutup sesi, `rename`, `prune`, hapus branch) juga masuk sebagai **deps**,
dirakit di `routes/ide.ts` — tempat yang memang sudah boleh menyentuh DB & tmux, persis alasan
`lockInputs()` hidup di sana.

Per baris: path + `branch` **atau** SHA HEAD (sesi hanoman selalu detached, ADR-0002 — kolomnya
sanggup jadi SHA, tak mengasumsikan nama branch), backlog terkait berikut stage-nya, umur, sesi tmux
yang hidup di sana, `prunable`, `locked`.

**Entri `.trash/**` DIKECUALIKAN** — itu wilayah reaper, sudah punya permukaannya sendiri
(`GET /terminal/cleanups`). Filternya prefix path yang sudah dinormalkan, bukan substring: nama
worktree boleh saja memuat `.trash`.

**Pemetaan worktree → backlog** membandingkan `basename(path)` dengan `sessionIdForSpec(specId)` —
id sesi yang deterministik dari id spec (ADR-0015), yang memang sama dengan nama direktorinya.
Worktree `merge-*` (integrasi) dan `cron-*` (ADR-0112) memang tak memetakan ke spec mana pun.

### 2. Sinyal mahal di endpoint kedua

Ukuran disk (`du -sk`) dan status kotor (`git status --porcelain`) berpotensi lambat di repo besar,
dan daftar tak boleh menunggu keduanya. `GET /projects/:id/worktrees/stats?name=…` menjawabnya per
baris; UI memuatnya menyusul, satu baris per giliran, dan menampilkan `…` sampai datang. `name`
divalidasi terhadap daftar **turunan** — klien tak pernah mengirim path, jadi tak ada permukaan
traversal.

`orphanCommits` menjawab pertanyaan yang sebenarnya — **"berapa kerja yang benar-benar hilang?"** —
bukan sekadar "belum ter-merge": commit yang reachable dari HEAD worktree ini tetapi tidak dari ref
lain **mana pun**, dengan branch yang ter-checkout DI SINI ikut dikecualikan karena checkbox 'hapus
branch juga' akan ikut menghapusnya.

### 3. `POST /projects/:id/worktrees/delete`

Body `{ names, deleteBranch? }`. Selalu 200 bila body sah — kegagalan hidup di baris `results`,
bukan di status HTTP (cermin `/branches/delete`). Urutannya mengikat:

```
turunkan ulang daftar → gerbang deletable → [sesi hidup? closeSession()] → releaseWorktree() →
  git worktree prune → [deleteBranch? deleteBranches() BESERTA pagar ADR-0077]
```

**`ownsWorktree()` adalah satu-satunya gerbang `deletable`, dan ditegakkan di jalur TULIS.** Ia
menguji HUBUNGAN path↔repoDir, bukan bentuk path. hanoman didogfood di dalam worktree-nya sendiri,
sehingga sebuah project bisa ter-bind ke checkout yang kebetulan berada di bawah `.worktrees/` —
menguji bentuk path saja pernah membuat `removeWorktree(repoDir, repoDir)` menghapus checkout
project itu sendiri (SPEC-362). Checkout project tetap **tampil** sebagai baris (ia konteks yang
berguna) dengan `deletable: false` dan alasan prosa di `blocked`.

**Penghapusan tidak memblokir event loop.** Request hanya me-`rename` worktree ke
`.worktrees/.trash/` (SPEC-742: 1 ms vs 1 370 ms `rmSync`, dengan 1 364 ms di antaranya tanpa satu
tick pun) lalu membalas; byte-nya dihabisi `worktree-reaper.ts`. Baris yang baru dihapus langsung
berpindah jadi entri cleanup yang sudah punya tampilannya.

**`git worktree prune` dijalankan SEKARANG, bukan diserahkan ke penyapu.** Di situlah kunci
`BranchLock: "worktree"` lepas — dan itulah yang membuka kebuntuan yang jadi alasan SPEC-861 ada.
Ia juga satu-satunya yang membereskan baris `prunable` (registrasi tanpa direktori).

### 4. Tak ada baris terkunci permanen — tapi pagar branch tetap berdiri

Kedua kalimat itu tidak bertabrakan, dan bedanya penting. Yang tak pernah terkunci adalah **baris
worktree**: sesi tmux hidup, backlog belum `done`, dan isi kotor semuanya **peringatan** yang
dinamai dialog konfirmasi (`useConfirm`, ADR-0127) lewat `impact[]` — berapa sesi ikut ditutup,
berapa commit tak ada di tempat lain, berapa berkas belum tersimpan. Dialog yang tak bisa menyebut
angkanya bukan konfirmasi, jadi baris yang stats-nya belum termuat dijemput dulu sebelum dialognya
dibuka.

Penghapusan **branch** tetap lewat `deleteBranches` **beserta pagar kuncinya**. Konsekuensinya jujur
dan dilaporkan per baris: branch sesi untuk backlog yang belum `done` gagal dengan
`terkunci: backlog-nya belum selesai`, sementara worktree-nya tetap terhapus. Itu tetap membuka
kebuntuan — kunci `worktree` sudah lepas, jadi branch-nya bisa dibersihkan dari tab Branches begitu
backlog-nya selesai.

### 5. Satu definisi penutupan sesi

Badan `DELETE /terminal/sessions/:id` (`advanceStage` → `recordHeadSha` → `killSession` →
gerbang `ownsWorktree` → `releaseWorktree`) pindah utuh ke `server/src/services/session-close.ts`.
Route worktrees memanggil fungsi yang **sama**, bukan salinannya. Menyalinnya berarti mengulang
kelas bug "satu definisi, N call site" (SPEC-431/448/475/481) pada operasi yang, bila terlewat,
membuang kemajuan stage dan bukti dependency antar-backlog — dua bacaan yang WAJIB terjadi selagi
worktree masih di tempatnya.

### 6. Kaitan dua arah dengan tab Branches

`UnusedBranch` mendapat field **additif** `worktree?: string`; `worktreeBranches()` di
`branch-cleanup.ts` berubah dari `Set` jadi `Map<branch, path>`. Badge `dipakai worktree` jadi
tombol yang membawa ke tab Worktrees dengan barisnya ter-fokus, dan nama branch pada baris Worktrees
membawa balik ke tab Branches.

## Konsekuensi

- Worktree yatim akhirnya punya permukaan; kebuntuan `BranchLock: "worktree"` punya jalan keluar.
- Domain reaper **tidak** diperlebar. Ia tetap hanya menyentuh `.trash/**`, jadi invarian bebas-kunci
  ADR-0116 utuh. Yang berubah adalah apa yang masuk ke `.trash`.
- Tak ada kolom DB, tak ada migration, tak ada model baru.
- Pada instance dogfood yang project-nya ter-bind ke checkout DI BAWAH `.worktrees/`, **tak ada**
  baris yang deletable. Itu benar dan disengaja: `ownsWorktree` menolak, dan menolak adalah jawaban
  yang aman.

## Gotcha terukur

1. **`--exclude` `rev-list` relatif terhadap ruang ref-nya, dan di-RESET tiap kali.** Diverifikasi
   terhadap git 2.50.1: untuk `--branches` polanya relatif `refs/heads/` — `--exclude=feat` bekerja,
   `--exclude=refs/heads/feat` **diam-diam tak mengecualikan apa pun** (jawabannya 0, dan seluruh
   kerja yang akan hilang tak pernah disebut dialog konfirmasi). Untuk `--remotes` relatif
   `refs/remotes/` → `*/feat`. Dan `--exclude` habis sesudah tiap `--branches`/`--remotes`/`--tags`,
   jadi ia wajib ditulis ulang sebelum masing-masing.
2. **`git worktree list` SELALU menjawab path FISIK**, sementara `repoDir` dan cwd sesi datang apa
   adanya dari DB/tmux. macOS men-symlink `/tmp` & `/var/folders` ke `/private/**`, jadi
   membandingkan string mentah gagal — **senyap**: baris tak pernah cocok dengan sesinya, dan
   `ownsWorktree` menolak worktree yang sah. Normalisasi lewat `realpath` (cermin `samePath` di
   `runner/src/git.ts`).
3. **`createdAt` diambil dari `stat` berkas `.git` worktree**, bukan direktorinya: untuk worktree
   tertaut `.git` adalah BERKAS yang ditulis sekali saat `worktree add` dan tak pernah disentuh
   lagi. `birthtime` 0 (sebagian filesystem Linux tak menyimpannya) → jatuh ke `mtime`; baris
   `prunable` → `null`.
4. **Entri `.trash` tak bisa di-assert keberadaannya di test.** `releaseWorktree` menendang penyapu
   seketika (`reapSoon`), jadi berkasnya memang sudah lenyap saat assertion berikutnya jalan. Yang
   membuktikan ia DIPINDAH (bukan dihapus sinkron) adalah **bentuk nama entrinya**, `<sesi>.<stempel>`.
