-- SPEC-880 · ADR-0135 · penanda "ditangani oleh": daftar hanoman client pemegang project.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu kolom NULLABLE tanpa default, tak ada tabel diredefinisi.
--
-- TANPA backfill, sengaja: sebelum spec ini penandanya memang tak ada di mana pun, dan menebaknya
-- dari SessionResult.deviceId akan mencampur "jejak eksekusi" dengan "pernyataan kepemilikan".
-- NULL = "belum ditetapkan", dan itu jawaban yang jujur.
ALTER TABLE "Project" ADD COLUMN "handledBy" JSONB;
