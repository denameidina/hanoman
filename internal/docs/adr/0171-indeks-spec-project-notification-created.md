# ADR-0171 — Indeks `Spec.projectId` & `Notification.createdAt`

- Status: Accepted
- Tanggal: 2026-09-25
- SPEC: — (paket P4, [plan orkestrasi mutu](../../../docs/superpowers/plans/2026-09-25-orkestrasi-mutu-multi-subagent.md))
- Terkait: [0038](0038-paginasi-di-response-layer.md) (larangan `skip`/`take` di query DB untuk
  `GET /specs`, TIDAK berlaku di sini — indeks ini tak mengubah bentuk query, hanya jalurnya),
  [0168](0168-frame-specs-ringkas-siar.md) (grup siar `specs` memuat seluruh tabel; indeks ini
  menolong query per-project yang berbeda jalur).

## Konteks

Audit 5-subagent 2026-09-25 menemukan dua full-scan di jalur yang dipanggil berulang:

1. `server/src/services/live-specs.ts:103-104` — `prisma.spec.findMany({ where: { projectId:
   filter.project, source: filter.source }, orderBy: { id: "desc" } })`, dipanggil tiap kali
   dashboard membuka satu project. `Spec` punya relasi `project` tapi Prisma/SQLite TIDAK
   otomatis mengindeks kolom FK — hanya primary key (`id`) yang punya autoindex.
2. `server/src/services/notifications.ts:219-230` (`notificationsFeed()`) — `prisma.notification
   .findMany({ orderBy: { createdAt: "desc" }, skip, take })`, dipanggil route `GET
   /notifications` DAN hub siar `events.ts` **tiap 3 detik**. `Notification` tak punya indeks
   sama sekali.

Diukur di salinan `~/.hanoman/hanoman.db` (1132 baris `Spec`, 2044 baris `Notification`),
`EXPLAIN QUERY PLAN` sebelum migration:

```
SELECT * FROM Spec WHERE projectId = 'x' ORDER BY id DESC;
  `--SCAN Spec USING INDEX sqlite_autoindex_Spec_1        -- full scan, 1132 baris diperiksa

SELECT * FROM Notification ORDER BY createdAt DESC LIMIT 50;
  |--SCAN Notification                                     -- full scan, 2044 baris
  `--USE TEMP B-TREE FOR ORDER BY                           -- + sort manual tiap panggilan
```

Sesudah migration (`CREATE INDEX`):

```
SELECT * FROM Spec WHERE projectId = 'x' ORDER BY id DESC;
  |--SEARCH Spec USING INDEX Spec_projectId_idx (projectId=?)
  `--USE TEMP B-TREE FOR ORDER BY   -- `id` bukan bagian indeks; sort sisa tetap ada, tapi
                                      -- baris yang disortir kini hanya milik satu project, bukan
                                      -- seluruh tabel

SELECT * FROM Notification ORDER BY createdAt DESC LIMIT 50;
  `--SCAN Notification USING INDEX Notification_createdAt_idx   -- sudah terurut, tanpa TEMP B-TREE
```

`Notification.readAt` (dipakai `count({ where: { readAt: null } })` di baris yang sama) sengaja
TIDAK diindeks: volume tabel rendah (belum ada retensi, lihat plan §Ditunda) dan `count()` atas
seluruh baris pada tabel sekecil ini tak jadi bottleneck terukur — menambah indeks kedua di kolom
boolean-ish (readAt null/non-null, selektivitas rendah) menambah biaya tulis tanpa manfaat baca
yang sepadan.

## Keputusan

1. `Spec`: `@@index([projectId])` di `schema.prisma`, nama Prisma default `Spec_projectId_idx`.
2. `Notification`: `@@index([createdAt])`, nama `Notification_createdAt_idx`. `readAt` tidak
   diindeks (lihat Konteks).
3. Migration ditulis tangan (bukan `prisma migrate dev`), murni ADITIF —
   `server/prisma/migrations/20260925120000_spec_project_notification_created_idx/migration.sql`
   — dua `CREATE INDEX IF NOT EXISTS`, cermin pola migration lain di repo ini (ADR-0150 dkk):
   worktree tetangga membuat `migrate dev` mereset DB saat ada drift.
4. Divalidasi di salinan `~/.hanoman/hanoman.db` (bukan DB asli): `prisma migrate deploy` bersih,
   `prisma migrate diff --from-url <salinan> --to-schema-datamodel schema.prisma` kosong (tak ada
   drift schema vs migration).

## Konsekuensi

**Positif:** `GET /specs` per project (dibuka tiap kali dashboard pindah project) dan
`notificationsFeed()` (dipanggil tiap 3 detik oleh siar `events.ts` DAN route HTTP) tak lagi
memindai seluruh tabel; `Notification` khususnya tak lagi menyortir 2044 baris di TEMP B-TREE
setiap 3 detik.

**Biaya diterima:** dua indeks menambah sedikit biaya tulis (`INSERT`/`UPDATE` pada `Spec` dan
`Notification`) — diabaikan pada volume backlog/notifikasi hanoman (ratusan–ribuan baris, satu
operator).

**Di luar scope:** indeks komposit `Spec_projectId_stage_idx` atau semacamnya (query
`live-specs.ts` lain memfilter `stage`) — tak diukur full-scan pada task ini, ditunda sampai ada
bukti serupa.
