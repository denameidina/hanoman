-- SPEC-844 · ADR-0125 · riwayat sesi mencatat BAGAIMANA sebuah baris ditutup.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — dua kolom NULLABLE tanpa default, tak ada tabel diredefinisi, jadi
-- jebakan `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` (ADR-0090) tak berlaku di sini.
ALTER TABLE "SessionHistory" ADD COLUMN "endedReason" TEXT;
ALTER TABLE "SessionHistory" ADD COLUMN "reconciledAt" DATETIME;

-- Backfill SEKALI JALAN. Baris lama tak bisa ditanyai, tapi jejaknya masih ada: `reconcileHistory`
-- membaca `updatedAt` SEBELUM update-nya sendiri (jadi `updatedAt` melompat ke waktu boot dan
-- meninggalkan `endedAt` di belakang), sementara `finishSession` menulis `endedAt = new Date()` DI
-- DALAM update yang sama (jadi jaraknya nol). Terukur pada DB hidup 806 baris: tutup normal
-- 0–39 ms (n=777) vs rekonsiliasi 275 966–82 224 277 ms (n=20) — empat orde besaran tanpa satu pun
-- baris di antaranya; ambang 60 000 ms duduk di tengah celah itu.
--
-- Ini backfill, BUKAN aturan render: menjadikannya kontrak akan mengunci detail penyimpanan Prisma
-- sebagai semantik produk. Prisma menyimpan DateTime SQLite sebagai INTEGER milidetik, jadi
-- selisihnya aritmetika biasa; `CAST` dipasang supaya representasi lain (teks ISO) menghasilkan
-- selisih 0 → nol baris cocok → seluruh tabel jatuh ke 'closed', yaitu perilaku sebelum spec ini.
UPDATE "SessionHistory"
   SET "endedReason" = 'reconciled', "reconciledAt" = "updatedAt"
 WHERE "endedAt" IS NOT NULL
   AND CAST("updatedAt" AS INTEGER) - CAST("endedAt" AS INTEGER) > 60000;

UPDATE "SessionHistory"
   SET "endedReason" = 'closed'
 WHERE "endedAt" IS NOT NULL AND "endedReason" IS NULL;
