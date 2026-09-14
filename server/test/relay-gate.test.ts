import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import { Socket, type AddressInfo } from "node:net";
import { RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_MODE_HEADER, type RemoteCapability } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { admitRemoteRequest, encodeRelayActor } from "../src/services/relay/gate";
import { relaySecret } from "../src/services/relay/secret";
import { makeProject, makeSetting, makeSpec, resetDb } from "./factory";

const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };
const relayHeaders = (over: Record<string, string> = {}) => ({
  [RELAY_HEADER]: relaySecret(), [RELAY_ACTOR_HEADER]: encodeRelayActor(actor), ...over,
});
type GateReq = Parameters<typeof admitRemoteRequest>[0];
const fakeReq = (o: { method?: string; url?: string; headers?: Record<string, string>; network?: boolean } = {}) => ({
  method: o.method ?? "GET", url: o.url ?? "/api/terminal/sessions",
  headers: { ...relayHeaders(), ...o.headers },
  raw: { socket: o.network ? new Socket() : undefined },
}) as unknown as GateReq;
const grant = (capabilities: RemoteCapability[], enabled = true) => async () => ({ enabled, capabilities });

describe("admitRemoteRequest — unit (SPEC-1215 · ADR-0165 §3–5)", () => {
  it("socket jaringan dengan rahasia BENAR tetap 401", async () => {
    expect(await admitRemoteRequest(fakeReq({ network: true }), grant(["sessions:read"]))).toMatchObject({ ok: false, status: 401 });
  });
  it("rahasia salah, aktor rusak, atau grant mati → 401", async () => {
    expect(await admitRemoteRequest(fakeReq({ headers: { [RELAY_HEADER]: "salah" } }), grant(["sessions:read"]))).toMatchObject({ status: 401 });
    expect(await admitRemoteRequest(fakeReq({ headers: { [RELAY_ACTOR_HEADER]: "bukan-base64-json" } }), grant(["sessions:read"]))).toMatchObject({ status: 401 });
    expect(await admitRemoteRequest(fakeReq(), grant(["sessions:read"], false))).toMatchObject({ status: 401 });
  });
  it("route di luar allowlist → 403 walau capability-nya ada", async () => {
    const v = await admitRemoteRequest(fakeReq({ method: "PATCH", url: "/api/specs/SPEC-1" }), grant(["sessions:read", "backlog:write"]));
    expect(v).toMatchObject({ ok: false, status: 403, body: { error: "relay route not allowed" } });
  });
  it("capability kurang → 403 need", async () => {
    const v = await admitRemoteRequest(fakeReq({ method: "POST", url: "/api/terminal/sessions/spec-1/steer" }), grant(["sessions:read"]));
    expect(v).toMatchObject({ ok: false, status: 403, body: { need: "sessions:write" } });
  });
  it("WS terminal mode read cukup sessions:read; mode write butuh sessions:write", async () => {
    const url = "/api/terminal/sessions/spec-1/ws";
    expect(await admitRemoteRequest(fakeReq({ url, headers: { [RELAY_MODE_HEADER]: "read" } }), grant(["sessions:read"]))).toMatchObject({ ok: true });
    expect(await admitRemoteRequest(fakeReq({ url }), grant(["sessions:read"]))).toMatchObject({ ok: false, status: 403, body: { need: "sessions:write" } });
  });
  it("lolos: aktor klaim hub + capability grant", async () => {
    const v = await admitRemoteRequest(fakeReq(), grant(["sessions:read", "ide:read"]));
    expect(v).toEqual({ ok: true, remote: { actor, capabilities: ["sessions:read", "ide:read"], mode: "write" } });
  });
});

describe("gate remote di app — jaringan nyata vs in-process", () => {
  const app = buildApp();
  let host = "";
  beforeAll(async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await app.close(); await resetDb(); });
  beforeEach(async () => {
    await resetDb();
    await makeSetting({ remoteControl: { enabled: true, capabilities: ["sessions:read", "sessions:spawn", "backlog:write"] } });
  });

  it("HTTP jaringan berheader relay + rahasia benar → 401 (AC-A6)", async () => {
    const res = await fetch(`http://${host}/api/terminal/sessions`, { headers: relayHeaders() });
    expect(res.status).toBe(401);
  });

  it("upgrade WS jaringan berheader relay + rahasia benar → 401 (AC-A6)", async () => {
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${host}/api/events/ws`, { headers: relayHeaders() });
      ws.once("unexpected-response", (_req, res) => { resolve(res.statusCode ?? 0); ws.terminate(); });
      ws.once("open", () => { resolve(101); ws.close(); });
      ws.once("error", () => {});
    });
    expect(status).toBe(401);
  });

  it("in-process + grant + allowlist + capability → handler route berjalan", async () => {
    const res = await app.inject({ method: "GET", url: "/api/terminal/sessions", headers: { host: "127.0.0.1", ...relayHeaders() } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("route di luar allowlist → 403 dan handler TIDAK berjalan (AC-A7)", async () => {
    await makeProject();
    await makeSpec({ title: "asli" });
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1", payload: { title: "diubah hub" },
      headers: { host: "127.0.0.1", ...relayHeaders() },
    });
    expect(res.statusCode).toBe(403);
    expect((await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-1" } })).title).toBe("asli");
  });

  it("POST /terminal/sessions varian non-spec → 403 di preHandler (keputusan Plan P3)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/terminal/sessions", payload: { project: "p1", shell: true },
      headers: { host: "127.0.0.1", ...relayHeaders() },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "relay route not allowed" });
  });

  it("app ber-requireAuth:false tetap menegakkan gate remote (keputusan Plan P4)", async () => {
    const open = buildApp({ requireAuth: false });
    const res = await open.inject({ method: "GET", url: "/api/terminal/sessions", headers: { host: "127.0.0.1", ...relayHeaders({ [RELAY_HEADER]: "salah" }) } });
    expect(res.statusCode).toBe(401);
    await open.close();
  });
});
