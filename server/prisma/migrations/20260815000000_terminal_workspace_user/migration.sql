-- SPEC-786 · workspace Terminal kanonik per akun admin, LOCAL-only.
ALTER TABLE "User" ADD COLUMN "terminalWorkspace" JSONB;
ALTER TABLE "User" ADD COLUMN "terminalWorkspaceRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "terminalWorkspaceUpdatedAt" DATETIME;
