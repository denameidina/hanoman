-- CreateTable
CREATE TABLE "QaReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "buildVersion" TEXT NOT NULL DEFAULT '',
    "environment" JSONB,
    "scope" TEXT NOT NULL DEFAULT '',
    "tester" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "verdict" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QaReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QaCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "steps" TEXT NOT NULL DEFAULT '',
    "expected" TEXT NOT NULL DEFAULT '',
    "actual" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "order" REAL NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QaCase_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "QaReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QaFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "caseId" TEXT,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'major',
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "area" TEXT NOT NULL DEFAULT '',
    "steps" JSONB,
    "expected" TEXT NOT NULL DEFAULT '',
    "actual" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "backlogId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QaFinding_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "QaReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QaAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "syncState" TEXT NOT NULL DEFAULT 'local-only',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QaAttachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "QaReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "QaReport_projectId_createdAt_idx" ON "QaReport"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "QaCase_reportId_order_idx" ON "QaCase"("reportId", "order");

-- CreateIndex
CREATE INDEX "QaFinding_reportId_idx" ON "QaFinding"("reportId");

-- CreateIndex
CREATE INDEX "QaAttachment_reportId_idx" ON "QaAttachment"("reportId");

-- CreateIndex
CREATE INDEX "QaAttachment_ownerType_ownerId_idx" ON "QaAttachment"("ownerType", "ownerId");
