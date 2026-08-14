import { describe, expect, it } from "vitest";
import {
  MAX_WS_MESSAGE_BYTES,
  WsMessageGuard,
  assertWsOrigin,
  consumeWsTicket,
  issueWsTicket,
  wsTicketProtocol,
} from "../src/services/ws-admission";

describe("WebSocket admission", () => {
  it("matches the complete Origin and rejects foreign or missing browser origins", () => {
    expect(() => assertWsOrigin("https://admin.example", new Set(["https://admin.example"]))).not.toThrow();
    expect(() => assertWsOrigin("https://admin.example:444", new Set(["https://admin.example"]))).toThrow();
    expect(() => assertWsOrigin("https://evil.example", new Set(["https://admin.example"]))).toThrow();
    expect(() => assertWsOrigin(undefined, new Set(["https://admin.example"]))).toThrow();
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
