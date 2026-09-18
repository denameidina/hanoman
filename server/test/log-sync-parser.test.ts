import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import type { FastifyInstance } from "fastify";

describe("parser POST /api/sync/logs", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ requireAuth: false }); });
  afterAll(async () => { await app.close(); });

  it("415 untuk content-encoding selain gzip/kosong", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sync/logs",
      headers: { "content-type": "application/json", "content-encoding": "br" },
      payload: Buffer.from("{}"),
    });
    expect(res.statusCode).toBe(415);
  });

  it("413 untuk body mentah > 1 MiB", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sync/logs", headers: { "content-type": "application/json" },
      payload: Buffer.alloc(1024 * 1024 + 1, "x"),
    });
    expect(res.statusCode).toBe(413);
  });

  it("POST /sync/push tak tersentuh — body besar yang lolos sebelumnya tetap lolos parser bawaan", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sync/push", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ records: [] }),
    });
    expect(res.statusCode).not.toBe(413);
    expect(res.statusCode).not.toBe(415);
  });
});
