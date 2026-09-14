import { describe, it, expect, beforeEach } from "vitest";
import { RELAY_MAX_INFLIGHT } from "@hanoman/shared";
import { __resetDeviceSockets, deviceSocketCount } from "../src/services/device-sockets";
import { __resetRelayHub, attachRelaySocket, relayControlFor, requestRelay } from "../src/services/relay/hub";

type Frame = Record<string, any>;
const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };
const fake = () => {
  const sent: Frame[] = []; const closes: [number | undefined, string | undefined][] = [];
  return { sent, closes, socket: { readyState: 1, send: (d: string) => { sent.push(JSON.parse(d)); }, close: (c?: number, r?: string) => { closes.push([c, r]); } } };
};
const hello = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read"], ...over });
const ready = () => { const f = fake(); const link = attachRelaySocket("dev1", f.socket); link.onMessage(hello()); return { ...f, link }; };
const lastReq = (sent: Frame[]) => sent.filter((x) => x.t === "req").at(-1)!;

beforeEach(() => { __resetRelayHub(); __resetDeviceSockets(); });

describe("hub relay — registry & hello (SPEC-1215 · ADR-0165 §1, AC-A9)", () => {
  it("hello protokol cocok → welcome + control available + terdaftar di registry socket", () => {
    const { sent } = ready();
    expect(sent[0]).toMatchObject({ t: "welcome", v: 1, protocol: 1 });
    expect(relayControlFor("dev1")).toMatchObject({ state: "available", protocol: 1, version: "0.5.0", capabilities: ["sessions:read"] });
    expect(deviceSocketCount("dev1", "relay")).toBe(1);
  });

  it("hello protokol beda → close 4001 dan control protocol-mismatch", async () => {
    const f = fake();
    const link = attachRelaySocket("dev1", f.socket);
    link.onMessage(hello({ protocol: 2 }));
    expect(f.closes).toEqual([[4001, "protocol mismatch"]]);
    link.onClose();
    expect(relayControlFor("dev1")).toMatchObject({ state: "protocol-mismatch", protocol: 2 });
    await expect(requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor })).rejects.toMatchObject({ kind: "protocol-mismatch" });
  });

  it("socket baru menggantikan yang lama (4000), permintaan lama gagal offline", async () => {
    const first = ready();
    const pending = requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor });
    const second = fake();
    attachRelaySocket("dev1", second.socket);
    expect(first.closes).toEqual([[4000, "replaced"]]);
    await expect(pending).rejects.toMatchObject({ kind: "offline" });
    first.link.onClose(); // close event socket lama datang belakangan — tak boleh menghapus yang baru
    expect(deviceSocketCount("dev1", "relay")).toBe(1);
  });

  it("onClose → control null, permintaan tertunda gagal offline", async () => {
    const { link } = ready();
    const pending = requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor });
    link.onClose();
    await expect(pending).rejects.toMatchObject({ kind: "offline" });
    expect(relayControlFor("dev1")).toBeNull();
    expect(deviceSocketCount("dev1")).toBe(0);
  });
});

describe("requestRelay", () => {
  it("tanpa socket atau sebelum hello → offline", async () => {
    await expect(requestRelay("nope", { method: "GET", path: "/api/terminal/sessions", actor })).rejects.toMatchObject({ kind: "offline" });
    attachRelaySocket("dev1", fake().socket);
    await expect(requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor })).rejects.toMatchObject({ kind: "offline" });
  });

  it("merakit res bertahap; status & contentType dari part pertama", async () => {
    const { sent, link } = ready();
    const p = requestRelay("dev1", { method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "x" }, actor });
    const r = lastReq(sent);
    expect(r).toMatchObject({ method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "x" }, actor });
    link.onMessage(JSON.stringify({ t: "res", id: r.id, status: 202, contentType: "application/json", part: '{"ok"', end: false }));
    link.onMessage(JSON.stringify({ t: "res", id: r.id, part: ":true}", end: true }));
    await expect(p).resolves.toEqual({ status: 202, contentType: "application/json", body: '{"ok":true}' });
  });

  it("part pertama tanpa status → protocol", async () => {
    const { sent, link } = ready();
    const p = requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor });
    link.onMessage(JSON.stringify({ t: "res", id: lastReq(sent).id, part: "x", end: true }));
    await expect(p).rejects.toMatchObject({ kind: "protocol" });
  });

  it("rakitan > 1 MiB → too-large + cancel", async () => {
    const { sent, link } = ready();
    const p = requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor });
    const id = lastReq(sent).id;
    link.onMessage(JSON.stringify({ t: "res", id, status: 200, part: "x".repeat(32 * 1024), end: false }));
    for (let i = 0; i < 32; i++) link.onMessage(JSON.stringify({ t: "res", id, part: "x".repeat(32 * 1024), end: false }));
    await expect(p).rejects.toMatchObject({ kind: "too-large" });
    expect(sent.some((x) => x.t === "cancel" && x.id === id)).toBe(true);
  });

  it("timeout → timeout + cancel", async () => {
    const { sent } = ready();
    await expect(requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor }, { timeoutMs: 30 })).rejects.toMatchObject({ kind: "timeout" });
    expect(sent.some((x) => x.t === "cancel")).toBe(true);
  });

  it(`lebih dari ${RELAY_MAX_INFLIGHT} inflight → busy; body > 32 KiB → too-large tanpa kirim`, async () => {
    const { sent } = ready();
    for (let i = 0; i < RELAY_MAX_INFLIGHT; i++) void requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor }).catch(() => {});
    await expect(requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor })).rejects.toMatchObject({ kind: "busy" });
    __resetRelayHub();
    const again = ready();
    const before = again.sent.length;
    await expect(requestRelay("dev1", { method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "x".repeat(40_000) }, actor }))
      .rejects.toMatchObject({ kind: "too-large" });
    expect(again.sent.length).toBe(before);
    expect(sent.length).toBeGreaterThan(0);
  });
});
