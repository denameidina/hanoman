-- ADR-0180 · sync memori: MemoryEvent.version/updatedAt, SyncState.entities (LOCAL-only)
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MemoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryEvent_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "ProjectMemory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- ADR-0180 · baris lama tak punya updatedAt: isi dengan createdAt (event append-only, tak pernah berubah).
INSERT INTO "new_MemoryEvent" ("actorId", "actorKind", "createdAt", "id", "memoryId", "op", "reason", "updatedAt") SELECT "actorId", "actorKind", "createdAt", "id", "memoryId", "op", "reason", "createdAt" FROM "MemoryEvent";
DROP TABLE "MemoryEvent";
ALTER TABLE "new_MemoryEvent" RENAME TO "MemoryEvent";
CREATE INDEX "MemoryEvent_memoryId_createdAt_idx" ON "MemoryEvent"("memoryId", "createdAt");
CREATE TABLE "new_SyncState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "cursor" TEXT NOT NULL DEFAULT '0',
    "entities" TEXT NOT NULL DEFAULT ''
);
INSERT INTO "new_SyncState" ("cursor", "id") SELECT "cursor", "id" FROM "SyncState";
DROP TABLE "SyncState";
ALTER TABLE "new_SyncState" RENAME TO "SyncState";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

