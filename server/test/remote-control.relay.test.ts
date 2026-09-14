import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetRelayClient, installRelayClient, relayClientStatus, startRelayClient } from "../src/services/relay/client";
import { injectableFrom } from "../src/services/relay/dispatcher";
import { __resetRelayHub, relayControlFor } from "../src/services/relay/hub";

const hub = buildApp({ requireAuth: false });
const client = buildApp();
let hubBase = "";
const clean = async () => {
  await prisma.logEntry.deleteMany(); await prisma.deviceToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await sleep(20); }
};
const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0]!;
async function loginAndDevice() {
  const cookie = cookieOf(await client.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } }));
  const user = await prisma.user.findFirstOrThrow();
  return { cookie, device: await issueDeviceToken(user.id, "klien") };
}
const putGrant = (cookie: string, enabled: boolean, capabilities: string[]) =>
  client.inject({ method: "PUT", url: "/api/remote-control", headers: { cookie }, payload: { control: { enabled, capabilities } } });

beforeAll(async () => {
  await hub.listen({ port: 0, host: "127.0.0.1" });
  hubBase = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
});
afterAll(async () => { __resetRelayClient(); await hub.close(); await client.close(); await clean(); });
beforeEach(async () => { __resetRelayClient(); __resetRelayHub(); await clean(); installRelayClient(injectableFrom(client)); });

describe("grant ↔ socket relay (SPEC-1215 AC-A2, AC-A5)", () => {
  it("menyalakan grant membuka relay + hello ≤ 5 dtk; mematikannya menutup relay SEBELUM PUT membalas", async () => {
    const { cookie, device } = await loginAndDevice();
    startRelayClient(hubBase, device.token);
    await sleep(300);
    expect(relayControlFor(device.id)).toBeNull();
    expect((await putGrant(cookie, true, ["sessions:read"])).statusCode).toBe(200);
    const t0 = Date.now();
    await waitFor(() => relayControlFor(device.id)?.state === "available", 5_000);
    expect(Date.now() - t0).toBeLessThan(5_000);

    const off = await putGrant(cookie, false, ["sessions:read"]);
    expect(off.statusCode).toBe(200);
    expect(relayClientStatus().state).toBe("off");
    expect(off.json().relay.state).toBe("off");
    await waitFor(() => relayControlFor(device.id) === null);
  });

  it("mengubah capability menutup relay lalu hello baru membawa capability baru", async () => {
    const { cookie, device } = await loginAndDevice();
    startRelayClient(hubBase, device.token);
    await putGrant(cookie, true, ["sessions:read"]);
    await waitFor(() => relayControlFor(device.id)?.state === "available");
    await putGrant(cookie, true, ["sessions:read", "sessions:write"]);
    await waitFor(() => relayControlFor(device.id)?.capabilities.includes("sessions:write") === true);
  });
});
