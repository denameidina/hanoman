-- ADR-0228 · inbox & antrean izin sesi lead; tautan keputusan → event.
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "question" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sessionId" TEXT,
    "specId" TEXT,
    "deadlineAt" DATETIME,
    "deliveredAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "closedAt" DATETIME,
    "decisionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "LeadApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "gateReport" JSONB NOT NULL,
    "verdict" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "LeadDecision" ADD COLUMN "eventId" TEXT;

CREATE INDEX "LeadEvent_projectId_status_priority_createdAt_idx" ON "LeadEvent"("projectId", "status", "priority", "createdAt");
CREATE INDEX "LeadApproval_projectId_status_idx" ON "LeadApproval"("projectId", "status");
CREATE INDEX "LeadApproval_eventId_idx" ON "LeadApproval"("eventId");
