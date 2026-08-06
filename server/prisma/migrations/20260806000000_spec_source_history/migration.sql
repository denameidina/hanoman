-- SPEC-546 · ADR-0109 · jejak konversi type backlog item.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu kolom NULLABLE tanpa default, tak ada tabel diredefinisi, jadi
-- aman untuk hub produksi.
--
-- TANPA backfill, dan itu disengaja: sebelum SPEC-546 mengubah `source` sebuah item memang tidak
-- mungkin, jadi tak ada jejak lama yang bisa dipulihkan dari sumber mana pun. NULL di sini
-- berarti persis "item ini belum pernah dikonversi".
ALTER TABLE "Spec" ADD COLUMN "sourceHistory" JSONB;
