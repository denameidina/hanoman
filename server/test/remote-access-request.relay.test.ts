import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import { REQUEST_TIER_GRANTS } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetRelayClient, installRelayClient, startRelayClient } from "../src/services/relay/client";
import { injectableFrom } from "../src/services/relay/dispatcher";
import { __resetRelayHub, relayControlFor } from "../src/services/relay/hub";
import { __resetAccessRequests } from "../src/services/remote-access-request";
import { getSetting } from "../src/services/settings";

// ADR-0217 · alur PENUH lewat socket relay nyata (satu proses): hub meminta tingkat → permintaan mengantre di
// perangkat → persetujuan lokal menerapkan grant lewat jalur PUT → relay dibuka ulang dengan capability baru.
// Pola yang sama dengan remote-control.relay.test.ts: `client` berperan sebagai hub (cookie) sekaligus perangkat.

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

async function setupDevice() {
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
beforeEach(async () => {
  __resetRelayClient(); __resetRelayHub(); __resetAccessRequests(); await clean();
  installRelayClient(injectableFrom(client));
});

describe("permintaan tingkat lewat relay nyata (ADR-0217 AC: alur penuh)", () => {
  it("hub meminta Kerja → pending di perangkat; grant tetap; persetujuan lokal menerapkannya dan relay membawa capability baru", async () => {
    const { cookie, device } = await setupDevice();
    startRelayClient(hubBase, device.token);
    expect((await putGrant(cookie, true, [])).statusCode).toBe(200);
    await waitFor(() => relayControlFor(device.id)?.state === "available", 5_000);

    // 1) hub meminta lewat relay — permintaan mengantre di perangkat, tak mengubah grant
    const sent = await client.inject({ method: "POST", url: `/api/devices/${device.id}/access-requests`, headers: { cookie }, payload: { tier: "kerja" } });
    expect(sent.statusCode, sent.body).toBe(201);
    const requestId = sent.json().request.id as string;
    expect(sent.json().request.status).toBe("pending");
    expect((await getSetting()).remoteControl.capabilities).toEqual([]);

    // 2) hub membaca status lewat relay yang sama
    const status = await client.inject({ method: "GET", url: `/api/devices/${device.id}/access-requests`, headers: { cookie } });
    expect(status.statusCode).toBe(200);
    expect(status.json().items).toEqual([expect.objectContaining({ id: requestId, status: "pending", tier: "kerja" })]);

    // 3) relay TAK bisa menyetujui: rute persetujuan di luar allowlist → 403 dari perangkat
    const viaRelay = await client.inject({
      method: "POST", url: `/api/devices/${device.id}/relay/api/remote-control/access-requests/${requestId}/approve`, headers: { cookie },
    });
    expect(viaRelay.statusCode).toBe(403);
    expect(viaRelay.json()).toEqual({ error: "relay route not allowed" });
    expect((await getSetting()).remoteControl.capabilities).toEqual([]);

    // 4) operator lokal menyetujui → grant = Kerja lewat jalur PUT; relay dibuka ulang dengan capability baru
    // Persetujuan menyebut tingkat & hub yang dilihat di kartu (ADR-0217 §2), persis seperti layar.
    const seen = sent.json().request as { tier: string; from: string };
    const approved = await client.inject({
      method: "POST", url: `/api/remote-control/access-requests/${requestId}/approve`, headers: { cookie },
      payload: { tier: seen.tier, from: seen.from },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().request.status).toBe("approved");
    expect((await getSetting()).remoteControl).toEqual({ enabled: true, capabilities: [...REQUEST_TIER_GRANTS.kerja] });
    await waitFor(() => relayControlFor(device.id)?.capabilities.includes("backlog:write") === true, 5_000);
  });

  it("perangkat dengan kendali mati tak pernah menerima permintaan: hub mendapat 503 offline, bukan kesalahan palsu", async () => {
    const { cookie, device } = await setupDevice();
    const res = await client.inject({ method: "POST", url: `/api/devices/${device.id}/access-requests`, headers: { cookie }, payload: { tier: "lihat" } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ relay: "offline" });
  });
});
