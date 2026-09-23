import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { drainSessionEventSpool, startSessionEventRelay, sessionEventRelayStatus } from "../src/services/session-event-relay";
import { sessionEventToken } from "../src/services/session-event-token";
import { classifyIngress, loadIngressPolicy } from "../src/services/ingress-policy";

describe("sandbox session event relay", () => {
  it("can register its lifecycle before Fastify becomes ready", async () => {
    const app = Fastify();
    const root = mkdtempSync(join(tmpdir(), "hanoman-event-relay-start-"));
    startSessionEventRelay(app, { root, intervalMs: 60_000 });
    await app.ready();
    await app.close();
  });

  it("replays an atomic spool file through the signed route and removes it", async () => {
    const root = mkdtempSync(join(tmpdir(), "hanoman-event-relay-"));
    const dir = join(root, "sess-1");
    mkdirSync(dir);
    const path = join(dir, "event.json");
    const payload = { hook_event_name: "SubagentStart", agent_id: "sub-1", agent_type: "scout" };
    writeFileSync(path, JSON.stringify(payload));
    const calls: Array<Record<string, unknown>> = [];

    const count = await drainSessionEventSpool({
      inject: async (request) => { calls.push(request); return { statusCode: 202 }; },
    }, root);

    expect(count).toBe(1);
    expect(calls).toEqual([expect.objectContaining({
      method: "POST", url: "/api/session-events", payload,
      headers: {
        authorization: `Bearer ${sessionEventToken("sess-1")}`,
        "x-hanoman-session": "sess-1",
      },
    })]);
    expect(existsSync(path)).toBe(false);
  });

  it("drops malformed and oversized files without injecting them", async () => {
    const root = mkdtempSync(join(tmpdir(), "hanoman-event-relay-bad-"));
    const dir = join(root, "sess-2");
    mkdirSync(dir);
    const malformed = join(dir, "bad.json");
    const oversized = join(dir, "large.json");
    writeFileSync(malformed, "{");
    writeFileSync(oversized, "x".repeat(1_000_001));
    let calls = 0;

    await drainSessionEventSpool({
      inject: async () => { calls++; return { statusCode: 202 }; },
    }, root);

    expect(calls).toBe(0);
    expect(existsSync(malformed)).toBe(false);
    expect(existsSync(oversized)).toBe(false);
  });

  it("keeps valid events for retry after rate limits or server errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "hanoman-event-relay-retry-"));
    const dir = join(root, "sess-3");
    mkdirSync(dir);
    const path = join(dir, "event.json");
    writeFileSync(path, JSON.stringify({ hook_event_name: "SubagentStart" }));
    let statusCode = 429;
    const app = { inject: async () => ({ statusCode }) };

    expect(await drainSessionEventSpool(app, root)).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(sessionEventRelayStatus(root)).toMatchObject({ state: "degraded", retryPending: 1, retryAttempts: 1 });
    statusCode = 503;
    expect(await drainSessionEventSpool(app, root)).toBe(0);
    expect(existsSync(path)).toBe(true);
    statusCode = 202;
    expect(await drainSessionEventSpool(app, root)).toBe(1);
    expect(existsSync(path)).toBe(false);
    expect(sessionEventRelayStatus(root)).toMatchObject({ state: "ready", retryPending: 0,
      retryAttempts: 2, lastDeliveryAt: expect.any(String), lastIssueAt: expect.any(String) });
    expect(sessionEventRelayStatus(root + "-unknown")).toMatchObject({ state: "unobserved", checkedAt: null });
  });

  // `HANOMAN_CONTROL_ORIGINS` menyalakan gerbang ingress: Host di luar daftar dijawab 404. Relay
  // dulu inject tanpa Host (default `localhost:80`), jadi SETIAP event spool dibuang diam-diam —
  // AgentInvocation kosong dan pertanyaan sesi tak pernah sampai ke lead.
  const ingressGatedApp = (env: Record<string, string>) => {
    const app = Fastify();
    const policy = loadIngressPolicy(env);
    app.addHook("onRequest", async (req, reply) => {
      const role = classifyIngress({ host: req.headers.host ?? "", method: req.method, url: req.url }, policy);
      if (role === "denied") return reply.code(404).send({ error: "not found" });
    });
    app.post("/api/session-events", async (_req, reply) => reply.code(202).send({ accepted: true }));
    return app;
  };
  const CONTROL_ENV = { HANOMAN_CONTROL_ORIGINS: "http://127.0.0.1:8787,https://hm.example.com" };

  it("delivers through the ingress gate when control origins are configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "hanoman-event-relay-ingress-"));
    const dir = join(root, "sess-4");
    mkdirSync(dir);
    const path = join(dir, "event.json");
    writeFileSync(path, JSON.stringify({ hook_event_name: "SubagentStart", agent_id: "a", agent_type: "scout" }));
    const app = ingressGatedApp(CONTROL_ENV);
    startSessionEventRelay(app, { root, intervalMs: 20, env: CONTROL_ENV });

    await vi.waitFor(() => expect(existsSync(path)).toBe(false));
    await app.close();

    expect(sessionEventRelayStatus(root)).toMatchObject({ droppedEvents: 0, lastDeliveryAt: expect.any(String) });
  });

  it("logs events the route rejects instead of dropping them silently", async () => {
    const root = mkdtempSync(join(tmpdir(), "hanoman-event-relay-rejected-"));
    const dir = join(root, "sess-5");
    mkdirSync(dir);
    writeFileSync(join(dir, "event.json"), JSON.stringify({ hook_event_name: "SubagentStart" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await drainSessionEventSpool({ inject: async () => ({ statusCode: 404 }) }, root);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("404"));
    warn.mockRestore();
  });
});
