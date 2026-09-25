import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type RequestListener, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import {
  __resetSafeGlobalFetchForTest, defaultLookup, installSafeGlobalFetch, safeRequest, toGlobalLookup,
} from "../src/services/safe-outbound-request";

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

  // Insiden 2026-09-23 · ADR pending: `dns.lookup()` lama tak punya batas waktu sama sekali —
  // resolver yang macet membekukan pemanggil (sync-client) SELAMANYA, dan proses macet di
  // `process.exit()` saat `requestRestartForUpdate` dipanggil (thread threadpool yang stuck tak
  // pernah selesai di-`pthread_join`). `lookupAll` yang tak pernah resolve harus tetap ditolak
  // dalam `connectMs`, bukan menggantung.
  it("times out a hung DNS lookup within connectMs instead of hanging forever", async () => {
    const start = Date.now();
    await expect(safeRequest({
      url: new URL("https://hub.test/sync"), method: "GET", headers: {}, allowPrivate: true,
      connectMs: 200, totalMs: 5_000, maxResponseBytes: 10,
    }, { lookupAll: () => new Promise<never>(() => {}) })).rejects.toThrow(/outbound timeout/);
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it("treats an IP-literal hostname as its own address without querying DNS", async () => {
    await expect(defaultLookup("127.0.0.1")).resolves.toEqual([{ address: "127.0.0.1", family: 4 }]);
    await expect(defaultLookup("::1")).resolves.toEqual([{ address: "::1", family: 6 }]);
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

// Insiden 2026-09-25: fix DNS non-threadpool di atas cuma menutup lubang untuk safeRequest.
// `update.ts`, `github-fetch.ts`, `limits.ts`, dan telegram/* masih memanggil `fetch()` global
// polos, yang di Node memakai `dns.lookup()` (threadpool) untuk resolusi hostname secara default —
// jadi kelas bug yang sama (satu lookup macet → `process.exit()` menggantung selamanya di
// `pthread_join`) tetap terbuka di titik-titik itu. `toGlobalLookup` + `installSafeGlobalFetch`
// menutupnya SEKALI di titik masuk (global dispatcher undici, yang dipakai bersama oleh fetch()
// bawaan Node — lihat docs undici) alih-alih di setiap pemanggil satu per satu.
describe("toGlobalLookup", () => {
  it("answers with a scalar address/family when the caller does not ask for all", async () => {
    const lookup = toGlobalLookup(async () => [{ address: "93.184.216.34", family: 4 }]);
    const cb = vi.fn();
    await new Promise<void>((resolve) => {
      lookup("example.test", {}, (...args) => { cb(...args); resolve(); });
    });
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("answers with the full address array when the caller asks for all (autoSelectFamily)", async () => {
    const addrs = [{ address: "93.184.216.34", family: 4 }, { address: "::ffff:93.184.216.34", family: 6 }];
    const lookup = toGlobalLookup(async () => addrs);
    const cb = vi.fn();
    await new Promise<void>((resolve) => {
      lookup("example.test", { all: true }, (...args) => { cb(...args); resolve(); });
    });
    // Bentuk callback ini WAJIB (err, address, family) tiga-tiganya — sama seperti `LookupFunction`
    // bawaan Node — jadi `family` tetap terkirim (diabaikan pemanggil) walau `all: true`.
    expect(cb).toHaveBeenCalledWith(null, addrs, 0);
  });

  it("filters by the requested family before answering", async () => {
    const lookup = toGlobalLookup(async () => [
      { address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 },
    ]);
    const cb = vi.fn();
    await new Promise<void>((resolve) => {
      lookup("example.test", { family: 6 }, (...args) => { cb(...args); resolve(); });
    });
    expect(cb).toHaveBeenCalledWith(null, "::1", 6);
  });

  it("calls back with ENOTFOUND when the resolver returns no addresses", async () => {
    const lookup = toGlobalLookup(async () => []);
    const cb = vi.fn();
    await new Promise<void>((resolve) => {
      lookup("nowhere.test", {}, (...args) => { cb(...args); resolve(); });
    });
    expect(cb).toHaveBeenCalledTimes(1);
    const err = cb.mock.calls[0]![0] as NodeJS.ErrnoException;
    expect(err.code).toBe("ENOTFOUND");
  });

  it("forwards a rejected lookup as the callback error instead of throwing", async () => {
    const lookup = toGlobalLookup(async () => { throw new Error("resolver meledak"); });
    const cb = vi.fn();
    await new Promise<void>((resolve) => {
      lookup("boom.test", {}, (...args) => { cb(...args); resolve(); });
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect((cb.mock.calls[0]![0] as Error).message).toMatch(/resolver meledak/);
  });
});

describe("installSafeGlobalFetch", () => {
  afterEach(() => { __resetSafeGlobalFetchForTest(); });

  it("installs the dispatcher exactly once even when called repeatedly", () => {
    const setDispatcher = vi.fn();
    const makeDispatcher = vi.fn(() => ({ fake: "dispatcher" }));
    installSafeGlobalFetch({ makeDispatcher, setDispatcher });
    installSafeGlobalFetch({ makeDispatcher, setDispatcher });
    expect(makeDispatcher).toHaveBeenCalledTimes(1);
    expect(setDispatcher).toHaveBeenCalledTimes(1);
  });

  it("builds the dispatcher from a lookup routed through toGlobalLookup", () => {
    const setDispatcher = vi.fn();
    const makeDispatcher = vi.fn((lookup: unknown) => ({ lookup }));
    installSafeGlobalFetch({ lookup: async () => [{ address: "1.2.3.4", family: 4 }], makeDispatcher, setDispatcher });
    expect(makeDispatcher).toHaveBeenCalledTimes(1);
    expect(typeof makeDispatcher.mock.calls[0]![0]).toBe("function");
  });

  // Bukti nyata, bukan cuma unit test adapter-nya: pasang dispatcher SUNGGUHAN (Agent +
  // setGlobalDispatcher asli dari paket `undici`) dan buktikan Node built-in fetch() ikut memakai
  // lookup custom-nya — inilah yang harus benar-benar bekerja di Node ini, bukan cuma di teori docs.
  it("real fetch() actually resolves through the installed lookup instead of dns.lookup()", async () => {
    const origin = await listen((_req, res) => { res.writeHead(204); res.end(); });
    const port = new URL(origin).port;
    installSafeGlobalFetch({ lookup: async (host) => {
      if (host !== "definitely-not-a-real-host.test") throw new Error(`unexpected host ${host}`);
      return [{ address: "127.0.0.1", family: 4 }];
    } });
    const res = await fetch(`http://definitely-not-a-real-host.test:${port}/`);
    expect(res.status).toBe(204);
  });
});
