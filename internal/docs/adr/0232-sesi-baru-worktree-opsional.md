# ADR-0232 — "Sesi baru" boleh lahir di worktree terpisah dari branch pilihan

**Status:** aktif (2026-10-30). **Memperluas** SPEC-517 (form "Sesi baru") dan SPEC-230 (review &
integrate sesi ber-branch). Tanpa migration.

## Konteks

Terminal agen biasa ("Sesi baru" di halaman Terminal) lahir dengan `cwd = repoDir` — langsung di
checkout project. Beberapa sesi yang terbuka bersamaan di project yang sama karenanya berbagi working
tree dan saling menimpa berkas. Sesi backlog dan project-level sudah terisolasi di `.worktrees/<id>`
(ADR-0002), tetapi terminal biasa tidak punya pilihan itu, dan bila worktree dibuat manual operator
juga tak bisa memilih branch asalnya.

## Keputusan

1. **Opsional, default mati.** Varian `{project, agent?, model?, effort?}` di `POST /terminal/sessions`
   menerima `worktree?: boolean` dan `branchFrom?: string` (1–255). Tanpa keduanya body dan
   perilakunya byte-identik dengan sebelumnya (terminal di repoDir). `branchFrom` tanpa
   `worktree: true` → **400** — diam-diam mengabaikannya menyesatkan operator.
2. **Bentuk worktree.** id sesi `term-<8 hex>`, worktree `${repoDir}/.worktrees/<id>` lewat
   `realGit.addWorktree(repoDir, wt, branchFrom ?? "HEAD")` (resolusi lokal → `origin/<rev>`, SPEC-244),
   lalu `git switch -c term/<8 hex>` di dalamnya. Branch nyata, **bukan detached**: penutupan sesi
   melepas worktree (`closeSession` → `ownsWorktree` → `releaseWorktree`), dan commit di HEAD detached
   akan kehilangan satu-satunya ref-nya. Branch `term/*` tersisa sesudah sesi ditutup; dibersihkan
   lewat panel branch tak terpakai seperti branch lain.
3. **Review & integrate gratis.** Sesi lahir dengan `branch: "term/…"`, jadi `GET …/review` dan
   `POST …/integrate` (SPEC-230) bekerja tanpa kode baru.
4. **Gerbang admission membungkus pembuatan worktree** (`withSessionAdmission`, `exempt:false` seperti
   terminal agen lain, ADR-0170): request yang ditolak gerbang tak meninggalkan worktree yatim. Gagal
   membuat worktree/branch (ref tak dikenal) → **422**, worktree setengah jadi dilepas lebih dulu.
5. **UI.** `NewTerminalModal` menambah kotak centang "Worktree terpisah"; bila dicentang muncul
   "Branch asal" (`GET /projects/:id/branches`, gabungan lokal + origin, remote-only bertanda
   `· origin`; kosong = HEAD checkout project). Daftar branch hanya dimuat saat opsi dicentang.
6. **MCP (ADR-0202).** Tool yang ada `hanoman_session_create` (danger, `sessions:spawn`) menerima
   `worktree`/`branchFrom` untuk terminal biasa — tak ada tool atau capability baru.

## Konsekuensi

- Terminal biasa tanpa opsi ini tetap berjalan di repoDir (perilaku SPEC-236/517 apa adanya).
- Shell mentah (`shell: true`) dan sesi ber-flow tak berubah.
- Bila beberapa sesi worktree dibuka dari branch yang sama, masing-masing mendapat branch `term/*`
  sendiri; menyatukannya tetap lewat integrate/merge manual (ADR-0031).
