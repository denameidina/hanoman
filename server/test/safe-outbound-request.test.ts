import { afterEach, describe, expect, it } from "vitest";
import { createServer, type RequestListener, type Server } from "node:http";
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

  it("rejects the entire DNS answer when any address is private", async () => {
    await expect(safeRequest({
      url: new URL("https://example.test/hook"), method: "GET", headers: {}, allowPrivate: false,
      connectMs: 100, totalMs: 100, maxResponseBytes: 10,
    }, { lookupAll: async () => [
      { address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 },
    ] })).rejects.toThrow(/internal/);
  });
});
