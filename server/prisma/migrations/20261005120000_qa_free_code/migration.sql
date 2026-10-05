-- ADR-0176 · kode test case & temuan QA bebas ketikan QA (nullable; null = nomor otomatis)
ALTER TABLE "QaCase" ADD COLUMN "code" TEXT;
ALTER TABLE "QaFinding" ADD COLUMN "code" TEXT;
