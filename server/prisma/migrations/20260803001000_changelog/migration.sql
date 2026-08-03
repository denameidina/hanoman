-- SPEC-516 · ADR-0105 · changelog naratif per project.
--
-- Ditulis tangan (bukan `migrate dev`). ADITIF murni — satu tabel baru, nol tabel diredefinisi,
-- nol baris disentuh. TANPA kolom `version`: tabel ini LOCAL-only dan tak pernah masuk
-- changefeed sync, persis alasan `LeadFlow` & `WebhookEndpoint`.
CREATE TABLE "Changelog" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "mode"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "params"    JSONB NOT NULL,
    "body"      TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "warning"   TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Changelog_projectId_fkey" FOREIGN KEY ("projectId")
      REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Changelog_projectId_createdAt_idx" ON "Changelog"("projectId", "createdAt");
