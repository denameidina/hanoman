import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { __resetRecorder } from "../src/services/overview-recorder";
import { getOverview } from "../src/services/overview-source";
import { resetDb, makeProject, makeSpec } from "./factory";
import { paths, zOverview, MCP_TOOLS } from "@hanoman/shared";

const app = buildApp({ requireAuth: false });
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  __resetRecorder();
  await resetDb();
  await prisma.sessionHistory.deleteMany();
  await prisma.agentInvocation.deleteMany();
  await makeProject();
});

describe("GET /api/overview", () => {
  it("menjawab DTO yang lolos zOverview, dari baris DB sungguhan", async () => {
    const now = new Date();
    await makeSpec({ id: "SPEC-OV1", stage: "done", startedAt: now, doneAt: now });
    await prisma.sessionHistory.create({ data: { id: "h1", sessionId: "s1", projectId: "p1", kind: "spec",
      agent: "claude", cwd: "/tmp", startedAt: now, endedAt: now, exitCode: 1, endedReason: "closed" } });
    await prisma.agentInvocation.create({ data: { id: "i1", sessionId: "s1", projectId: "p1", runtime: "claude",
      runtimeInvocationId: "r1", agentName: "implementer", status: "done", startedAt: now,
      inputTokens: 10, outputTokens: 5, cachedTokens: 30 } });
    const res = await app.inject({ method: "GET", url: paths.overview });
    expect(res.statusCode).toBe(200);
    const body = zOverview.parse(res.json());
    expect(body.today).toEqual({ landed: 1, failed: 1 });
    expect(body.tokens?.total).toBe(45);
    expect(body.headline.text).toBe("1 sesi tumbang dan 1 spec mendarat.");
  });

  it("GLOBAL_READ untuk baca, cookie-only untuk tulis", () => {
    expect(capabilityForRoute("GET", "/api/overview")).toBe("GLOBAL_READ");
    expect(capabilityForRoute("POST", "/api/overview")).toBe("COOKIE_ONLY");
  });

  it("tool MCP hanoman_overview_get memanggil GET /overview tanpa capability", () => {
    // Katalog tak mengekspor peta per-nama (rencana menyebut `TOOLS_BY_NAME`); cari di MCP_TOOLS.
    const t = MCP_TOOLS.find((x) => x.name === "hanoman_overview_get");
    expect(t).toBeDefined();
    expect(t!.capability).toBeNull();
    expect(t!.build({})).toEqual({ method: "GET", path: "/overview" });
  });

  it("getOverview tak melempar walau DB kosong", async () => {
    await expect(getOverview()).resolves.toMatchObject({ today: { landed: 0, failed: 0 } });
  });
});
