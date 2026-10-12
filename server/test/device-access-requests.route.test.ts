import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
vi.mock("../src/services/relay/hub", async (orig) => {
  const mod = await orig<typeof import("../src/services/relay/hub")>();
  return { ...mod, requestRelay: vi.fn() };
});
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetEventLog } from "../src/services/logs/event-log";
import { requestRelay, RelayError } from "../src/services/relay/hub";
import { makeSetting } from "./factory";

// ADR-0217 · sisi HUB: POST/GET /devices/:id/access-requests meneruskan lewat relay. Relay di-mock di sini
// (perilaku socket dibuktikan di remote-access-request.relay.test.ts); yang diuji: principal, pemetaan
// galat, dan deteksi perangkat versi lama.

const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.deviceToken.deleteMany(); await prisma.logEntry.deleteMany();
  await prisma.setting.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
let cookie = "";
let userId = "";
let deviceId = "";
beforeEach(async () => {
  await clean(); __resetEventLog(); vi.mocked(requestRelay).mockReset();
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op@d.co", password: "password1" } });
  cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
  const u = await prisma.user.findFirstOrThrow();
  userId = u.id;
  deviceId = (await issueDeviceToken(u.id, "laptop")).id;
});
afterAll(async () => { await app.close(); await clean(); });

const post = (id: string, payload: unknown = { tier: "kerja" }) =>
  app.inject({ method: "POST", url: `/api/devices/${id}/access-requests`, headers: { cookie }, payload: payload as any });
const get = (id: string) => app.inject({ method: "GET", url: `/api/devices/${id}/access-requests`, headers: { cookie } });

describe("hub: POST/GET /devices/:id/access-requests (ADR-0217)", () => {
  it("tanpa autentikasi → 401", async () => {
    const res = await app.inject({ method: "POST", url: `/api/devices/${deviceId}/access-requests`, payload: { tier: "lihat" } });
    expect(res.statusCode).toBe(401);
    expect(requestRelay).not.toHaveBeenCalled();
  });

  it("perangkat tak dikenal → 404 unknown-device, tanpa relay", async () => {
    const res = await post("nope");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ relay: "unknown-device" });
    expect(requestRelay).not.toHaveBeenCalled();
  });

  it("tingkat tak dikenal → 400 sebelum relay", async () => {
    expect((await post(deviceId, { tier: "admin" })).statusCode).toBe(400);
    expect(requestRelay).not.toHaveBeenCalled();
  });

  it("sukses: meneruskan POST ke /api/remote-control/access-requests dengan aktor cookie, status klien diteruskan", async () => {
    const body = JSON.stringify({ request: { id: "ar1", status: "pending", tier: "kerja" } });
    vi.mocked(requestRelay).mockResolvedValue({ status: 201, contentType: "application/json", body });
    const res = await post(deviceId);
    expect(res.statusCode).toBe(201);
    expect(res.json().request).toMatchObject({ id: "ar1", status: "pending" });
    expect(res.headers["x-hanoman-device"]).toBe(deviceId);
    const [dev, req] = vi.mocked(requestRelay).mock.calls[0]!;
    expect(dev).toBe(deviceId);
    expect(req).toMatchObject({ method: "POST", path: "/api/remote-control/access-requests", body: { tier: "kerja" } });
    expect(req.actor).toMatchObject({ userId, email: "op@d.co" });
    expect(req.query).toBeUndefined();
  });

  it("perangkat versi lama (allowlist belum memuat rute) → 409 'belum mendukung', bukan 403 yang membingungkan", async () => {
    vi.mocked(requestRelay).mockResolvedValue({ status: 403, contentType: "application/json", body: '{"error":"relay route not allowed"}' });
    const res = await post(deviceId);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ relay: "unsupported-message" });
    expect(res.json().error).toMatch(/belum mendukung/);
    const rows = await prisma.logEntry.findMany({ where: { kind: "relay.request" } });
    expect(rows.at(-1)?.level).toBe("warn");
  });

  it("403 dari tujuan yang BUKAN allowlist (mis. grant) tetap diteruskan apa adanya", async () => {
    vi.mocked(requestRelay).mockResolvedValue({ status: 403, contentType: "application/json", body: '{"error":"capability required","need":"sessions:write"}' });
    const res = await post(deviceId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ need: "sessions:write" });
  });

  it("401 dari perangkat (relay menolak sesi) dipetakan ke 502, BUKAN diteruskan: klien tak melempar operator ke Login", async () => {
    vi.mocked(requestRelay).mockResolvedValue({ status: 401, contentType: "application/json", body: '{"error":"unauthorized"}' });
    const res = await post(deviceId);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ relay: "device-unauthorized" });
    expect(res.json().error).toMatch(/kendali jarak jauh/);
    const rows = await prisma.logEntry.findMany({ where: { kind: "relay.request" } });
    expect(rows.at(-1)?.level).toBe("error");
  });

  it("galat relay dipetakan: offline → 503 dengan presence, timeout → 504", async () => {
    vi.mocked(requestRelay).mockRejectedValueOnce(new RelayError("offline"));
    const off = await post(deviceId);
    expect(off.statusCode).toBe(503);
    expect(off.json()).toMatchObject({ relay: "offline", presence: "offline" });
    vi.mocked(requestRelay).mockRejectedValueOnce(new RelayError("timeout"));
    expect((await post(deviceId)).statusCode).toBe(504);
  });

  it("GET meneruskan ke rute yang sama tanpa body", async () => {
    vi.mocked(requestRelay).mockResolvedValue({ status: 200, contentType: "application/json", body: '{"items":[]}' });
    const res = await get(deviceId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
    const [, req] = vi.mocked(requestRelay).mock.calls[0]!;
    expect(req).toMatchObject({ method: "GET", path: "/api/remote-control/access-requests" });
    expect(req.body).toBeUndefined();
  });

  it("agen: tanpa relay:exec → 403; dengan relay:exec → diteruskan", async () => {
    await makeSetting({ agentAccessEnabled: true });
    vi.mocked(requestRelay).mockResolvedValue({ status: 201, contentType: "application/json", body: "{}" });
    const none = (await issueAgentToken({ name: "tanpa", capabilities: ["sessions:read"] })).token;
    const denied = await app.inject({
      method: "POST", url: `/api/devices/${deviceId}/access-requests`,
      headers: { authorization: `Bearer ${none}` }, payload: { tier: "lihat" },
    });
    expect(denied.statusCode).toBe(403);
    expect(requestRelay).not.toHaveBeenCalled();
    const ok = (await issueAgentToken({ name: "relay", capabilities: ["relay:exec"] })).token;
    const allowed = await app.inject({
      method: "POST", url: `/api/devices/${deviceId}/access-requests`,
      headers: { authorization: `Bearer ${ok}` }, payload: { tier: "lihat" },
    });
    expect(allowed.statusCode).toBe(201);
    const [, req] = vi.mocked(requestRelay).mock.calls[0]!;
    expect(req.actor.userId).toMatch(/^agent:/);
  });

  it("pemetaan capability: kedua rute hub = relay:exec (danger, sama dengan relay generik)", () => {
    expect(capabilityForRoute("POST", "/api/devices/d1/access-requests")).toBe("relay:exec");
    expect(capabilityForRoute("GET", "/api/devices/d1/access-requests")).toBe("relay:exec");
  });
});
