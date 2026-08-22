-- SPEC-883 · ADR-0137 · penandaan komponen hasil probe + profil provisioning.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — tiga kolom NULLABLE tanpa default, tak ada tabel diredefinisi.
--
-- TANPA backfill, sengaja: sebelum spec ini status komponen memang tak pernah diukur di mana pun.
-- NULL = "belum diperiksa", dan itu jawaban yang jujur — bukan "tak ada komponen".
ALTER TABLE "Vps" ADD COLUMN "components" JSONB;
ALTER TABLE "Vps" ADD COLUMN "componentsCheckedAt" DATETIME;
ALTER TABLE "Vps" ADD COLUMN "provisionProfile" TEXT;
