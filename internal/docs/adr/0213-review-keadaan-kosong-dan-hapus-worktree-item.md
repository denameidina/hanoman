# ADR-0213 — Review tanpa 409 untuk keadaan kosong, dan hapus worktree satu item

- Status: diterima (tindak lanjut audit UI/UX 2026-10, keputusan orkestrator) · **diamandemen [0215](0215-review-sesi-keadaan-kosong-tanpa-409.md)**: jalur sesi kini 200 `empty` juga (asimetri di bawah selesai)
- Tanggal: 2026-10-12
- SPEC: —
- Terkait: ADR-0030 (`baseSha`/`headSha` disimpan) · ADR-0054 (review sesi PRD, AC-6 409) · ADR-0132 (permukaan penghapusan worktree) · ADR-0155 (cakupan MCP, capability `danger`) · ADR-0202 (keputusan MCP wajib) · ADR-0043 (binding repoDir lokal per-mesin, SPEC-213/217 lewat `resolveRepoDir`)

## Konteks

1. **Review memperlakukan keadaan normal sebagai galat.** `GET /specs/:id/review` menjawab 409 bila item
   belum pernah dimulai (tanpa `baseSha`) atau worktree-nya sudah lenyap tanpa commit. Itu bukan kerusakan:
   layar Review menampilkannya sebagai "belum ada perubahan", tetapi lewat pemetaan `status === 409` dan
   log konsol. Tool MCP `hanoman_backlog_review` mengajarkan agen bahwa 409 "bukan galat" dalam deskripsi
   teks, bukan dalam kontrak — dua tempat yang bisa berselisih.
2. **Layar Review tak punya hapus worktree satu item.** Tombol "Hapus worktree" memanggil `deleteWorktrees`
   milik IDE dengan nama yang dinormalisasi ulang di klien (`spec.id.toLowerCase().replace(...)`). Aturan
   normalisasi itu ada di dua tempat, dan klien harus tahu cara menurunkan nama worktree dari id item.

## Keputusan

### 1. `GET /specs/:id/review` menjawab 200 untuk keadaan kosong

- Tanpa worktree maupun SHA/commit yang bisa ditinjau → **200** `{ base:"", files:[], changed:[], empty:true, reason }`.
- `reason` diturunkan dari `baseSha`, bukan dari keberadaan direktori (direktori yang hilang saja tak
  membedakan item yang belum dimulai dari yang sudah dimulai):
  - `no-worktree`: `baseSha` null. `session-launch` yang menulisnya saat sesi pertama lahir, jadi item ini
    belum pernah dimulai.
  - `no-commit`: `baseSha` tercatat, tetapi worktree sudah lenyap dan tak ada commit yang bisa ditinjau.
- Field aditif. `base`, `files`, dan `changed` ikut kosong agar klien lama yang hanya mengenal bentuk
  `SpecReview` tetap berjalan: ia menampilkan daftar kosong, tidak crash pada `changed[0]`.
- Bentuk kontraknya dipusatkan di `shared/src/spec-review.ts` (`zSpecReview`, `ReviewEmptyReason`), dipakai
  server, klien, dan tes.
- Tetap 409: `project belum punya repoDir` (konfigurasi, bukan keadaan item); `GET /specs/:id/review/*`
  (tak ada berkas untuk dibaca); dan `GET /terminal/sessions/:id/review` (review sesi PRD, ADR-0054 AC-6).
  Route sesi tidak disentuh dalam keputusan ini.

### 2. `DELETE /specs/:id/worktree`

- Service yang SAMA dengan `POST /projects/:id/worktrees/delete`: `services/worktree-delete.ts`
  (`deleteProjectWorktrees`). `lockInputs` dipindah ke sana dari route IDE. Dua jalur tak boleh menyusun
  deps penghapusan sendiri.
- Tanpa body. `withBranch` selalu `false`: cabang dan commit tetap ada.
- Nama worktree diturunkan server dari id item (`basename(worktreeDir(repoDir, id))`); klien tak mengirim nama.
- Balasan **200** berisi satu `WorktreeDeleteResult`. `ok:false` + `error` untuk "tak ditemukan" dan "tak
  bisa dihapus" — cermin `worktrees/delete`: galat hidup di baris, bukan di status HTTP.
- 404 bila item tak ada. 409 bila project tak punya repoDir.
- `repoDir` memakai `resolveRepoDir` (SPEC-217), sama dengan `GET review`, sehingga kedua route menyasar
  worktree yang sama.

### 3. Capability dan MCP (ADR-0202)

- `capabilityForRoute`: `DELETE /specs/:id/worktree` → **`ide:git`**, bukan `backlog:write` yang akan
  diturunkan `rw()`. Aksinya setara `worktrees/delete` (ADR-0155): menghapus direktori kerja, menutup sesi,
  dan membuang perubahan yang belum di-commit. Itu bukan pengeditan backlog.
- Tool baru `hanoman_backlog_worktree_delete`: mode `danger`, capability `ide:git`, dan masuk gerbang
  `mcp-capability.test.ts` (yang menghapus di luar hanoman wajib `danger`).
- `hanoman_backlog_review` tetap satu tool dengan param yang sama. Deskripsinya kini menyebut keadaan
  `empty` dan `reason`, bukan 409.
- `hanoman_session_review` tak berubah, karena rute sesinya tetap 409 (lihat 1).

### 4. Klien

- `ReviewScreen`: `r.empty` memicu keadaan kosong dengan teks sesuai `reason`. Atribut `data-reason` pada
  `.hn-review-empty` memuat alasannya (`no-worktree`, `no-commit`, atau `409` untuk jalur sesi).
  409 dari jalur sesi tetap dipetakan ke keadaan kosong yang sama.
- Tombol "Hapus worktree" di `App.tsx` memanggil `api.deleteSpecWorktree(spec.id)`. Galat `ok:false` dilempar
  ke bar keputusan seperti sebelumnya.

## Konsekuensi

- **Perubahan perilaku pada `GET /specs/:id/review`:** 409 → 200 untuk keadaan kosong. Pemanggil yang
  memeriksa `status === 409` kehilangan jalur itu; pemanggil yang memeriksa `ok` mendapat daftar kosong dan
  `empty: true`. Bentuk berkas dan daftar tak berubah. Tak ada migrasi dan tak ada perubahan skema.
- **Klien lama:** membaca daftar kosong tanpa crash. Tidak ada keadaan kosong yang bertanda (itu hanya
  tampil di klien yang kenal `empty`).
- **Asimetri yang disengaja:** rute review sesi (`/terminal/sessions/:id/review`) masih 409 untuk worktree
  yang lenyap (ADR-0054 AC-6), sementara layar Review menanganinya lewat jalur 409. Menyamakannya adalah
  keputusan terpisah.
- **Tes:** `server/test/specs.route.test.ts` (keadaan kosong `no-worktree`/`no-commit`, `zSpecReview`, dan
  `DELETE /specs/:id/worktree`), `server/test/agent-capabilities.test.ts`,
  `server/test/mcp-capability.test.ts`, `shared/src/mcp-catalog*` (tool baru), dan
  `src/src/screens/ReviewScreen.test.tsx`.

## Alternatif yang ditolak

- **Tetap 409 dan biarkan klien memetakannya.** Dua definisi "kosong" (status code di server, pemetaan di
  klien) dan agen harus diajari pengecualian. Keduanya menjadi sumber drift.
- **`reason` tanpa `base`/`files`/`changed` kosong.** Klien lama membaca `changed[0]` dari `undefined` dan
  crash. Field kosong adalah harga kecil untuk kompatibilitas.
- **`DELETE` dengan body `{ names }` mengikuti route IDE.** Memaksa klien mengirim nama turunan yang harus
  cocok dengan normalisasi server, persis kelas drift di atas.
- **Capability `backlog:write` (default rw).** Menyamakan penghapusan direktori kerja dan penutupan sesi
  dengan mengedit judul item, padahal yang pertama membuang pekerjaan.
- **Tool MCP tanpa `danger`.** Menghapus kerja yang belum di-commit tak boleh masuk tingkat default.

## Gotcha

1. `resolveRepoDir` (binding lokal) harus dipakai, bukan `Project.repoDir`, di `DELETE` seperti di `GET review`.
   `repoOf` di IDE setara (`resolveRepoDir ?? null`), jadi keduanya konsisten.
2. Pembeda `no-worktree`/`no-commit` memakai `baseSha`. Jangan menurunkannya dari "direktori ada atau tidak".
3. `deleteWorktrees` untuk nama yang tak ada mengembalikan baris `ok:false`, bukan melempar. Endpoint baru
   meneruskannya apa adanya. Layar Review melempar `Error` dari baris itu.
