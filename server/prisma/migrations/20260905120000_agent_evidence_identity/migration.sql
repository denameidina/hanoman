-- LOCAL-only evidence. Historical definitions and unassessed rework remain unknown.
ALTER TABLE "AgentInvocation" ADD COLUMN "definitionHash" TEXT;
ALTER TABLE "AgentInvocation" ADD COLUMN "reworkRequired" BOOLEAN;
