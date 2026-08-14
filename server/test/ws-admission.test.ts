import { describe, expect, it } from "vitest";
import {
  MAX_WS_MESSAGE_BYTES,
  WsMessageGuard,
  assertWsOrigin,
  consumeWsTicket,
  issueWsTicket,
  wsAllowlistFor,
  wsTicketProtocol,
} from "../src/services/ws-admission";

describe("WebSocket admission", () => {
  it("matches the complete Origin and rejects foreign or missing browser origins", () => {
    expect(() => assertWsOrigin("https://admin.example", new Set(["https://admin.example"]))).not.toThrow();
    expect(() => assertWsOrigin("https://admin.example:444", new Set(["https://admin.example"]))).toThrow();
    expect(() => assertWsOrigin("https://evil.example", new Set(["https://admin.example"]))).toThrow();
    expect(() => assertWsOrigin(undefined, new Set(["https://admin.example"]))).toThrow();
  });

  it("falls back to the request's own origin when no control allowlist is configured", () => {
    const none = new Set<string>();
    // Instalasi polos (`npm i -g hanoman`) tak menyetel HANOMAN_CONTROL_ORIGINS. Fail-closed di
    // sini mematikan SELURUH terminal, jadi di luar production gerbangnya turun ke same-origin —
    // tetap exact-match, cuma acuannya Host request, bukan daftar env.
    expect(wsAllowlistFor(none, "127.0.0.1:8787", { NODE_ENV: "development" }))
      .toEqual(new Set(["http://127.0.0.1:8787", "https://127.0.0.1:8787"]));
    // Kedua scheme: di belakang proxy TLS, browser mengirim Origin https sementara server hanya
    // pernah melihat Host tanpa scheme — membandingkan scheme di sini akan menolak tunnel yang sah.
    expect(wsAllowlistFor(none, "hm.example", { NODE_ENV: "development" }).has("https://hm.example")).toBe(true);
    // IPv6 tetap terbaca utuh, bukan terpotong di titik dua.
    expect(wsAllowlistFor(none, "[::1]:8787", { NODE_ENV: "development" }).has("http://[::1]:8787")).toBe(true);

    // Allowlist eksplisit selalu menang — Host tak pernah bisa memperlebarnya.
    const explicit = new Set(["https://admin.example"]);
    expect(wsAllowlistFor(explicit, "evil.example", { NODE_ENV: "development" })).toBe(explicit);

    // Production tetap fail-closed (ADR-0117): `assertRuntimeBoundary` sudah mewajibkan env-nya.
    expect(wsAllowlistFor(none, "127.0.0.1:8787", { NODE_ENV: "production" }).size).toBe(0);

    // Host yang tak masuk akal tak pernah jadi allowlist.
    for (const host of [undefined, "", "evil.example/path", "user@evil.example", "a b", "evil.example:80:80"])
      expect(wsAllowlistFor(none, host, { NODE_ENV: "development" }).size).toBe(0);
  });

  it("consumes a bounded, target-specific ticket exactly once", () => {
    const now = 1_000;
    const token = issueWsTicket({ kind: "user", id: "u1" }, "events", now);
    expect(wsTicketProtocol(token)).not.toContain("?");
    expect(consumeWsTicket(token, "events", now + 1)).toEqual({ kind: "user", id: "u1" });
    expect(() => consumeWsTicket(token, "events", now + 2)).toThrow();

    const wrongTarget = issueWsTicket({ kind: "user", id: "u1" }, "terminal:s1", now);
    expect(() => consumeWsTicket(wrongTarget, "events", now + 1)).toThrow();
    const expired = issueWsTicket({ kind: "user", id: "u1" }, "events", now);
    expect(() => consumeWsTicket(expired, "events", now + 30_001)).toThrow();
  });

  it("closes oversized and burst message streams", () => {
    const guard = new WsMessageGuard({ perWindow: 2, windowMs: 1_000 });
    expect(guard.accept(Buffer.alloc(MAX_WS_MESSAGE_BYTES), 1_000)).toEqual({ ok: true });
    expect(guard.accept(Buffer.from("x"), 1_001)).toEqual({ ok: true });
    expect(guard.accept(Buffer.from("x"), 1_002)).toEqual({ ok: false, code: 1008, reason: "rate limit" });

    const other = new WsMessageGuard();
    expect(other.accept(Buffer.alloc(MAX_WS_MESSAGE_BYTES + 1))).toEqual({ ok: false, code: 1009, reason: "message too large" });
  });
});
