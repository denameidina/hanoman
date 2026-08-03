-- SPEC-516 · ADR-0105 · stempel selesai backlog sebagai kolom.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu kolom NULLABLE tanpa default, tak ada tabel diredefinisi.
-- Larangan SQLite atas `ADD COLUMN … DEFAULT <non-konstan>` (lihat migration SPEC-408) tak
-- berlaku karena tak ada default sama sekali.
ALTER TABLE "Spec" ADD COLUMN "doneAt" DATETIME;

-- Backfill sekali-jalan dari stempel yang SUDAH ada: `Notification` ber-key `done:<specId>`
-- ditulis `recordCompletion` tepat pada transisi ke `done` sejak SPEC-180, di ketiga jalur
-- persist (dasar yang sama dipakai sweep auto-merge ADR-0103). Item yang selesai sebelum
-- SPEC-180 — atau yang notifikasinya dihapus operator — tetap NULL; itu keadaan sah yang
-- dilaporkan sebagai catatan di hasil changelog, bukan disamarkan.
UPDATE "Spec" SET "doneAt" = (
  SELECT n."createdAt" FROM "Notification" n WHERE n."key" = 'done:' || "Spec"."id"
) WHERE "doneAt" IS NULL;
