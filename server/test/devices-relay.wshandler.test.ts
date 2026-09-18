import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { attachRelaySocket, __resetRelayHub } from "../src/services/relay/hub";
import { __resetDeviceSockets } from "../src/services/device-sockets";

const app = buildApp();
let cookie = "";
beforeEach(async () => { __resetRelayHub(); __resetDeviceSockets(); await prisma.user.deleteMany(); await prisma.deviceToken.deleteMany(); cookie = ""; });
afterAll(async () => { await app.close(); });

async function login() {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op@d.co", password: "password1" } });
  cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
}
async function ticketFor(target: string) {
  const t = await app.inject({ method: "POST", url: "/api/ws-tickets", headers: { cookie }, payload: { target } });
  return t.json().ticket as string;
}

const hubHello = (deviceId: string) => {
  const fakeSocket = { readyState: 1, send: () => {}, close: () => {} };
  attachRelaySocket(deviceId, fakeSocket).onMessage(JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read"] }));
};

describe("devices-relay wsHandler (SPEC-1218 · AC-C5/AC-C6)", () => {
  it("device ber-relay hidup, 6 stream sudah aktif → koneksi ke-7 ditutup 4409", async () => {
    await login();
    const u = await prisma.user.findFirstOrThrow();
    const t = await issueDeviceToken(u.id, "laptop");
    hubHello(t.id);
    const opens = await Promise.all(Array.from({ length: 7 }, async () => {
      const ticket = await ticketFor(`relay:${t.id}:events`);
      return new Promise<{ code: number | null }>((resolve) => {
        app.injectWS(`/api/devices/${t.id}/relay/events/ws`, { headers: { origin: "http://localhost", host: "localhost", cookie, "sec-websocket-protocol": `hanoman-ticket.${ticket}` } } as any)
          .then((ws) => {
            let closeCode: number | null = null;
            ws.on("close", (code: number) => { closeCode = code; resolve({ code: closeCode }); });
            setTimeout(() => resolve({ code: closeCode }), 200);
          });
      });
    }));
    const closed4409 = opens.filter((o) => o.code === 4409).length;
    expect(closed4409).toBe(1);
    expect(opens.filter((o) => o.code === null).length).toBe(6);
  });

  it("browser socket tutup → stream ditutup segera tanpa penonton", async () => {
    await login();
    const u = await prisma.user.findFirstOrThrow();
    const t = await issueDeviceToken(u.id, "laptop");
    const sent: unknown[] = [];
    const fakeSocket = { readyState: 1, send: (d: string) => sent.push(JSON.parse(d)), close: () => {} };
    attachRelaySocket(t.id, fakeSocket).onMessage(JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read"] }));
    const ticket = await ticketFor(`relay:${t.id}:events`);
    const ws = await app.injectWS(`/api/devices/${t.id}/relay/events/ws`, { headers: { origin: "http://localhost", host: "localhost", cookie, "sec-websocket-protocol": `hanoman-ticket.${ticket}` } } as any);
    await new Promise<void>((resolve) => { ws.on("close", () => resolve()); ws.terminate(); });
    await new Promise((r) => setTimeout(r, 100));
    expect(sent.some((f) => (f as { t?: string }).t === "close")).toBe(true);
  });

  it("device tak dikenal/offline → 4409, wsHandler tak pernah memanggil link.socket.send({t:'open'...})", async () => {
    await login();
    const u = await prisma.user.findFirstOrThrow();
    const t = await issueDeviceToken(u.id, "laptop");
    const ticket = await ticketFor(`relay:${t.id}:events`);
    const ws = await app.injectWS(`/api/devices/${t.id}/relay/events/ws`, { headers: { origin: "http://localhost", host: "localhost", cookie, "sec-websocket-protocol": `hanoman-ticket.${ticket}` } } as any);
    const closeCode = await new Promise<number>((resolve) => { ws.on("close", (code: number) => resolve(code)); });
    expect(closeCode).toBe(4409);
  });
});
