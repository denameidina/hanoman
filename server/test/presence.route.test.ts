import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { __resetPresence, recordPresence } from "../src/services/presence/registry";
import { LOCAL_DEVICE_ID, paths } from "@hanoman/shared";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await clean(); });
beforeEach(async () => { __resetPresence(); await clean(); });

describe("GET /api/presence", () => {
  it("menjawab view berisi mesin lokal", async () => {
    const res = await app.inject({ method: "GET", url: paths.presence });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; devices: { deviceId: string }[] };
    expect(body.enabled).toBe(false);
    expect(body.devices[0]!.deviceId).toBe(LOCAL_DEVICE_ID);
  });

  it("memuat device yang sedang berdenyut", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const d = await prisma.deviceToken.create({
      data: { userId: u.id, name: "laptop", tokenHash: "h1" },
    });
    recordPresence(d.id, [{
      sessionId: "spec-919", projectId: "hanoman", agent: "claude",
      status: "working", startedAt: "2026-08-24T00:00:00.000Z",
    }]);
    const body = (await app.inject({ method: "GET", url: paths.presence })).json() as
      { enabled: boolean; devices: { deviceId: string; online: boolean }[] };
    expect(body.enabled).toBe(true);
    expect(body.devices.find((x) => x.deviceId === d.id)!.online).toBe(true);
  });

  // Peta pekerjaan lintas mesin bukan sesuatu yang boleh didelegasikan ke agent token.
  it("tak boleh didelegasikan ke agent token", () => {
    expect(capabilityForRoute("GET", "/api/presence")).toBe("COOKIE_ONLY");
  });
});
