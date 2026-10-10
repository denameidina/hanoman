-- ADR-0182: user requested removal of these features AND their stored data.
-- Purge sync payloads/outboxes first so retired records cannot be replayed.
DELETE FROM "SyncLog" WHERE "entity" IN ('projectMemory', 'memoryEvent');
DELETE FROM "SyncOutbox" WHERE "entity" IN ('projectMemory', 'memoryEvent');
DELETE FROM "SyncConflict" WHERE "entity" IN ('projectMemory', 'memoryEvent');
DELETE FROM "SyncTombstone" WHERE "entity" IN ('projectMemory', 'memoryEvent');
UPDATE "SyncState" SET "entities" = trim(replace(replace(',' || "entities" || ',', ',projectMemory,', ','), ',memoryEvent,', ','), ',');
DELETE FROM "Notification" WHERE "type" = 'memory';
UPDATE "Setting" SET "data" = json_remove("data", '$.changelog') WHERE json_type("data", '$.changelog') IS NOT NULL;
UPDATE "AgentToken" SET "capabilities" = (
    SELECT json_group_array(value) FROM json_each("AgentToken"."capabilities")
    WHERE value NOT IN ('memory:read', 'memory:write')
);

DROP TABLE "MemoryEvent";
DROP TABLE "MemoryLocalState";
DROP TABLE "ProjectMemory";
DROP TABLE "Changelog";

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);
INSERT INTO "new_AgentToken" ("capabilities", "createdAt", "createdBy", "enabled", "id", "lastUsedAt", "name", "revokedAt", "tokenHash", "tokenPrefix") SELECT "capabilities", "createdAt", "createdBy", "enabled", "id", "lastUsedAt", "name", "revokedAt", "tokenHash", "tokenPrefix" FROM "AgentToken";
DROP TABLE "AgentToken";
ALTER TABLE "new_AgentToken" RENAME TO "AgentToken";
CREATE UNIQUE INDEX "AgentToken_tokenHash_key" ON "AgentToken"("tokenHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

