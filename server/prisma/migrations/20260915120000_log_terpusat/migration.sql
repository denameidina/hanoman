-- SPEC-1215 · ADR-0166 · LOCAL-only per instance; bukan entitas sync. Nol backfill, tabel lain tak disentuh.
CREATE TABLE "LogEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "ts" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "projectId" TEXT,
    "specId" TEXT,
    "sessionId" TEXT,
    "msg" TEXT NOT NULL,
    "data" JSONB,
    "transcriptKey" TEXT,
    "bytes" INTEGER NOT NULL
);

CREATE TABLE "LogCursor" (
    "deviceId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("deviceId", "lane")
);

CREATE UNIQUE INDEX "LogEntry_deviceId_lane_seq_key" ON "LogEntry"("deviceId", "lane", "seq");
CREATE INDEX "LogEntry_ts_idx" ON "LogEntry"("ts");
CREATE INDEX "LogEntry_deviceId_ts_idx" ON "LogEntry"("deviceId", "ts");
CREATE INDEX "LogEntry_projectId_ts_idx" ON "LogEntry"("projectId", "ts");
CREATE INDEX "LogEntry_specId_ts_idx" ON "LogEntry"("specId", "ts");
CREATE INDEX "LogEntry_lane_ts_idx" ON "LogEntry"("lane", "ts");
