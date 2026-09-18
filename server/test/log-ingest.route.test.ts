import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import type { FastifyInstance } from "fastify";

describe("POST /api/sync/logs", () => {
  let app: FastifyInstance;
  let token: string;
  beforeAll(async () => {
    app = await buildApp({ requireAuth: false });
    const user = await prisma.user.create({ data: { email: "log-ingest-route@x.co", passwordHash: "x:y" } });
    const dev = await issueDeviceToken(user.id, "dev-test");
    token = dev.token;
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await prisma.logEntry.deleteMany({}); await prisma.logCursor.deleteMany({}); });

  const post = (body: unknown) => app.inject({
    method: "POST", url: "/api/sync/logs",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });

  it("200 menerima batch event, kirim ulang identik → duplicate = jumlah entri", async () => {
    const body = { lane: "event", entries: [{ seq: "1", ts: new Date().toISOString(), level: "info", kind: "x", msg: "y" }] };
    const r1 = await post(body);
    expect(r1.statusCode).toBe(200);
    expect(JSON.parse(r1.body).accepted).toBe(1);
    const r2 = await post(body);
    expect(JSON.parse(r2.body).duplicate).toBe(1);
    expect(JSON.parse(r2.body).accepted).toBe(0);
  });

  it("400 untuk skema tak valid", async () => {
    const r = await post({ lane: "event", entries: [{ seq: "abc" }] });
    expect(r.statusCode).toBe(400);
  });

  it("lajur transcript menulis berkas sebelum baris DB (S3.4)", async () => {
    const body = {
      lane: "transcript",
      entries: [{ seq: "1", ts: new Date().toISOString(), level: "info", kind: "session.transcript", msg: "sesi x", transcript: "isi transkrip" }],
    };
    const r = await post(body);
    expect(r.statusCode).toBe(200);
    const row = await prisma.logEntry.findFirst({ where: { lane: "transcript" } });
    expect(row?.transcriptKey).toBeTruthy();
  });
});
