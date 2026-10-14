import type { FastifyInstance } from "fastify";
import { antigravityVersionInfo } from "../services/antigravity-version";

export default async function antigravity(app: FastifyInstance) {
  app.get("/antigravity/version", async () => antigravityVersionInfo());
}
