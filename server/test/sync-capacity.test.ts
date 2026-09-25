import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { capacityFrameJson, type LaunchStatus } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetPresence, capacityFor } from "../src/services/presence/registry";

const app = buildApp({ requireAuth: false });
let host = "";
const admission: LaunchStatus = {
  enabled: true, liveCount: 2, liveAgentCount: 1, maxConcurrent: 4, loadPerCore: 0.5, maxLoadPerCore: 1.5, loadStatus: "available",
  memAvailablePct: 50, minMemAvailablePct: 15, memStatus: "available",
};
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });
beforeEach(async () => { __resetPresence(); await clean(); });

async function openSync() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  const t = await issueDeviceToken(u.id, "laptop");
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(`ws://${host}/api/sync/ws`, { headers: { authorization: `Bearer ${t.token}` } });
    s.once("open", () => resolve(s)); s.once("error", reject);
  });
  return { t, ws };
}

describe("frame capacity di /api/sync/ws (SPEC-1215 · AC-A10)", () => {
  it("dicatat ke registry beratribusi device dari TOKEN", async () => {
    const { t, ws } = await openSync();
    ws.send(capacityFrameJson(admission));
    await waitFor(() => capacityFor(t.id) !== null);
    expect(capacityFor(t.id)).toEqual(admission);
    ws.close();
    await waitFor(() => capacityFor(t.id) === null);
  });

  it("frame capacity rusak dibuang tanpa menutup socket sync", async () => {
    const { t, ws } = await openSync();
    ws.send(JSON.stringify({ t: "capacity", v: 1, admission, extra: true }));
    ws.send(JSON.stringify({ t: "capacity", v: 1, admission: { liveCount: "banyak" } }));
    await new Promise((r) => setTimeout(r, 150));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(capacityFor(t.id)).toBeNull();
    ws.close();
  });
});
