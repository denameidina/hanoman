-- SPEC-854 · ADR-0129 · chat portal klien (LOCAL-only)
CREATE TABLE "PortalChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "prdMarkdown" TEXT,
    "prdReadyAt" DATETIME,
    "prdDocPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PortalChatSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortalChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PortalChatSession_projectId_type_periodKey_idx" ON "PortalChatSession"("projectId", "type", "periodKey");

CREATE TABLE "PortalChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rawText" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReasons" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PortalChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PortalChatMessage_sessionId_seq_key" ON "PortalChatMessage"("sessionId", "seq");
