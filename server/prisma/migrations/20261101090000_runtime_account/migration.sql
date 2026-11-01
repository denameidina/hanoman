-- AlterTable
ALTER TABLE "SessionHistory" ADD COLUMN "accountId" TEXT;

-- CreateTable
CREATE TABLE "RuntimeAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runtime" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "homeDir" TEXT NOT NULL,
    "identity" JSONB,
    "status" TEXT NOT NULL DEFAULT 'belum-login',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "RuntimeAccount_runtime_label_key" ON "RuntimeAccount"("runtime", "label");

