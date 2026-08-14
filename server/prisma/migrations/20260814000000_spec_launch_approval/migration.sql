ALTER TABLE "Spec" ADD COLUMN "launchApprovedAt" DATETIME;
ALTER TABLE "Spec" ADD COLUMN "launchApprovedBy" TEXT;

UPDATE "Spec"
SET "launchApprovedAt" = CURRENT_TIMESTAMP,
    "launchApprovedBy" = 'legacy-admin';
