ALTER TABLE "CustomAgent" ADD COLUMN "activation" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "CustomAgent" ADD COLUMN "effort" TEXT;
ALTER TABLE "CustomAgent" ADD COLUMN "workspacePolicy" TEXT NOT NULL DEFAULT 'inherit';
ALTER TABLE "CustomAgent" ADD COLUMN "maxTurns" INTEGER;
ALTER TABLE "CustomAgent" ADD COLUMN "timeoutSeconds" INTEGER;
