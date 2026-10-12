# ADR-0215 — Review sesi tanpa 409 untuk keadaan kosong (amandemen ADR-0213: jalur sesi)

- Status: diterima · **mengamandemen [0213](0213-review-keadaan-kosong-dan-hapus-worktree-item.md)** (jalur sesi `GET /terminal/sessions/:id/review`) dan **sebagian [0054](0054-review-integrate-ber-skop-sesi-untuk-prd.md)** (AC-6 dan baris "Worktree tak ada → 409")
- Tanggal: 2026-10-12
- SPEC: —
- Terkait: ADR-0213 (keadaan kosong backlog item) · ADR-0054 (review sesi PRD) · ADR-0030 (`baseSha`/`headSha`) · ADR-0202 (keputusan MCP wajib) · ADR-0155 (cakupan MCP)

## Konteks

1. **Dua jalur review, dua definisi "kosong".** ADR-0213 menjadikan `GET /specs/:id/review` 200 `{ empty, reason }`
   untuk "belum ada worktree maupun commit". Jalur sesi `GET /terminal/sessions/:id/review` sengaja dibiarkan
   409 ("asimetri yang disengaja", ADR-0213 Konsekuensi). Akibatnya layar Review harus memetakan 409 ke
   keadaan kosong, dan tool MCP `hanoman_session_review` mengajarkan agen bahwa 409 "bukan galat server" di
   teks deskripsi, bukan di kontrak. Itu kelas drift yang ditolak ADR-0213.
2. **Keadaan sesi tanpa worktree atau worktree-nya lenyap adalah keadaan normal.** Sesi PRD yang sudah ditutup,
   atau sesi yang tak pernah membuat worktree, bukan kerusakan.

## Keputusan

### 1. `GET /terminal/sessions/:id/review` menjawab 200 untuk keadaan kosong

- Sesi tanpa worktree (cwd bukan `…/.worktrees/…`) → **200** `{ base:"", files:[], changed:[], empty:true, reason:"no-worktree" }`.
- Worktree tercatat (cwd di `.worktrees/`) tetapi direktorinya sudah lenyap (sesi ditutup) → **200** dengan `reason:"no-commit"`.
- Field kosong ikut, sama seperti ADR-0213: klien lama yang hanya mengenal `SpecReview` tetap berjalan.
- Bentuknya dibangun satu helper `emptySpecReview(reason)` di `server/src/services/spec-review.ts`. Route backlog
  dan route sesi memakai helper yang sama, sehingga kontraknya tak bisa berselisih. Tipe `ReviewEmptyReason` tetap
  di `shared/src/spec-review.ts`.
- Tetap **409**: `project belum punya repoDir` (galat konfigurasi, bukan keadaan sesi).
- Tetap **404**: sesi tak dikenal.

### 2. `GET /terminal/sessions/:id/review/*path` tetap 409 tanpa sumber

Tak ada berkas untuk dibaca, sama dengan `GET /specs/:id/review/*path` (ADR-0213). 404 bila path di luar daftar
(gerbang path traversal tak berubah). Layar Review tak memanggil rute ini dalam keadaan kosong.

### 3. Tidak ada fallback commit-range untuk sesi

Item backlog selesai punya jalur cadangan: `baseSha..headSha` tersimpan, atau grep `(spec-N)` untuk item lama
(ADR-0030, SPEC-171). Sesi tidak. Ia tak menyimpan `baseSha`/`headSha`, dan `specCommitRange` terikat pada
pola `spec-N`. Karena itu sesi yang worktree-nya lenyap menjawab `no-commit`, walaupun branch-nya mungkin
masih memuat commit. Ceiling ADR-0054 tetap berlaku: review sesi hanya sah selama worktree hidup. Integrate
tetap berjalan karena ia beroperasi pada branch. Upgrade path bila kelak perlu: simpan base/head di sesi
(kolom baru, butuh migration dan ADR sendiri).

### 4. MCP (ADR-0202)

- Tool `hanoman_session_review` **tetap** (mode `read`, capability `sessions:read`). Yang berubah deskripsinya:
  keadaan kosong = 200 `empty`/`reason`, dan `path` tetap 409.
- Tak ada route atau capability baru. Pemetaan gerbang `mcp-coverage.test.ts` tak berubah.
- Dokumen: `docs/agent-integration.md` (baris rute sesi dan review) dan `internal/docs/architecture/api-contract.md`.

### 5. Klien

- `ReviewScreen` membaca `r.empty` pada kedua jalur (sudah begitu sejak ADR-0213). Jalur **sesi** tak lagi
  memetakan 409 ke keadaan kosong: 409 di sana (repoDir belum diatur) tampil sebagai galat "Gagal memuat review".
- Jalur **spec** tetap memetakan 409 (repoDir belum diatur) ke keadaan kosong. Keputusan ini tak
  mengubahnya; bila ingin diseragamkan, itu keputusan terpisah.

## Konsekuensi

- **Perubahan perilaku:** `GET /terminal/sessions/:id/review` 409 → 200 untuk keadaan kosong. Pemanggil yang
  memeriksa `status === 409` pada rute ini kehilangan jalur itu; pemanggil yang memeriksa `ok` atau membaca
  `changed` mendapat daftar kosong dan `empty: true`. Bentuk berkas dan daftar tak berubah. Tanpa migrasi, tanpa
  perubahan skema.
- **Asimetri ADR-0213 selesai:** kedua jalur review kini memakai kontrak `zSpecReview` yang sama.
- **Tes:** `server/test/terminal.route.test.ts` (`no-commit`, `no-worktree`, `…/review/*` 409, sesi tak dikenal 404),
  `server/test/specs.route.test.ts` (`…/review/*` tanpa sumber tetap 409), `src/src/screens/ReviewScreen.test.tsx`,
  dan `src/test/review-screen.test.tsx`.

## Alternatif ditolak

- **Tetap 409 dan biarkan klien memetakannya.** Dua definisi "kosong" dan agen harus diajari pengecualian: drift
  yang sama dengan yang ditolak ADR-0213.
- **Fallback commit-range untuk sesi sekarang.** Butuh kolom SHA di sesi, yaitu migration dan ADR terpisah
  (lihat keputusan 3).
- **Helper terpisah per route.** Dua salinan bentuk kosong akan menyimpang. Satu helper di service.

## Gotcha

1. Sesi tak punya `baseSha`, jadi pembeda `no-worktree`/`no-commit` diturunkan dari cwd (mengandung
   `/.worktrees/`) dan dari `existsSync(cwd)`. Ini sah karena sesi tak punya riwayat SHA. Jangan memindahkan
   aturan spec ("baseSha tercatat?") ke sesi.
2. `resolveRepoDir` (binding lokal per-mesin, SPEC-217) tetap dipakai, sama dengan `GET /specs/:id/review`.
   repoDir yang belum diatur tetap 409 di kedua rute.
3. `…/review/*` tanpa sumber menjawab 409, bukan 200 kosong. Jangan "menyamakannya" dengan rute daftar:
   tak ada daftar untuk dikembalikan dan layar tak memanggilnya dalam keadaan kosong.
