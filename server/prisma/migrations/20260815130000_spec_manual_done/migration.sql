-- SPEC-804 · ADR-0120 · jejak penandaan selesai manual sebagai kolom.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu kolom NULLABLE tanpa default, tak ada tabel diredefinisi.
--
-- TANPA backfill, sengaja: sebelum spec ini jalur "tandai selesai manual" memang tak ada, jadi
-- tak ada stempel lama yang bisa dipulihkan. Item lama tetap NULL = "selesai lewat sesi / tak
-- diketahui", dan itu jawaban yang jujur.
ALTER TABLE "Spec" ADD COLUMN "manualDone" JSONB;
