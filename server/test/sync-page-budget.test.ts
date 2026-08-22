import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { pull } from "../src/services/sync";

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
