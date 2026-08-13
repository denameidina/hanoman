import type { FastifyInstance } from "fastify";
import { methodStatusReport } from "../services/method-status";

// GET /api/methods/status (SPEC-739 · ADR-0114) — metode mana yang benar-benar siap dipakai di
// MESIN ini, per agen. Murni observabilitas: metode yang belum siap ditandai, tak pernah
// memblokir kelahiran sesi (ADR-0037, cermin `GET /codex/version` SPEC-339).
//
// `capabilityForRoute` tak mengenal prefix `methods` → cookie-only. Disengaja: ini properti mesin
// yang dibaca dashboard, bukan permukaan kerja agen.
export default async function methods(app: FastifyInstance) {
  app.get("/methods/status", async () => methodStatusReport());
}
