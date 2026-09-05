import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { MODELS, CODEX_MODELS, replaceModelCatalog } from "@hanoman/shared";
import { modelCatalogService } from "../src/services/model-catalog";
import { attach, detach, __reset } from "../src/services/events";

const initialClaude = MODELS, initialCodex = CODEX_MODELS;
afterEach(async () => {
  replaceModelCatalog(initialClaude, initialCodex);
  await prisma.customAgent.deleteMany({ where: { name: "future-model-probe" } });
  __reset();
});
describe("model discovery API", () => {
  it("serves sanitized snapshot and keeps discovery admin-only", async () => {
    expect(capabilityForRoute("GET", "/api/models")).toBe("COOKIE_ONLY");
    const app = buildApp();
    try {
      expect((await app.inject({ url: "/api/models" })).statusCode).toBe(401);
    } finally { await app.close(); }
    const local = buildApp({ requireAuth: false });
    try {
      const response = await local.inject({ url: "/api/models" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(modelCatalogService.snapshot());
      expect(JSON.stringify(response.json())).not.toContain("account");
    } finally { await local.close(); }
  });
  it("accepts a discovered future model and effort through custom-agent creation", async () => {
    replaceModelCatalog(initialClaude, [...initialCodex, { id: "gpt-future", label: "Future",
      efforts: ["new-effort"], fallback: "new-effort", minClient: "" }]);
    const app = buildApp({ requireAuth: false });
    try {
      const catalog = (await app.inject({ url: "/api/custom-agents/catalog" })).json();
      expect(catalog.models.some((m: { id: string }) => m.id === "gpt-future")).toBe(true);
      const response = await app.inject({ method: "POST", url: "/api/custom-agents", payload: {
        name: "future-model-probe", description: "probe", instructions: "probe",
        runtime: "codex", model: "gpt-future", effort: "new-effort",
      } });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ model: "gpt-future", effort: "new-effort" });
      const invalid = await app.inject({ method: "PATCH",
        url: "/api/custom-agents/global:future-model-probe", payload: { effort: "high" } });
      expect(invalid.statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it("sends the models frame to admin subscribers but not token subscribers", async () => {
    for (const maySubscribe of [false, true]) {
      const frames: { t: string }[] = [];
      const client = { send: (raw: string) => frames.push(JSON.parse(raw)), close: () => {} };
      await attach(client, { maySubscribe });
      expect(frames.some((f) => f.t === "models")).toBe(maySubscribe);
      detach(client);
    }
  });
});
