-- ADR-0218 · penanda "sudah ditinjau" pada item selesai (filter Backlog "Perlu ditinjau").
--
-- Ditulis tangan (bukan `migrate dev`), pola SPEC-516/SPEC-804: worktree tetangga membuat
-- `migrate dev` me-reset DB saat ada drift. ADITIF murni — satu kolom NULLABLE tanpa default.
ALTER TABLE "Spec" ADD COLUMN "reviewedAt" DATETIME;

-- Backfill sekali-jalan: item yang SUDAH selesai dianggap sudah ditinjau pada `updatedAt`-nya.
-- Tanpa ini setiap item selesai yang pernah dikerjakan sesi (baseSha terisi) langsung masuk
-- "Perlu ditinjau" begitu migrasi jalan, dan filter yang sejak hari pertama berisi ratusan baris
-- tak lagi bisa dipercaya. Harganya diterima dan ditulis di ADR-0218: penanda hanya berlaku untuk
-- penyelesaian SETELAH migrasi ini. Item lama yang belum pernah ditinjau tetap bisa dibuka lewat
-- Review perubahan, hanya saja tidak lagi disorot oleh filter.
UPDATE "Spec" SET "reviewedAt" = "updatedAt" WHERE "stage" = 'done' AND "reviewedAt" IS NULL;
