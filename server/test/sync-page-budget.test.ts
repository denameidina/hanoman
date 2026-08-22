import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createServer } from "node:http";
import { prisma } from "../src/db";
import { pull } from "../src/services/sync";
import { fetchTransport } from "../src/services/sync-client";

const clean = async () => { await prisma.syncLog.deleteMany(); };
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
