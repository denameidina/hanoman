-- ADR-0222 · laporan run cron (tersync). Ditulis tangan, ADITIF murni: satu tabel baru.
CREATE TABLE "CronReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "cronId" TEXT NOT NULL,
    "cronName" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "sessionId" TEXT,
    "body" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CronReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CronReport_cronId_dueAt_idx" ON "CronReport"("cronId", "dueAt");
CREATE INDEX "CronReport_projectId_dueAt_idx" ON "CronReport"("projectId", "dueAt");
