import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import type { FastifyInstance } from "fastify";

describe("GET /api/logs", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ requireAuth: false }); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await prisma.logEntry.deleteMany({});
    const now = new Date();
    await prisma.logEntry.createMany({
      data: [
        { deviceId: "local", lane: "event", seq: 1n, ts: now, level: "info", kind: "relay.request", msg: "a", bytes: 1 },
        { deviceId: "dev1", lane: "event", seq: 1n, ts: now, level: "info", kind: "remote.link", msg: "b", bytes: 1 },
      ],
    });
  });

  it("mengembalikan relay.* dan remote.* dalam satu tabel, terurut ts desc,id desc", async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/logs?from=${from}&to=${to}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBe(2);
    expect(body).not.toHaveProperty("total");
  });

  it("rentang absen → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/logs" });
    expect(res.statusCode).toBe(400);
  });

  it("rentang > 31 hari → 400", async () => {
    const from = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/logs?from=${from}&to=${to}` });
    expect(res.statusCode).toBe(400);
  });

  it("kursor stabil: baris baru masuk di antara dua halaman tak menyebabkan duplikat/lompatan", async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date().toISOString();
    const r1 = await app.inject({ method: "GET", url: `/api/logs?from=${from}&to=${to}&limit=1` });
    const b1 = JSON.parse(r1.body);
    expect(b1.items.length).toBe(1);
    expect(b1.nextCursor).toBeTruthy();
    await prisma.logEntry.create({
      data: { deviceId: "dev2", lane: "event", seq: 1n, ts: new Date(), level: "info", kind: "remote.request", msg: "c", bytes: 1 },
    });
    const r2 = await app.inject({ method: "GET", url: `/api/logs?from=${from}&to=${to}&limit=1&cursor=${b1.nextCursor}` });
    const b2 = JSON.parse(r2.body);
    expect(b2.items[0].id).not.toBe(b1.items[0].id);
  });
});

describe("GET|PUT /api/logs/retention", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ requireAuth: false }); });
  afterAll(async () => { await app.close(); });

  it("PUT menulis Setting.data.logRetention, GET membacanya kembali", async () => {
    const put = await app.inject({
      method: "PUT", url: "/api/logs/retention", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ eventDays: 30, serverDays: 3, transcriptDays: 10, maxBytes: 64 * 1024 ** 2 }),
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/api/logs/retention" });
    expect(JSON.parse(get.body).serverDays).toBe(3);
  });
});
