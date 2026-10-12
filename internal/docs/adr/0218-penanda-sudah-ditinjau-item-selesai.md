# ADR-0218 — Penanda "sudah ditinjau" pada item selesai

- Status: diterima (tindak lanjut audit UI/UX 2026-10, gelombang 8; pemilik menyetujui perubahan skema pada 2026-10-12)
- Tanggal: 2026-10-12
- SPEC: —
- Terkait: ADR-0105 (`doneAt`, "selesai pertama") · ADR-0120 (`manualDone`, selesai manual) · ADR-0202 (keputusan MCP wajib) · ADR-0213 & ADR-0215 (Review keadaan kosong, hapus worktree) · ADR-0214 (filter "Ber-worktree") · ADR-0103 (auto-merge) · ADR-0008 (stage hanya maju)

## Konteks

1. **Filter "Perlu ditinjau" tak pernah mencakup hasil kerja yang sudah selesai.** ADR-0214 menyengaja
   membatasinya ke sesi yang menunggu jawaban manusia, sebab server tak mencatat status tinjau. Akibatnya
   item yang sudah selesai dan belum diperiksa tak tersaring di mana pun. Operator hanya bisa menemukannya
   dengan membuka item satu per satu. Itu "Yang tetap terbuka" butir 3 di `ui-ux-audit-2026-10.md`.
2. **Tinjauan adalah keadaan manusia, bukan keadaan sesi.** Tak ada kolom, route, atau sinyal yang
   menyatakan "sudah diperiksa". Keputusan tinjauan (integrasi, kembalikan, hapus worktree) sudah ada,
   tetapi tidak satu pun dari itu berarti "saya sudah membaca diff-nya".
3. **Sebagian besar item selesai sudah ada sebelum fitur ini.** Kalau penanda baru dibiarkan NULL untuk
   semua baris lama, setiap item selesai yang pernah dikerjakan sesi (`baseSha` terisi) langsung masuk
   filter pada hari pertama. Filter yang berisi ratusan baris sejak awal tak lagi dipercaya operator.

## Keputusan

### 1. Kolom `Spec.reviewedAt DateTime?`

- Satu kolom NULLABLE tanpa default (migration `20261012100000_spec_reviewed_at`, ADITIF). Diisi
  `ADD COLUMN` lalu backfill (keputusan 5). Tanpa tabel baru: tinjauan adalah atribut satu item, bukan
  peristiwa yang perlu riwayat.
- Makna: `null` = belum ditinjau **atau** item belum selesai. Penanda hanya bermakna untuk stage `done`.
- Bukan `doneAt`: `doneAt` tetap "selesai pertama" dan tak berubah maknanya (ADR-0105).

### 2. `POST /specs/:id/reviewed` — operasi khusus, bukan field PATCH

- Body opsional `{ reviewed?: boolean }` (default `true`). 400 bila `reviewed` bukan boolean.
- 200 = `Spec` sesudah penulisan.
- 404 = spec tak ada.
- 409 `{ error: "backlog item belum selesai" }` = menandai item yang stage-nya bukan `done`.
  Ini mencegah jebakan: tanda yang dipasang sebelum selesai tak akan di-reset oleh penyelesaian
  berikutnya, sehingga penyelesaian itu tak pernah tampil di filter.
- **Idempoten.** Menandai ulang tak menggeser stempel (tinjauan pertama yang dicatat). Membatalkan
  item yang sudah kosong tak menulis apa-apa dan tetap 200.
- Penulisan dijaga CAS `stage: done` (+ `reviewedAt: null` untuk menandai). Bila stage ditarik mundur
  antara baca dan tulis, tanda tak mendarat. Satu titik tulis: `services/spec-reviewed.ts`.
- Memanggil `notifySynced("spec", id)` (antre sync dan publish ke feed).
- **Tidak** menyentuh stage, `baseSha`, `headSha`, diff, atau berkas. Tidak ada dialog konfirmasi:
  aksinya dapat dibalik dengan aksi yang sama, dan tak membuang apa pun.

### 3. Capability dan MCP (ADR-0202)

- Capability: **`backlog:write`**, jatuh dari `rw("backlog")` secara alami (tanpa peta baru). Setara
  `POST /specs/:id/done`, bukan `backlog:lifecycle` (yang mengubah sejarah atau membuang kerja).
- Tool `hanoman_backlog_mark_reviewed`: mode **`write`**, bukan `danger`. Penanda ini bisa dibalik dan
  tidak membuang kerja, cermin `hanoman_backlog_mark_done`. `danger` dicadangkan untuk aksi yang tak
  bisa dibatalkan (ADR-0213).
- Gerbang `mcp-coverage` terpenuhi lewat `samplePath` tool. Uji katalog ada di
  `shared/src/mcp-catalog.reviewed.test.ts`, dan uji rute di `server/test/spec-reviewed.route.test.ts`.

### 4. Backfill pra-migrasi (keputusan yang diminta dicatat)

- Migration mengisi `reviewedAt = updatedAt` untuk **semua** item `stage = 'done'` yang masih NULL.
- Alasan: tanpa backfill, filter langsung membanjir (keputusan latar 3). Harga yang diterima: **penanda
  hanya berlaku untuk penyelesaian SETELAH migrasi ini.** Item lama yang belum pernah diperiksa tetap
  bisa dibuka lewat "Review perubahan", tetapi tak lagi disorot filter.
- `updatedAt` dipilih sebagai nilai, bukan waktu migrasi, supaya stempelnya menunjuk keadaan terakhir
  yang sudah ada. Stempel ini **bukan** waktu tinjauan sungguhan untuk baris lama, dan UI tak
  menampilkannya sebagai begitu.
- Item `done` tanpa `baseSha` (ditandai manual) ikut di-backfill. Ia tak tersaring filter karena
  syaratnya `baseSha`, jadi backfill-nya tak mengubah apa yang terlihat.
- Verifikasi: DB sekali-pakai berisi baris pra-migrasi (done dengan dan tanpa `baseSha`, executing,
  brainstorming). Hasilnya: done diisi `updatedAt`, non-done tetap NULL, UPDATE backfill diulang tanpa
  efek. `prisma migrate diff` terhadap `schema.prisma` menghasilkan migrasi kosong.

### 5. Kapan `reviewedAt` di-reset ke null

- **Ya**, saat stage dimundurkan dari `done`: `PATCH /specs/:id {stage}` (revert) dan `POST /specs/:id/source`
  bila ia mereset item ke brainstorming. Keduanya hanya dijalankan operator, sebab stage hanya maju secara
  otomatis (ADR-0008). Penyelesaian berikutnya lalu kembali tampil "perlu ditinjau".
- **Tidak** di `recordCompletion`. Walau kelihatan tepat, reset di sana rusak: reconcile
  (`scheduler/reconcile.ts`) memanggil `recordCompletion` untuk setiap item yang stage-nya `done` dan
  antrean-nya masih `launched`, jadi tanda yang baru dipasang bisa terhapus pada tik berikutnya.
- **Tidak** oleh integrasi. Integrasi tak mengubah stage atau diff, dan auto-merge (ADR-0103)
  menjalankannya tanpa manusia. Bila integrasi menandai otomatis, auto-merge akan menandai semua item
  tanpa ada yang meninjau. Konsekuensinya: item yang sudah diintegrasikan tetap tampil sampai operator
  menandainya.

### 6. Sinkronisasi dan webhook

- **`reviewedAt` masuk `FIELDS.spec` dan `DATE_FIELDS.spec`** (cermin `doneAt`). "Sudah ditinjau" yang
  tak sampai ke mesin lain membuat item yang sama tampil "perlu ditinjau" di dua tempat, dan kolom yang
  terlewat mendarat sebagai null palsu tanpa satu pun error (kelas ADR-0090/0093/0105).
- Konsekuensi yang diterima: sync bersifat LWW per record. Edit tertunda dari mesin yang belum melihat
  tanda bisa menimpanya. Ini sama dengan setiap kolom `Spec` lain.
- **Peer versi lama (sebelum ADR-0218) tak mengirim `reviewedAt`.** Penerima menanganinya di
  `upsertLocal` (`services/sync.ts`): bila kiriman ber-`stage` selain `done` dan kunci `reviewedAt`
  tak ada, penanda lokal dikosongkan. Tanpa ini, penyelesaian berikutnya tampil "sudah ditinjau" tanpa
  tinjauan. Kiriman `done` dari peer itu tak menyentuh penanda lokal, sebab tak ada informasi baru di
  dalamnya. Peer baru selalu mengirim kuncinya, sehingga jalur ini tak berlaku untuk mereka. Uji:
  `server/test/spec-reviewed.route.test.ts` (kasus "sync dari peer versi lama").
- **Tidak** masuk `WEBHOOK_ENTITIES.fields`. Penanda tinjauan bukan perubahan kontrak bagi penerima
  eksternal, jadi ia tak memicu `spec.updated`.

### 7. Layar (frontend)

- Predikat "Perlu ditinjau" (`reviewSpecIdsOf`) menjadi OR dari dua klausa: (a) sesi menunggu jawaban
  (tak berubah), atau (b) `stage = done` **dan** `baseSha` terisi **dan** `reviewedAt` null.
  `baseSha` jadi syarat karena item selesai tanpa sesi tak punya diff untuk ditinjau.
- Aksi "Tandai ditinjau" ada di **dua** tempat, karena keduanya dibutuhkan: bar keputusan Review (item
  `done`) dan menu item Backlog (item `done`, semua tampilan). Menu Backlog wajib: item yang worktree-nya
  sudah dihapus (ADR-0213) menampilkan keadaan kosong tanpa bar, sehingga tanpa menu tak ada jalan keluar
  dari filter.

## Konsekuensi

- **Skema:** satu kolom nullable baru dan satu backfill. Tanpa perubahan pada data lama selain stempel itu.
- **API:** `POST /specs/:id/reviewed` baru (aditif). `zSpec`/`zSpecSlim` mendapat `reviewedAt` dengan
  `.nullable().default(null)`, sehingga klien dan respons lama tetap parse. `GET /specs` ikut membawanya
  karena projection `live-specs` memilih kolom dari bentuk zod.
- **Side effect:** menandai memanggil `updatedAt` (`@updatedAt`). Ini ikut mempengaruhi LWW sync. Layar
  Backlog tidak mengurutkan menurut `updatedAt` (urutannya dari nomor SPEC dan tanggal dibuat/dikerjakan),
  jadi tak ada urutan UI yang bergeser karena tinjauan.
- **Filter Backlog** kini mencakup item selesai. Hint di layar diperbarui. Angka segmen tahap mengikuti
  himpunan yang disaring (perilaku ADR-0214 dipertahankan).

## Alternatif yang ditolak

- **Backfill NULL (tanpa backfill).** Filter membanjir pada hari pertama, dan operator belajar mengabaikannya.
- **Tabel `SpecReview` terpisah.** Berlebihan untuk satu stempel per item. Riwayat tinjauan tak diminta.
- **Reset di `recordCompletion`.** Rusak oleh reconcile (keputusan 5).
- **Tanda otomatis saat integrasi.** Auto-merge akan menandai semua item tanpa tinjauan manusia.
- **Menurunkan tinjauan dari `SessionResult` atau status git.** Tak ada hubungan yang bisa dipercaya antara
  integrasi dan tinjauan. Ini justru alasan ADR-0214 menolak klausa "stage done + baseSha".
- **Mode `danger` untuk tool MCP.** Penanda ini bisa dibalik dan tak membuang apa pun.

## Gotcha

1. `reviewedAt` harus ada di `zSpec` **dan** di kolom Prisma. `selectOf(zSpecSlim.shape)` di `live-specs.ts`
   membangun `select` dari bentuk zod, jadi kolom yang hanya ada di zod akan memecahkan query.
2. Jangan memindahkan reset ke `recordCompletion` atau ke jalur persist stage (`advanceStage`,
   reconcile, live-specs). Ketiganya dipanggil berulang untuk item yang sudah selesai.
3. Migrasi backfill memakai `"updatedAt"` (integer ms di SQLite), bukan string tanggal. Keduanya berasal
   dari kolom yang sama, sehingga tipenya cocok.
