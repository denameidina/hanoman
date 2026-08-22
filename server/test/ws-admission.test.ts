import { describe, expect, it } from "vitest";
import {
  MAX_WS_MESSAGE_BYTES,
  WS_REVALIDATE_EVERY_MS,
  WsMessageGuard,
  createPrincipalWatch,
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

  // Pengawas principal per socket. Terukur di jalur lama: `await revalidateWsPrincipal` per frame
  // membuat dua frame beruntun berlomba di Prisma dan `writeTo` kedua mendahului yang pertama
  // (`bcdef` mendarat `bdcef` di tmux), dan satu query yang tertahan pool (5 dtk terukur) atau
  // melempar P1008 menahan lalu menutup socket yang sah. Keputusan admit karena itu sinkron:
  // ia hanya membaca verdict terakhir, dan pemeriksaannya berjalan di latar.
  describe("createPrincipalWatch", () => {
    type Deferred = { resolve: (ok: boolean) => void; reject: (e: Error) => void };
    const harness = (everyMs = WS_REVALIDATE_EVERY_MS) => {
      let now = 10_000;
      const checks: Deferred[] = [];
      let revoked = 0;
      const watch = createPrincipalWatch({
        check: () => new Promise<boolean>((resolve, reject) => { checks.push({ resolve, reject }); }),
        onRevoked: () => { revoked += 1; },
        now: () => now,
        everyMs,
      });
      const tick = () => new Promise((r) => setTimeout(r, 0));
      return { watch, checks, tick, revoked: () => revoked, advance: (ms: number) => { now += ms; } };
    };

    it("admits frames synchronously while the first check is still in flight", async () => {
      const h = harness();
      expect(h.watch.admit()).toBe(true);
      expect(h.watch.admit()).toBe(true);
      expect(h.checks.length).toBe(1);           // satu pemeriksaan, bukan satu per frame
      h.checks[0]!.resolve(true);
      await h.tick();
      expect(h.revoked()).toBe(0);
    });

    it("re-checks at most once per interval while frames keep arriving", async () => {
      const h = harness(1_000);
      h.watch.admit();
      h.checks[0]!.resolve(true);
      await h.tick();
      for (let i = 0; i < 50; i += 1) { h.advance(10); expect(h.watch.admit()).toBe(true); }
      expect(h.checks.length).toBe(1);           // 500 ms berlalu: masih di dalam jendela
      h.advance(600);
      expect(h.watch.admit()).toBe(true);
      expect(h.checks.length).toBe(2);           // jendela habis → satu pemeriksaan baru
      for (let i = 0; i < 5; i += 1) h.watch.admit();
      expect(h.checks.length).toBe(2);           // yang sedang berjalan tak digandakan
    });

    it("revokes once and refuses every frame after the verdict", async () => {
      const h = harness();
      h.watch.admit();
      h.checks[0]!.resolve(false);
      await h.tick();
      expect(h.revoked()).toBe(1);
      expect(h.watch.admit()).toBe(false);
      h.advance(5_000);
      expect(h.watch.admit()).toBe(false);
      expect(h.checks.length).toBe(1);           // sudah dicabut: tak ada pemeriksaan lagi
      expect(h.revoked()).toBe(1);
    });

    it("treats a failing check as no verdict: the socket stays open and is re-checked after the interval", async () => {
      const h = harness(1_000);
      h.watch.admit();
      h.checks[0]!.reject(new Error("P1008"));
      await h.tick();
      expect(h.revoked()).toBe(0);
      h.advance(500);
      expect(h.watch.admit()).toBe(true);
      expect(h.checks.length).toBe(1);           // DB yang sakit tak dihujani satu query per frame
      h.advance(600);
      expect(h.watch.admit()).toBe(true);
      expect(h.checks.length).toBe(2);           // jendela habis → dicoba lagi
      h.checks[1]!.resolve(false);
      await h.tick();
      expect(h.revoked()).toBe(1);               // pencabutan sungguhan tetap sampai
    });

    it("refresh forces a check regardless of the interval, without duplicating one in flight", async () => {
      const h = harness(1_000);
      h.watch.admit();
      h.checks[0]!.resolve(true);
      await h.tick();
      h.advance(10);
      h.watch.refresh();
      expect(h.checks.length).toBe(2);
      h.watch.refresh();
      expect(h.checks.length).toBe(2);
      h.checks[1]!.resolve(false);
      await h.tick();
      expect(h.revoked()).toBe(1);
    });

    it("dispose silences a verdict that lands after the socket is gone", async () => {
      const h = harness();
      h.watch.admit();
      h.watch.dispose();
      h.checks[0]!.resolve(false);
      await h.tick();
      expect(h.revoked()).toBe(0);
    });
  });
});
