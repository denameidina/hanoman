import type { FastifyInstance } from "fastify";
import { getOverview } from "../services/overview-source";

// ADR-0220 · muat untuk agen/MCP. Dashboard TIDAK memanggilnya: grup siar `overview` di
// /api/events/ws yang mengantar agregat ini (ADR-0039).
export default async function (app: FastifyInstance) {
  app.get("/overview", async () => getOverview());
}
