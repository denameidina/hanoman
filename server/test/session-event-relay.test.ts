import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { drainSessionEventSpool, startSessionEventRelay } from "../src/services/session-event-relay";
import { sessionEventToken } from "../src/services/session-event-token";

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
    statusCode = 503;
    expect(await drainSessionEventSpool(app, root)).toBe(0);
    expect(existsSync(path)).toBe(true);
    statusCode = 202;
    expect(await drainSessionEventSpool(app, root)).toBe(1);
    expect(existsSync(path)).toBe(false);
  });
});
