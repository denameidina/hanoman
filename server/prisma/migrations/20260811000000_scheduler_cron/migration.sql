-- SPEC-646 · ADR-0112 · cronjob per project (LOCAL-ONLY, aditif murni).
CREATE TABLE "SchedulerCron" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expr" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "agent" TEXT,
    "model" TEXT,
    "effort" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "SchedulerCron_projectId_idx" ON "SchedulerCron"("projectId");
CREATE INDEX "SchedulerCron_enabled_idx" ON "SchedulerCron"("enabled");

CREATE TABLE "SchedulerCronRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cronId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sessionId" TEXT,
    "note" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SchedulerCronRun_cronId_dueAt_key" ON "SchedulerCronRun"("cronId", "dueAt");
CREATE INDEX "SchedulerCronRun_cronId_dueAt_idx" ON "SchedulerCronRun"("cronId", "dueAt");
CREATE INDEX "SchedulerCronRun_status_idx" ON "SchedulerCronRun"("status");
