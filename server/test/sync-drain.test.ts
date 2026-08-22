import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import {
  syncOnce, syncTick, getCursor, setCursor, __resetSyncHealth, type Transport,
} from "../src/services/sync-client";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.syncState.deleteMany(); await prisma.syncTombstone.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned",
  priority: "sedang", author: "a@b.co", objective: "o", ...over,
});
const projectData = () => ({ name: "p1", desc: "d", kind: "existing", stack: "", gitRemote: null });

// Transport palsu yang menyajikan halaman-halaman tetap. Batas unit yang tepat untuk fase ini:
// yang diuji adalah KONTRAK lingkaran drain ("terus tarik selagi hasMore, bawa deferred"), bukan
// kemampuan hub memotong halaman — itu sudah diuji sync-page-budget.test.ts.
function pagedTransport(pages: Array<{ cursor: string; hasMore?: boolean; records: unknown[] }>): Transport {
  let i = 0;
  return async (method, path) => {
    if (method === "GET" && path.startsWith("/api/sync/pull")) {
      const page = pages[i] ?? { cursor: pages[pages.length - 1]?.cursor ?? "0", hasMore: false, records: [] };
      i++;
      return { status: 200, body: page };
    }
    return { status: 200, body: { results: [] } };
  };
}

describe("SPEC-885 · drain berkelanjutan", () => {
  it("anak di halaman 1 dan induk di halaman 2 → keduanya terpasang, nol dropped", async () => {
    // Bentuk feed ini BUKAN hipotesis. Retensi ADR-0131 menyimpan hanya baris terakhir per
    // record, jadi baris penciptaan induk lenyap dan yang tersisa ber-seq LEBIH BESAR daripada
    // anaknya: 510 dari 728 spec di hub produksi, 508 di antaranya di halaman berbeda.
    const transport = pagedTransport([
      { cursor: "10", hasMore: true, records: [
        { entity: "spec", recordId: "SPEC-1", version: 1, op: "upsert", data: specData() },
      ] },
      { cursor: "20", hasMore: false, records: [
        { entity: "project", recordId: "p1", version: 3, op: "upsert", data: projectData() },
      ] },
    ]);

    const stats = await syncOnce(transport);

    expect(stats.dropped).toBe(0);
    expect(stats.pulled).toBe(2);
    expect(await prisma.project.findUnique({ where: { id: "p1" } })).toBeTruthy();
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeTruthy();
    expect(await getCursor()).toBe("20");
  });

  it("satu panggilan menguras BANYAK halaman (bukan satu halaman per tick)", async () => {
    const transport = pagedTransport([
      { cursor: "10", hasMore: true, records: [
        { entity: "project", recordId: "p1", version: 1, op: "upsert", data: projectData() } ] },
      { cursor: "20", hasMore: true, records: [
        { entity: "spec", recordId: "SPEC-1", version: 1, op: "upsert", data: specData() } ] },
      { cursor: "30", hasMore: false, records: [
        { entity: "spec", recordId: "SPEC-2", version: 1, op: "upsert", data: specData() } ] },
    ]);

    const stats = await syncOnce(transport);

    expect(stats.pulled).toBe(3);
    expect(await getCursor()).toBe("30");
  });

  it("hub lama tanpa hasMore: terus tarik selagi halaman tak kosong, berhenti saat kosong", async () => {
    const transport = pagedTransport([
      { cursor: "10", records: [
        { entity: "project", recordId: "p1", version: 1, op: "upsert", data: projectData() } ] },
      { cursor: "20", records: [
        { entity: "spec", recordId: "SPEC-1", version: 1, op: "upsert", data: specData() } ] },
      { cursor: "20", records: [] },
    ]);

    const stats = await syncOnce(transport);

    expect(stats.pulled).toBe(2);
    expect(await getCursor()).toBe("20");
  });

  it("record yang induknya memang tak pernah ada dibuang SETELAH feed habis, dengan jejak", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = pagedTransport([
      { cursor: "10", hasMore: false, records: [
        { entity: "spec", recordId: "SPEC-9", version: 1, op: "upsert", data: specData({ projectId: "tak-ada" }) },
      ] },
    ]);

    const stats = await syncOnce(transport);

    expect(stats.dropped).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SPEC-9"));
    warn.mockRestore();
  });

  it("kursor yang tak maju menghentikan lingkaran (tak ada drain tak berujung)", async () => {
    let calls = 0;
    const transport: Transport = async (method, path) => {
      if (method === "GET" && path.startsWith("/api/sync/pull")) {
        calls++;
        return { status: 200, body: { cursor: "0", hasMore: true, records: [] } };
      }
      return { status: 200, body: { results: [] } };
    };
    await setCursor("0");

    await syncOnce(transport);

    expect(calls).toBe(1);
  });
});

describe("SPEC-885 · kegagalan pull tak boleh senyap", () => {
  it("mencatat sekali saat mulai gagal dan sekali saat pulih, bukan tiap tick", async () => {
    __resetSyncHealth();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    let sehat = false;
    const transport: Transport = async (method, path) => {
      if (method === "GET" && path.startsWith("/api/sync/pull")) {
        if (!sehat) throw new Error("outbound response terlalu besar");
        return { status: 200, body: { cursor: "1", hasMore: false, records: [] } };
      }
      return { status: 200, body: { results: [] } };
    };

    // Tiga siklus gagal berturut-turut → satu baris log, bukan tiga.
    for (let i = 0; i < 3; i++) await syncTick(transport);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/sync: pull gagal/);

    sehat = true;
    await syncTick(transport);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toMatch(/sync: pull pulih/);

    warn.mockRestore(); info.mockRestore();
  });
});
