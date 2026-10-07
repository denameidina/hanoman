-- ADR-0178 · memori project bersama lintas runtime
-- AlterTable
ALTER TABLE "AgentToken" ADD COLUMN "projectIds" JSONB;

-- CreateTable
CREATE TABLE "ProjectMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scopePaths" JSONB NOT NULL,
    "anchors" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "supersedesId" TEXT,
    "reviewReason" TEXT,
    "sourceRuntime" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "sourceTokenId" TEXT,
    "sourceDeviceId" TEXT,
    "commitSha" TEXT,
    "trusted" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectMemory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryEvent_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "ProjectMemory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryLocalState" (
    "memoryId" TEXT NOT NULL PRIMARY KEY,
    "verdict" TEXT NOT NULL,
    "verifiedHead" TEXT,
    "lastVerifiedAt" DATETIME,
    "lastUsedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "ProjectMemory_projectId_status_idx" ON "ProjectMemory"("projectId", "status");

-- CreateIndex
CREATE INDEX "MemoryEvent_memoryId_createdAt_idx" ON "MemoryEvent"("memoryId", "createdAt");

