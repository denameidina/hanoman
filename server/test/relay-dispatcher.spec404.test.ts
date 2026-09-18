import { describe, it, expect, vi } from "vitest";
import { createRelayDispatcher, type InjectableApp } from "../src/services/relay/dispatcher";

function fakeApp(responses: Array<{ statusCode: number; body: string }>): InjectableApp & { calls: number } {
  let i = 0;
  return {
    calls: 0,
    async inject() {
      const r = responses[Math.min(i, responses.length - 1)]!;
      i++; (this as any).calls++;
      return { statusCode: r.statusCode, headers: { "content-type": "application/json" }, body: r.body };
    },
  } as any;
}

describe("relay dispatcher retry spec-404 (SPEC-1216 · AC-B11)", () => {
  it("404 spec not found → satu syncOnce lalu satu ulang; respons kedua diteruskan", async () => {
    const app = fakeApp([
      { statusCode: 404, body: JSON.stringify({ error: "spec not found" }) },
      { statusCode: 201, body: JSON.stringify({ id: "sess-1" }) },
    ]);
    const syncOnce = vi.fn().mockResolvedValue(null);
    const sent: string[] = [];
    const d = createRelayDispatcher({ app, send: (j) => sent.push(j), syncOnce });
    d.onMessage(JSON.stringify({ t: "req", id: "r1", method: "POST", path: "/api/terminal/sessions", body: { spec: "SPEC-1" }, actor: { hubOrigin: "h", userId: "u", email: "e@e.co" } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect(app.calls).toBe(2);
    const last = JSON.parse(sent[sent.length - 1]!);
    expect(last.status).toBe(201);
  });

  it("404 non-spec-not-found → tak retry, tak panggil syncOnce", async () => {
    const app = fakeApp([{ statusCode: 404, body: JSON.stringify({ error: "not found" }) }]);
    const syncOnce = vi.fn().mockResolvedValue(null);
    const sent: string[] = [];
    const d = createRelayDispatcher({ app, send: (j) => sent.push(j), syncOnce });
    d.onMessage(JSON.stringify({ t: "req", id: "r1", method: "GET", path: "/api/terminal/sessions", actor: { hubOrigin: "h", userId: "u", email: "e@e.co" } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(syncOnce).not.toHaveBeenCalled();
    expect(app.calls).toBe(1);
  });

  it("syncOnce melempar → galat ditelan, ulang tetap jalan sekali", async () => {
    const app = fakeApp([
      { statusCode: 404, body: JSON.stringify({ error: "spec not found" }) },
      { statusCode: 201, body: JSON.stringify({ id: "sess-1" }) },
    ]);
    const syncOnce = vi.fn().mockRejectedValue(new Error("boom"));
    const sent: string[] = [];
    const d = createRelayDispatcher({ app, send: (j) => sent.push(j), syncOnce });
    d.onMessage(JSON.stringify({ t: "req", id: "r1", method: "POST", path: "/api/terminal/sessions", body: { spec: "SPEC-1" }, actor: { hubOrigin: "h", userId: "u", email: "e@e.co" } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(app.calls).toBe(2);
  });
});
