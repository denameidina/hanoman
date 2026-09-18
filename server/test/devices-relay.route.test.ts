import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
vi.mock("../src/services/relay/hub", async (orig) => {
  const mod = await orig<typeof import("../src/services/relay/hub")>();
  return { ...mod, requestRelay: vi.fn() };
});
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetEventLog } from "../src/services/logs/event-log";
import { requestRelay, RelayError } from "../src/services/relay/hub";

const app = buildApp();
const clean = async () => {
  await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); await prisma.logEntry.deleteMany();
};
let cookie = "";
beforeEach(async () => {
  await clean(); __resetEventLog(); vi.mocked(requestRelay).mockReset();
  // Catatan penyimpangan (Task 2): plan menulis `prisma.user.create({email:"op@d.co"})` LALU
  // `POST /auth/setup` dengan email yang sama — tapi `/auth/setup` (server/src/routes/auth.ts:29)
  // menolak 409 bila `prisma.user.count() > 0`, jadi user pra-dibuat itu justru mem-blokir
  // setup-nya sendiri dan tak pernah menghasilkan cookie. `/auth/setup` SENDIRI yang membuat user
  // (pola sama `agent-tokens.route.test.ts::login()`), jadi baris `prisma.user.create` dihapus.
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op@d.co", password: "password1" } });
  cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
});
afterAll(async () => { await app.close(); await clean(); });

const relay = (url: string, opts: { method?: string; payload?: unknown; ct?: string } = {}) =>
  app.inject({
    method: (opts.method ?? "POST") as any, url, headers: { cookie, ...(opts.ct ? { "content-type": opts.ct } : {}) },
    ...(opts.payload !== undefined ? { payload: opts.payload as any } : {}),
  });

describe("/api/devices/:deviceId/relay/* (SPEC-1216 · AC-B1/B9/B10)", () => {
  it("device tak dikenal → 404 unknown-device, audit relay.request warn", async () => {
    const res = await relay("/api/devices/nope/relay/terminal/sessions", { payload: { spec: "SPEC-1" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: expect.any(String), relay: "unknown-device" });
    const rows = await prisma.logEntry.findMany({ where: { kind: "relay.request" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe("warn");
  });

  it("content-type non-JSON pada POST → 415 unsupported-media", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    const res = await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { ct: "text/plain", payload: "x" });
    expect(res.statusCode).toBe(415);
    expect(res.json().relay).toBe("unsupported-media");
  });

  const table: Array<[RelayError["kind"], number, string]> = [
    ["offline", 503, "offline"], ["protocol-mismatch", 409, "protocol-mismatch"],
    ["too-large", 413, "too-large"], ["busy", 429, "busy"],
    ["protocol", 502, "protocol"], ["timeout", 504, "timeout"],
  ];
  it.each(table)("RelayError %s → %i {relay:%s}", async (kind, status, relayKind) => {
    const u = await prisma.user.create({ data: { email: `d-${kind}@d.co`, passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    vi.mocked(requestRelay).mockRejectedValueOnce(new RelayError(kind));
    const res = await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { payload: { spec: "SPEC-1" } });
    expect(res.statusCode).toBe(status);
    expect(res.json().relay).toBe(relayKind);
  });

  it("sukses → status/body/content-type klien diteruskan + header x-hanoman-device (AC-B9)", async () => {
    const u = await prisma.user.create({ data: { email: "d2@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    vi.mocked(requestRelay).mockResolvedValueOnce({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "sess-1" }) });
    const res = await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { payload: { spec: "SPEC-1" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: "sess-1" });
    expect(res.headers["x-hanoman-device"]).toBe(t.id);
    expect(vi.mocked(requestRelay)).toHaveBeenCalledWith(t.id, expect.objectContaining({
      method: "POST", path: "/api/terminal/sessions", body: { spec: "SPEC-1" },
      actor: expect.objectContaining({ userId: expect.any(String), email: "op@d.co" }),
    }), { timeoutMs: expect.any(Number) });
  });

  it("timeout mapping memakai RELAY_SPAWN_TIMEOUT_MS untuk POST …/terminal/sessions, RELAY_REQ_TIMEOUT_MS selainnya", async () => {
    const u = await prisma.user.create({ data: { email: "d3@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    vi.mocked(requestRelay).mockResolvedValue({ status: 200, contentType: "application/json", body: "{}" });
    await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { payload: { spec: "SPEC-1" } });
    await relay(`/api/devices/${t.id}/relay/terminal/sessions/x/steer`, { payload: { message: "hi" } });
    const calls = vi.mocked(requestRelay).mock.calls;
    expect(calls[0]![2]!.timeoutMs).toBe(120_000);
    expect(calls[1]![2]!.timeoutMs).toBe(30_000);
  });

  it("AC-B10 · jalur galat tak menulis Prisma selain deviceToken (baca) dan logEntry (audit)", async () => {
    const u = await prisma.user.create({ data: { email: "d4@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    vi.mocked(requestRelay).mockRejectedValueOnce(new RelayError("offline"));
    const before = await prisma.spec.count();
    await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { payload: { spec: "SPEC-1" } });
    expect(await prisma.spec.count()).toBe(before);
  });
});
