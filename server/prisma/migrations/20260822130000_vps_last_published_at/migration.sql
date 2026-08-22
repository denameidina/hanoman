-- SPEC-885 · ADR-0138 · aditif, nullable, tanpa default: nol backfill dan aman untuk hub
-- produksi yang sedang berjalan (hub = live, migrate additif saja).
ALTER TABLE "Vps" ADD COLUMN "lastPublishedAt" DATETIME;
