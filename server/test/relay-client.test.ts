import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RELAY_UNSUPPORTED_RETRY_MS } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import {
  __relayClientLastDelayMs, __resetRelayClient, installRelayClient, relayClientStatus, startRelayClient,
} from "../src/services/relay/client";
import { injectableFrom } from "../src/services/relay/dispatcher";
import { __resetRelayHub, relayControlFor, requestRelay } from "../src/services/relay/hub";
import { startSyncClient, stopSyncClient } from "../src/services/sync-client";
import { makeSetting } from "./factory";

const hub = buildApp({ requireAuth: false });
const client = buildApp();
let hubBase = "";
let counting: Server;
let countingBase = "";
let upgrades = 0;
const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };

const clean = async () => {
  await prisma.logEntry.deleteMany(); await prisma.deviceToken.deleteMany();
  await prisma.user.deleteMany(); await prisma.setting.deleteMany();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (ok: () => boolean | Promise<boolean>, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > deadline) throw new Error("timeout"); await sleep(20); }
};
async function device() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return issueDeviceToken(u.id, "laptop");
}
const grant = (enabled: boolean) => makeSetting({ remoteControl: { enabled, capabilities: ["sessions:read"] } });

beforeAll(async () => {
  await hub.listen({ port: 0, host: "127.0.0.1" });
  hubBase = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
  // Hub versi lama: route relay tak ada → upgrade dijawab 404.
  counting = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  counting.on("upgrade", (_req, socket) => {
    upgrades++;
    socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((r) => counting.listen(0, "127.0.0.1", () => r()));
  countingBase = `http://127.0.0.1:${(counting.address() as AddressInfo).port}`;
});
afterAll(async () => {
  __resetRelayClient(); stopSyncClient();
  await hub.close(); await client.close();
  await new Promise<void>((r) => counting.close(() => r()));
  await clean();
});
beforeEach(async () => { stopSyncClient(); __resetRelayClient(); __resetRelayHub(); upgrades = 0; await clean(); });

describe("tautan relay klien (SPEC-1215 · ADR-0165 §1)", () => {
  it("instance tanpa app terpasang tak pernah membuka relay (AC-M1)", async () => {
    await grant(true);
    startRelayClient(countingBase, "tok");
    await sleep(300);
    expect(upgrades).toBe(0);
    expect(relayClientStatus().state).toBe("off");
  });

  it("grant mati = NOL upgrade ke hub (AC-A1)", async () => {
    installRelayClient(injectableFrom(client));
    await grant(false);
    startRelayClient(countingBase, "tok");
    await sleep(300);
    expect(upgrades).toBe(0);
    expect(relayClientStatus().state).toBe("off");
  });

  it("upgrade 404 → unsupported, tak mengetuk lagi sebelum 30 mnt (AC-A12)", async () => {
    installRelayClient(injectableFrom(client));
    await grant(true);
    startRelayClient(countingBase, "tok");
    await waitFor(() => relayClientStatus().state === "unsupported");
    await sleep(1_500); // backoff normal akan mengetuk lagi dalam ≤ 1,2 dtk
    expect(upgrades).toBe(1);
    expect(__relayClientLastDelayMs()).toBe(RELAY_UNSUPPORTED_RETRY_MS);
    expect(relayClientStatus().lastClose?.code).toBe(404);
  });

  it("grant menyala → hello ≤ 5 dtk, requestRelay ujung-ke-ujung, audit beraktor (AC-A2, AC-A8)", async () => {
    const t = await device();
    installRelayClient(injectableFrom(client));
    await grant(true);
    const t0 = Date.now();
    startRelayClient(hubBase, t.token);
    await waitFor(() => relayControlFor(t.id)?.state === "available", 5_000);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(relayClientStatus()).toMatchObject({ state: "open", hubOrigin: hubBase });
    const res = await requestRelay(t.id, { method: "GET", path: "/api/terminal/sessions", actor });
    expect(res.status).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    await waitFor(async () => !!(await prisma.logEntry.findFirst({ where: { kind: "remote.request" } })));
    const audit = await prisma.logEntry.findFirstOrThrow({ where: { kind: "remote.request" } });
    expect(audit.data).toMatchObject({ actor, method: "GET", path: "/api/terminal/sessions", status: 200 });
    await waitFor(async () => !!(await prisma.logEntry.findFirst({ where: { kind: "remote.link" } })));
  });

  it("hub tak terjangkau: start tak memblokir, lalu backoff (AC-M2)", async () => {
    installRelayClient(injectableFrom(client));
    await grant(true);
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", () => r()));
    const port = (dead.address() as AddressInfo).port;
    await new Promise<void>((r) => dead.close(() => r()));
    const t0 = Date.now();
    startRelayClient(`http://127.0.0.1:${port}`, "tok");
    expect(Date.now() - t0).toBeLessThan(50);
    await waitFor(() => relayClientStatus().state === "backoff");
    expect(__relayClientLastDelayMs()!).toBeLessThanOrEqual(1_200);
  });

  it("token ditolak hub → rejected (401) lalu backoff biasa", async () => {
    installRelayClient(injectableFrom(client));
    await grant(true);
    startRelayClient(hubBase, "token-palsu");
    await waitFor(() => relayClientStatus().state === "rejected");
    expect(relayClientStatus().lastClose?.code).toBe(401);
    expect(__relayClientLastDelayMs()!).toBeLessThanOrEqual(1_200);
  });

  it("startSyncClient membuka relay; stopSyncClient menutupnya", async () => {
    const t = await device();
    installRelayClient(injectableFrom(client));
    await grant(true);
    await startSyncClient(hubBase, t.token, 60_000);
    await waitFor(() => relayControlFor(t.id)?.state === "available");
    stopSyncClient();
    expect(relayClientStatus().state).toBe("off");
    await waitFor(() => relayControlFor(t.id) === null);
  });
});
