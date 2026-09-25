-- ADR-0171 · dua full-scan terukur lewat EXPLAIN QUERY PLAN:
-- `Spec.projectId` (GET /specs per project, live-specs.ts:103-104) dan
-- `Notification.createdAt` (notificationsFeed() `ORDER BY createdAt DESC LIMIT n`,
-- notifications.ts:224-226, dipanggil tiap 3 detik oleh events.ts). ADITIF murni.
CREATE INDEX IF NOT EXISTS "Spec_projectId_idx" ON "Spec" ("projectId");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification" ("createdAt");
