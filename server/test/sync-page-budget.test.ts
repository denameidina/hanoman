import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { pull } from "../src/services/sync";
import { fetchTransport } from "../src/services/sync-client";

const clean = async () => {
  await prisma.syncLog.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

const feedRow = (recordId: string, bytes: number) => prisma.syncLog.create({
  data: { entity: "spec", recordId, version: 1, op: "upsert", data: { title: "x".repeat(bytes) } },
});

describe("SPEC-885 · anggaran byte halaman pull", () => {
  it("memotong halaman per byte, dan kursor menunjuk baris yang BENAR-BENAR dikirim", async () => {
    for (let i = 1; i <= 5; i++) await feedRow(`SPEC-${i}`, 50_000);

    const page = await pull("0", 500, 120_000);
    expect(page.records).toHaveLength(2);          // 3 baris sudah 150 KB > 120 KB
    expect(page.hasMore).toBe(true);

    const rows = await prisma.syncLog.findMany({ orderBy: { seq: "asc" } });
    expect(page.cursor).toBe(String(rows[1]!.seq));

    // Tak ada satu baris pun yang terlompati kursor — inilah invarian fase ini.
    const next = await pull(page.cursor, 500, 120_000);
    expect(next.records[0]!.recordId).toBe("SPEC-3");
  });

  it("satu baris yang sendirian melewati anggaran TETAP dikirim (feed tak boleh beku)", async () => {
    await feedRow("SPEC-BIG", 200_000);
    const page = await pull("0", 500, 1_000);
    expect(page.records).toHaveLength(1);
    expect(page.records[0]!.recordId).toBe("SPEC-BIG");
  });

  it("halaman terakhir menjawab hasMore=false", async () => {
    await feedRow("SPEC-1", 10);
    const page = await pull("0", 500, 120_000);
    expect(page.hasMore).toBe(false);
  });
});

describe("SPEC-885 · cap byte client terhadap hub lama", () => {
  it("halaman pull 3 MB tak lagi ditolak (reproduksi mandek hub produksi)", async () => {
    const body = JSON.stringify({
      cursor: "9",
      records: [{
        entity: "spec", recordId: "SPEC-1", version: 1, op: "upsert",
        data: { title: "x".repeat(3_000_000) },
      }],
    });
    const srv = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(body);
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;
    try {
      const transport = fetchTransport(`http://127.0.0.1:${port}`, "token-uji");
      const res = await transport("GET", "/api/sync/pull?since=0");
      expect(res.status).toBe(200);
      expect(res.body.records).toHaveLength(1);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe("SPEC-885 · gzip endpoint sync (hub)", () => {
  it("membalas gzip saat diminta, plain saat tidak", async () => {
    const app = buildApp();
    const u = await prisma.user.create({ data: { email: "g@g.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    await feedRow("SPEC-1", 5_000);

    const dimampat = await app.inject({
      method: "GET", url: "/api/sync/pull?since=0",
      headers: { authorization: `Bearer ${t.token}`, "accept-encoding": "gzip" },
    });
    expect(dimampat.headers["content-encoding"]).toBe("gzip");
    expect(dimampat.headers["vary"]).toBe("accept-encoding");
    const isi = JSON.parse(gunzipSync(dimampat.rawPayload).toString("utf8"));
    expect(isi.records[0].recordId).toBe("SPEC-1");
    expect(dimampat.rawPayload.length).toBeLessThan(1_000); // 5 KB "x" berulang mampat jauh

    const polos = await app.inject({
      method: "GET", url: "/api/sync/pull?since=0",
      headers: { authorization: `Bearer ${t.token}` },
    });
    expect(polos.headers["content-encoding"]).toBeUndefined();
    expect(polos.json().records[0].recordId).toBe("SPEC-1");
  });
});
