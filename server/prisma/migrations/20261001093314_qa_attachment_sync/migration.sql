-- Workspace QA · bagian 3 · QaAttachment ikut changefeed: + version, + updatedAt (jam LWW), + indeks syncState.
-- `updatedAt` NOT NULL tanpa default (cermin @updatedAt Prisma), jadi baris yang SUDAH ada (lampiran dari
-- bagian 1) diisi dari `createdAt` — hasil generate Prisma tak mengisinya dan akan gagal di DB berisi.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QaAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "syncState" TEXT NOT NULL DEFAULT 'local-only',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QaAttachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "QaReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QaAttachment" ("createdAt", "updatedAt", "filename", "id", "mimeType", "ownerId", "ownerType", "projectId", "reportId", "sha256", "size", "storageKey", "syncState") SELECT "createdAt", "createdAt", "filename", "id", "mimeType", "ownerId", "ownerType", "projectId", "reportId", "sha256", "size", "storageKey", "syncState" FROM "QaAttachment";
DROP TABLE "QaAttachment";
ALTER TABLE "new_QaAttachment" RENAME TO "QaAttachment";
CREATE INDEX "QaAttachment_reportId_idx" ON "QaAttachment"("reportId");
CREATE INDEX "QaAttachment_ownerType_ownerId_idx" ON "QaAttachment"("ownerType", "ownerId");
CREATE INDEX "QaAttachment_syncState_idx" ON "QaAttachment"("syncState");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
