-- SPEC-950 · ADR-0159 · local-only evidence; intentionally absent from sync registries.
CREATE TABLE "AgentInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "specId" TEXT,
    "runtime" TEXT NOT NULL,
    "runtimeInvocationId" TEXT NOT NULL,
    "customAgentId" TEXT,
    "agentName" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "durationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "resultExcerpt" TEXT,
    "resultHash" TEXT,
    "workspaceChanged" BOOLEAN NOT NULL DEFAULT false,
    "disposition" TEXT NOT NULL DEFAULT 'pending',
    "dispositionNote" TEXT,
    "evaluatedAt" DATETIME
);

CREATE UNIQUE INDEX "AgentInvocation_sessionId_runtimeInvocationId_key"
ON "AgentInvocation"("sessionId", "runtimeInvocationId");
CREATE INDEX "AgentInvocation_agentName_startedAt_idx"
ON "AgentInvocation"("agentName", "startedAt");
CREATE INDEX "AgentInvocation_sessionId_startedAt_idx"
ON "AgentInvocation"("sessionId", "startedAt");
