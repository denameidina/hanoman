import type { FastifyInstance } from "fastify";
import { modelCatalogService } from "../services/model-catalog";

export default async function models(app: FastifyInstance) {
  app.get("/models", async () => modelCatalogService.snapshot());
}
