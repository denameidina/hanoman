import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { pull } from "../src/services/sync";
import { enqueueOutbox, listOutbox } from "../src/services/outbox";
import { syncOnce, getCursor, setCursor, syncNow, validateIncomingRecord, type Transport } from "../src/services/sync-client";
import { clearConfig } from "../src/config";

const app = buildApp();
const clean = async () => {
  await prisma.syncConflict.deleteMany();
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany(); await prisma.syncState.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function realTransport(): Promise<Transport> {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  const t = await issueDeviceToken(u.id, "laptop");
  return async (method, path, body) => {
    const res = await app.inject({ method, url: path, headers: { authorization: `Bearer ${t.token}` }, ...(body ? { payload: body } : {}) });
    return { status: res.statusCode, body: res.json() };
  };
}
const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang", author: "a", objective: "o", ...over,
});

describe("sync-client syncOnce (SPEC-213 AC-18/19)", () => {
  it("rejects malformed and oversized incoming records before apply", () => {
    expect(() => validateIncomingRecord({ entity: "unknown", recordId: "x", version: 1, data: {} })).toThrow(/entity/);
    expect(() => validateIncomingRecord({ entity: "spec", recordId: "x", version: 1,
      data: { payload: "x".repeat(1_100_000) } })).toThrow(/besar/);
    expect(() => validateIncomingRecord({ entity: "spec", recordId: "x", version: 1,
      data: { ...specData(), launchApprovedAt: new Date().toISOString() } })).toThrow(/field/);
    expect(() => validateIncomingRecord({ entity: "spec", recordId: "x", version: 1,
      data: { ...specData(), createdAt: "bukan-tanggal" } })).toThrow(/tanggal/);
    expect(() => validateIncomingRecord({ entity: "ticketAttachment", recordId: "x", version: 1,
      data: { size: "besar" } })).toThrow(/tipe/);
    expect(() => validateIncomingRecord({ entity: "project", recordId: "baru", version: 1,
      data: { renamedFrom: "lama" } })).not.toThrow();
  });
  it("drains outbox: pushes local record to hub", async () => {
    const transport = await realTransport();
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-1", ...specData() } });
    await enqueueOutbox("spec", "SPEC-1");

    const res = await syncOnce(transport);
    expect(res.pushed).toBe(1);
    expect((await pull("0")).records.map((r) => r.recordId)).toContain("SPEC-1");
    expect(await listOutbox()).toHaveLength(0);
  });

  it("pulls new hub records + advances cursor; idempotent second run", async () => {
    const transport = await realTransport();
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    // simulasikan hub sudah punya record: push via transport (ber-token), lalu reset kursor lokal.
    await transport("POST", "/api/sync/push", { records: [{ entity: "spec", id: "SPEC-2", baseVersion: 0, data: specData() }] });
    await setCursor("0");

    const first = await syncOnce(transport);
    expect(first.pulled).toBeGreaterThanOrEqual(1);
    expect(Number(await getCursor())).toBeGreaterThan(0);
    const second = await syncOnce(transport);
    expect(second.pulled).toBe(0);
  });

  it("conflict: stale push kept in outbox, local record uncorrupted (AC-19)", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-3", version: 1, ...specData({ title: "local" }) } });
    await enqueueOutbox("spec", "SPEC-3");
    // stub transport: pull kosong, push balas conflict
    const stub: Transport = async (method) => {
      if (method === "GET") return { status: 200, body: { cursor: "0", records: [] } };
      return { status: 200, body: { results: [{ id: "SPEC-3", ok: false, conflict: true, server: { version: 5, data: specData({ title: "server" }) } }] } };
    };
    const res = await syncOnce(stub);
    expect(res.conflicts).toBe(1);
    expect(await listOutbox()).toHaveLength(1); // tetap di outbox
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-3" } }))?.title).toBe("local"); // tak korup
  });

  it("drain outbox projectRename → push record project ber-renamedFrom (SPEC-255)", async () => {
    // seed: project baru sudah ada lokal (post-rename), outbox punya projectRename old→new
    await prisma.project.create({ data: { id: "newp", name: "newp", desc: "d", kind: "existing" } });
    await enqueueOutbox("projectRename", "oldp newp");
    const pushed: Array<{ records: Array<{ entity: string; id: string; data: Record<string, unknown> }> }> = [];
    const stub: Transport = async (method, path, body) => {
      if (method === "GET") return { status: 200, body: { cursor: "0", records: [] } };
      pushed.push(body as { records: Array<{ entity: string; id: string; data: Record<string, unknown> }> });
      return { status: 200, body: { results: [{ id: "newp", ok: true, version: 1 }] } };
    };
    const res = await syncOnce(stub);
    expect(res.pushed).toBe(1);
    const rec = pushed[0]!.records[0]!;
    expect(rec.entity).toBe("project");
    expect(rec.id).toBe("newp");
    expect(rec.data.renamedFrom).toBe("oldp");
    expect(await listOutbox()).toHaveLength(0);
  });

  it("syncNow: null bila SYNC_SERVER_URL/TOKEN kosong (bukan client) (SPEC-268)", async () => {
    await prisma.runtimeConfig.deleteMany();
    await clearConfig("SYNC_SERVER_URL"); await clearConfig("SYNC_DEVICE_TOKEN");
    expect(await syncNow()).toBeNull();
  });
});

// SPEC-270 · ADR-0067 · klasifikasi konflik + fix versi setelah push (stub transport: hub=lokal
// berbagi satu DB, jadi divergensi disimulasikan via respons stub, bukan seed nyata).
describe("sync-client konflik (SPEC-270)", () => {
  const hub = { ...specData({ title: "judul-hub2" }), updatedAt: "2020-01-03T00:00:00.000Z" };

  it("edit dua-sisi → SyncConflict dicatat, tak clobber lokal", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-1", ...specData({ title: "judul-lokal" }), version: 1,
      updatedAt: new Date("2020-01-02T00:00:00.000Z") } });
    await enqueueOutbox("spec", "SPEC-1");
    const stub: Transport = async (method) => {
      if (method === "GET") return { status: 200, body: { cursor: "5",
        records: [{ entity: "spec", recordId: "SPEC-1", version: 2, data: hub }] } };
      return { status: 200, body: { results: [{ id: "SPEC-1", ok: false, conflict: true,
        server: { version: 2, data: hub } }] } };
    };
    const res = await syncOnce(stub);
    expect(res.conflicts).toBe(1);
    expect(await prisma.syncConflict.count({ where: { resolvedAt: null } })).toBe(1);
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.title).toBe("judul-lokal");
  });

  it("push sukses menaikkan versi lokal = versi hub", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-9", ...specData(), version: 0 } });
    await enqueueOutbox("spec", "SPEC-9");
    const stub: Transport = async (method) => {
      if (method === "GET") return { status: 200, body: { cursor: "0", records: [] } };
      return { status: 200, body: { results: [{ id: "SPEC-9", ok: true, version: 1 }] } };
    };
    await syncOnce(stub);
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-9" } }))!.version).toBe(1);
  });
});
