import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { deviceSocketCount } from "../src/services/device-sockets";

const app = buildApp();
let host = "";
const clean = async () => {
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });
beforeEach(clean);

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0]!;
async function loginAndDevice() {
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  const user = await prisma.user.findFirstOrThrow();
  return { cookie: cookieOf(setup), device: await issueDeviceToken(user.id, "laptop") };
}
const open = (path: string, token: string) => new Promise<WebSocket>((resolve, reject) => {
  const ws = new WebSocket(`ws://${host}${path}`, { headers: { authorization: `Bearer ${token}` } });
  ws.once("open", () => resolve(ws));
  ws.once("error", reject);
});
const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
const upgradeStatus = (path: string, token: string) => new Promise<number>((resolve) => {
  const ws = new WebSocket(`ws://${host}${path}`, { headers: { authorization: `Bearer ${token}` } });
  ws.once("unexpected-response", (_req, res) => { resolve(res.statusCode ?? 0); ws.terminate(); });
  ws.once("open", () => { resolve(101); ws.close(); });
  ws.once("error", () => {});
});

describe("pencabutan device token seketika (SPEC-1215 · ADR-0165 §7 · AC-A4)", () => {
  it("socket sync ditutup 1008 sebelum DELETE membalas 204, bukan menunggu revalidasi 60 dtk", async () => {
    const { cookie, device } = await loginAndDevice();
    const sync = await open("/api/sync/ws", device.token);
    await waitFor(() => deviceSocketCount(device.id, "sync") === 1);
    const code = closeCode(sync);
    const started = Date.now();
    const del = await app.inject({ method: "DELETE", url: `/api/device-tokens/${device.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect(deviceSocketCount(device.id)).toBe(0);
    expect(await code).toBe(1008);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("reconnect memakai token yang sudah dicabut ditolak 401", async () => {
    const { cookie, device } = await loginAndDevice();
    await app.inject({ method: "DELETE", url: `/api/device-tokens/${device.id}`, headers: { cookie } });
    expect(await upgradeStatus("/api/sync/ws", device.token)).toBe(401);
  });

  it("socket relay ikut ditutup 1008 sebelum 204 (AC-A4)", async () => {
    const { cookie, device } = await loginAndDevice();
    const sync = await open("/api/sync/ws", device.token);
    const relay = await open("/api/sync/relay/ws", device.token);
    relay.send(JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read"] }));
    await waitFor(() => deviceSocketCount(device.id, "relay") === 1 && deviceSocketCount(device.id, "sync") === 1);
    const codes = Promise.all([closeCode(sync), closeCode(relay)]);
    const del = await app.inject({ method: "DELETE", url: `/api/device-tokens/${device.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect(deviceSocketCount(device.id)).toBe(0);
    expect(await codes).toEqual([1008, 1008]);
    expect(await upgradeStatus("/api/sync/relay/ws", device.token)).toBe(401);
  });
});
