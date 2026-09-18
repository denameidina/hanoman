import { describe, it, expect, afterAll } from "vitest";
import { RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_PART_MAX_BYTES, utf8Bytes } from "@hanoman/shared";
import { buildApp } from "../src/app";
import {
  createRelayDispatcher, injectableFrom, type InjectResponse, type InjectableApp, type RemoteRequestAudit,
} from "../src/services/relay/dispatcher";
import { decodeRelayActor } from "../src/services/relay/gate";
import { isRelaySecret } from "../src/services/relay/secret";
import { makeSetting, resetDb } from "./factory";

type Frame = Record<string, any>;
const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };
const req = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "req", id: "r1", method: "GET", path: "/api/terminal/sessions", actor, ...over });
const ok = (body: string, contentType = "application/json; charset=utf-8"): InjectResponse =>
  ({ statusCode: 200, headers: { "content-type": contentType }, body });

function harness(respond: (o: Parameters<InjectableApp["inject"]>[0]) => Promise<InjectResponse>) {
  const calls: Parameters<InjectableApp["inject"]>[0][] = [];
  const sent: Frame[] = [];
  const audits: RemoteRequestAudit[] = [];
  const d = createRelayDispatcher({
    app: { inject: async (o) => { calls.push(o); return respond(o); } },
    send: (json) => sent.push(JSON.parse(json)), host: () => "127.0.0.1", audit: (e) => audits.push(e),
  });
  return { d, calls, sent, audits };
}
const waitFor = async (ok: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 5)); }
};
const assemble = (sent: Frame[], id: string) => {
  const frames = sent.filter((f) => f.t === "res" && f.id === id);
  return { frames, status: frames[0]?.status, contentType: frames[0]?.contentType, body: frames.map((f) => f.part).join(""), ended: frames.at(-1)?.end === true };
};

describe("dispatcher relay — unit (SPEC-1215 · ADR-0165 §2, spec §S4.5)", () => {
  it("req sah → inject route yang sama dengan rahasia + aktor + host; res utuh; audit beraktor", async () => {
    const h = harness(async () => ok("[]"));
    h.d.onMessage(req());
    await waitFor(() => assemble(h.sent, "r1").ended);
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    expect(call).toMatchObject({ method: "GET", url: "/api/terminal/sessions" });
    expect(call.headers.host).toBe("127.0.0.1");
    expect(isRelaySecret(call.headers[RELAY_HEADER])).toBe(true);
    expect(decodeRelayActor(call.headers[RELAY_ACTOR_HEADER])).toEqual(actor);
    expect(assemble(h.sent, "r1")).toMatchObject({ status: 200, contentType: "application/json; charset=utf-8", body: "[]" });
    expect(h.audits).toEqual([expect.objectContaining({
      kind: "remote.request", level: "info",
      data: expect.objectContaining({ actor, method: "GET", path: "/api/terminal/sessions", status: 200, ms: expect.any(Number) }),
    })]);
  });

  it("query digabung ke url; body JSON dikirim sebagai payload", async () => {
    const h = harness(async () => ok("{}"));
    h.d.onMessage(req({ id: "q", path: "/api/projects/p1/file", query: "path=README.md" }));
    h.d.onMessage(req({ id: "b", method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "lanjut" } }));
    await waitFor(() => assemble(h.sent, "q").ended && assemble(h.sent, "b").ended);
    expect(h.calls.find((c) => c.url.includes("file"))!.url).toBe("/api/projects/p1/file?path=README.md");
    const post = h.calls.find((c) => c.method === "POST")!;
    expect(post.payload).toBe(JSON.stringify({ text: "lanjut" }));
    expect(post.headers["content-type"]).toBe("application/json");
  });

  it("respons besar dipotong ≤ 32 KiB per part; status hanya di part pertama; tersambung utuh", async () => {
    const big = "é".repeat(60_000);
    const h = harness(async () => ok(big, "text/plain"));
    h.d.onMessage(req());
    await waitFor(() => assemble(h.sent, "r1").ended);
    const a = assemble(h.sent, "r1");
    expect(a.frames.length).toBeGreaterThan(3);
    for (const f of a.frames) expect(utf8Bytes(f.part)).toBeLessThanOrEqual(RELAY_PART_MAX_BYTES);
    expect(a.frames.slice(1).every((f) => f.status === undefined && f.contentType === undefined)).toBe(true);
    expect(a.body).toBe(big);
  });

  it("respons > 1 MiB → 502 relay-response-too-large", async () => {
    const h = harness(async () => ok("x".repeat(1024 * 1024 + 1)));
    h.d.onMessage(req());
    await waitFor(() => assemble(h.sent, "r1").ended);
    expect(assemble(h.sent, "r1")).toMatchObject({ status: 502, body: JSON.stringify({ error: "relay-response-too-large" }) });
  });

  it("di luar allowlist, body non-spec, atau body > 32 KiB → ditolak TANPA inject (AC-A7)", async () => {
    const h = harness(async () => ok("{}"));
    h.d.onMessage(req({ id: "patch", method: "PATCH", path: "/api/specs/SPEC-1", body: { title: "x" } }));
    h.d.onMessage(req({ id: "shell", method: "POST", path: "/api/terminal/sessions", body: { project: "p1", shell: true } }));
    h.d.onMessage(req({ id: "big", method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "x".repeat(40_000) } }));
    await waitFor(() => ["patch", "shell", "big"].every((id) => assemble(h.sent, id).ended));
    expect(h.calls).toHaveLength(0);
    expect(assemble(h.sent, "patch").status).toBe(403);
    expect(assemble(h.sent, "shell").status).toBe(403);
    expect(assemble(h.sent, "big").status).toBe(413);
    expect(h.audits.map((a) => a.level)).toEqual(["warn", "warn", "warn"]);
  });

  it("inflight > 4 → 429; sisanya selesai sesudah dilepas", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness(async () => { await gate; return ok("[]"); });
    for (const id of ["a", "b", "c", "d", "e"]) h.d.onMessage(req({ id }));
    await waitFor(() => assemble(h.sent, "e").ended);
    expect(assemble(h.sent, "e").status).toBe(429);
    expect(h.d.inflight()).toBe(4);
    release();
    await waitFor(() => ["a", "b", "c", "d"].every((id) => assemble(h.sent, id).ended));
    expect(h.d.inflight()).toBe(0);
  });

  it("cancel → tak ada res untuk id itu, audit tetap tercatat", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness(async () => { await gate; return ok("[]"); });
    h.d.onMessage(req({ id: "c1" }));
    await waitFor(() => h.calls.length === 1);
    h.d.onMessage(JSON.stringify({ t: "cancel", id: "c1" }));
    release();
    await waitFor(() => h.audits.length === 1);
    expect(assemble(h.sent, "c1").frames).toHaveLength(0);
  });

  it("frame rusak dibuang; inject melempar → 502; open (stream, SPEC-1218) → close 4502", async () => {
    const h = harness(async () => { throw new Error("boom"); });
    h.d.onMessage("{bukan json");
    h.d.onMessage(JSON.stringify({ t: "req" }));
    h.d.onMessage(JSON.stringify({ t: "open", sid: "s1", path: "/api/events/ws", mode: "read", actor }));
    h.d.onMessage(req({ id: "x" }));
    await waitFor(() => assemble(h.sent, "x").ended);
    expect(assemble(h.sent, "x").status).toBe(502);
    expect(h.sent.filter((f) => f.t === "close")).toEqual([{ t: "close", sid: "s1", code: 4502, reason: expect.any(String) }]);
  });
});

describe("dispatcher relay + gate app nyata", () => {
  const app = buildApp();
  afterAll(async () => { await app.close(); await resetDb(); });

  it("grant menyala → 200 dari route yang sama; grant mati → 401 dari gate", async () => {
    const run = async (id: string) => {
      const sent: Frame[] = [];
      const d = createRelayDispatcher({ app: injectableFrom(app), send: (j) => sent.push(JSON.parse(j)), host: () => "127.0.0.1", audit: () => {} });
      d.onMessage(req({ id }));
      await waitFor(() => assemble(sent, id).ended);
      return assemble(sent, id);
    };
    await resetDb();
    await makeSetting({ remoteControl: { enabled: true, capabilities: ["sessions:read"] } });
    const on = await run("on");
    expect(on.status).toBe(200);
    expect(Array.isArray(JSON.parse(on.body))).toBe(true);
    await makeSetting({ remoteControl: { enabled: false, capabilities: ["sessions:read"] } });
    expect((await run("off")).status).toBe(401);
  });

  it("injectableFrom mengekspos injectWS di atas app.injectWS asli (SPEC-1218 · prasyarat)", async () => {
    const calls: any[] = [];
    const fakeApp = {
      inject: async () => ({ statusCode: 200, headers: {}, body: "{}" }),
      injectWS: async (path: string, o: unknown, hooks: { onOpen: (ws: unknown) => void }) => {
        calls.push([path, o]); hooks.onOpen({ send: () => {}, on: () => {}, close: () => {} });
      },
    };
    const wrapped = injectableFrom(fakeApp as any);
    await wrapped.injectWS!("/api/events/ws", { headers: { host: "x" } }, { onOpen: () => {} });
    expect(calls[0][0]).toBe("/api/events/ws");
  });
});
