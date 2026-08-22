import { afterEach, describe, expect, it } from "vitest";
import { createServer, type RequestListener, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { safeRequest } from "../src/services/safe-outbound-request";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))); });
const listen = async (handler: RequestListener) => {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}`;
};

describe("safe outbound request", () => {
  it.each([301, 302, 307, 308])("does not follow HTTP %i or forward body/secret", async (status) => {
    let captures = 0;
    const target = await listen((_req, res) => { captures++; res.end("captured"); });
    const source = await listen((_req, res) => { res.writeHead(status, { location: target }); res.end(); });
    const response = await safeRequest({
      url: new URL(`${source}/hook`), method: "POST", headers: { "x-secret": "s" },
      body: Buffer.from("payload"), allowPrivate: true, connectMs: 2_000, totalMs: 2_000, maxResponseBytes: 1024,
    });
    expect(response.status).toBe(status);
    expect(captures).toBe(0);
  });

  it("pins the validated address into the connection lookup", async () => {
    let connected = "";
    const response = await safeRequest({
      url: new URL("http://example.test/hook"), method: "POST", headers: {}, allowPrivate: false,
      connectMs: 2_000, totalMs: 2_000, maxResponseBytes: 1024,
    }, {
      lookupAll: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (input) => { connected = input.address; return { status: 204, headers: {}, body: Buffer.alloc(0) }; },
    });
    expect(response.status).toBe(204);
    expect(connected).toBe("93.184.216.34");
  });

  // SPEC-? · regresi: `pinnedRequest` memanggil callback `lookup` dalam bentuk SKALAR
  // `(err, address, family)`. Sejak Node 20 `autoSelectFamily` menyala secara default, jadi
  // socket meminta `all: true` dan Node membaca `addresses[0].address` dari hasilnya →
  // `undefined` → ERR_INVALID_IP_ADDRESS sebelum satu paket pun keluar. Test lama tak pernah
  // menangkapnya karena semuanya memakai URL ber-IP literal (`127.0.0.1`), dan untuk itu Node
  // melewati `lookup` sama sekali. Hostname-lah yang menyalakan jalur ini.
  it("connects through the pinned lookup when the URL carries a hostname", async () => {
    const origin = await listen((_req, res) => { res.writeHead(204); res.end(); });
    const port = new URL(origin).port;
    const response = await safeRequest({
      url: new URL(`http://pinned.test:${port}/hook`), method: "GET", headers: {}, allowPrivate: true,
      connectMs: 2_000, totalMs: 2_000, maxResponseBytes: 1024,
    }, { lookupAll: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(response.status).toBe(204);
  });

  it("rejects the entire DNS answer when any address is private", async () => {
    await expect(safeRequest({
      url: new URL("https://example.test/hook"), method: "GET", headers: {}, allowPrivate: false,
      connectMs: 100, totalMs: 100, maxResponseBytes: 10,
    }, { lookupAll: async () => [
      { address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 },
    ] })).rejects.toThrow(/internal/);
  });
});

describe("SPEC-885 · dekompresi gzip opt-in", () => {
  const opts = (base: string) => ({
    url: new URL(`${base}/x`), method: "GET" as const, headers: {},
    allowPrivate: true, connectMs: 2_000, totalMs: 5_000, maxResponseBytes: 1024 * 1024,
  });

  it("men-decompress hanya saat diminta", async () => {
    const isi = gzipSync(Buffer.from(JSON.stringify({ ok: true })));
    const base = await listen((_req, res) => {
      res.setHeader("content-encoding", "gzip");
      res.end(isi);
    });

    const diminta = await safeRequest({ ...opts(base), acceptEncoding: "gzip" });
    expect(JSON.parse(diminta.body.toString("utf8"))).toEqual({ ok: true });

    // Tanpa opt-in body dikembalikan APA ADANYA (byte gzip mentah) — pemanggil lain seperti
    // webhook keluar tak boleh berubah perilakunya karena fitur ini.
    const tanpa = await safeRequest(opts(base));
    expect(tanpa.body.equals(isi)).toBe(true);
  });

  it("menolak bom dekompresi: cap kedua atas byte TERURAI", async () => {
    // 40 MB nol mampat jadi ~40 KB — lolos maxResponseBytes, dan itulah kenapa satu cap saja
    // tidak cukup begitu dekompresi menyala.
    const bom = gzipSync(Buffer.alloc(40 * 1024 * 1024));
    expect(bom.length).toBeLessThan(1024 * 1024);
    const base = await listen((_req, res) => {
      res.setHeader("content-encoding", "gzip");
      res.end(bom);
    });

    await expect(safeRequest({
      ...opts(base), acceptEncoding: "gzip", maxDecodedBytes: 1024 * 1024,
    })).rejects.toThrow(/terurai terlalu besar/);
  });
});
