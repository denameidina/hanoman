-- ADR-0164 · LOCAL-only. Baris sebelum orkestrasi tetap null: tak ada fase yang bisa dikarang.
ALTER TABLE "AgentInvocation" ADD COLUMN "phase" TEXT;
ALTER TABLE "AgentInvocation" ADD COLUMN "effort" TEXT;
