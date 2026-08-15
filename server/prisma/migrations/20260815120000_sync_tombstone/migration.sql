-- SPEC-799 · ADR-0119 · tombstone sync: penghapusan sebagai keadaan pertama-kelas.
CREATE TABLE "SyncTombstone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT
);
CREATE UNIQUE INDEX "SyncTombstone_entity_recordId_key" ON "SyncTombstone"("entity", "recordId");

-- Additive & default aman: seluruh baris feed lama terbaca sebagai "upsert".
ALTER TABLE "SyncLog" ADD COLUMN "op" TEXT NOT NULL DEFAULT 'upsert';
