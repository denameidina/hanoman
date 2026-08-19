-- SPEC-843 · ADR-0124 · lampiran per backlog item.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu tabel baru, tak ada tabel yang diredefinisi.
--
-- TANPA kolom `version`: entitas ini LOCAL-only dan tak pernah masuk changefeed sync.
CREATE TABLE "SpecAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "specId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecAttachment_specId_fkey" FOREIGN KEY ("specId") REFERENCES "Spec" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SpecAttachment_specId_idx" ON "SpecAttachment"("specId");
