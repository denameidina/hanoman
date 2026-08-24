import type { FastifyInstance } from "fastify";
import { presenceView } from "../services/presence/view";

// SPEC-919 · ADR-0147 · muat awal + fallback halaman Klien. Bukan jalur polling: selama
// `/api/events/ws` sehat, grup siar `presence` yang mengantarkan pembaruan (ADR-0039/0145).
export default async function (app: FastifyInstance) {
  app.get("/presence", async () => presenceView());
}
