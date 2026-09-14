import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { PRESENCE_PROTOCOL } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetPresence, presenceEntries } from "../src/services/presence/registry";
import { __resetRelayHub, relayControlFor } from "../src/services/relay/hub";

const app = buildApp({ requireAuth: false });
let host = "";
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };
beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });
beforeEach(async () => { __resetRelayHub(); __resetPresence(); await clean(); });

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
async function device() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return issueDeviceToken(u.id, "laptop");
}
const open = (path: string, token: string) => new Promise<WebSocket>((resolve, reject) => {
  const ws = new WebSocket(`ws://${host}${path}`, { headers: { authorization: `Bearer ${token}` } });
  ws.once("open", () => resolve(ws));
  ws.once("error", reject);
});
const nextMessage = (ws: WebSocket) => new Promise<any>((resolve) => ws.once("message", (raw) => resolve(JSON.parse(String(raw)))));
const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
const hello = (protocol = 1) => JSON.stringify({ t: "hello", v: 1, protocol, version: "0.5.0", capabilities: ["sessions:read"] });
const presence = JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions: [] });

describe("GET /api/sync/relay/ws (SPEC-1215 · ADR-0165 §1)", () => {
  it("query token → 401; tanpa Bearer → 401", async () => {
    const status = (url: string, headers: Record<string, string> = {}) => new Promise<number>((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.once("unexpected-response", (_r, res) => { resolve(res.statusCode ?? 0); ws.terminate(); });
      ws.once("open", () => { resolve(101); ws.close(); });
      ws.once("error", () => {});
    });
    expect(await status(`ws://${host}/api/sync/relay/ws?token=abc`)).toBe(401);
    expect(await status(`ws://${host}/api/sync/relay/ws`)).toBe(401);
  });

  it("hello → welcome dan control available beratribusi device dari TOKEN", async () => {
    const t = await device();
    const relay = await open("/api/sync/relay/ws", t.token);
    const welcome = nextMessage(relay);
    relay.send(hello());
    expect(await welcome).toMatchObject({ t: "welcome", protocol: 1 });
    await waitFor(() => relayControlFor(t.id)?.state === "available");
    relay.close();
    await waitFor(() => relayControlFor(t.id) === null);
  });

  it("relay kedua menggantikan yang pertama dengan 4000", async () => {
    const t = await device();
    const first = await open("/api/sync/relay/ws", t.token);
    const code = closeCode(first);
    const second = await open("/api/sync/relay/ws", t.token);
    expect(await code).toBe(4000);
    second.close();
  });

  it("protokol beda → relay 4001, socket sync device yang sama TETAP hidup (AC-A9, AC-A11)", async () => {
    const t = await device();
    const sync = await open("/api/sync/ws", t.token);
    const relay = await open("/api/sync/relay/ws", t.token);
    const code = closeCode(relay);
    relay.send(hello(2));
    expect(await code).toBe(4001);
    expect(relayControlFor(t.id)?.state).toBe("protocol-mismatch");
    sync.send(presence);
    await waitFor(() => presenceEntries().some((e) => e.deviceId === t.id));
    expect(sync.readyState).toBe(WebSocket.OPEN);
    sync.close();
  });

  it("frame relay > 64 KiB → relay 1009, socket sync tetap hidup (AC-A11)", async () => {
    const t = await device();
    const sync = await open("/api/sync/ws", t.token);
    const relay = await open("/api/sync/relay/ws", t.token);
    const code = closeCode(relay);
    relay.send("x".repeat(70 * 1024));
    expect(await code).toBe(1009);
    await new Promise((r) => setTimeout(r, 100));
    expect(sync.readyState).toBe(WebSocket.OPEN);
    sync.close();
  });
});
