import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { applyPush } from "../src/services/sync";
import { enqueueOutbox, listOutbox } from "../src/services/outbox";
import { syncOnce, setCursor, getCursor, applyFeedFrame, type Transport } from "../src/services/sync-client";
import { findTombstone, writeTombstone } from "../src/services/tombstone";
import { deleteSynced } from "../src/services/sync-delete";
import { setConfig, clearConfig } from "../src/config";

const app = buildApp();
const clean = async () => {
  await clearConfig("SYNC_SERVER_URL");
  await prisma.notification.deleteMany();
  await prisma.syncTombstone.deleteMany(); await prisma.syncConflict.deleteMany();
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany(); await prisma.syncState.deleteMany();
  await prisma.ticketAttachment.deleteMany(); await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

// Transport palsu: isi feed dikarang langsung, jadi kedua sisi bisa diuji dalam satu proses.
function fakeTransport(records: unknown[], cursor = "99", onPush?: (body: any) => any): Transport {
  return async (method, _path, body) => {
    if (method === "GET") return { status: 200, body: { cursor, records } };
    return { status: 200, body: onPush ? onPush(body) : { results: [{ ok: true, version: 1 }] } };
  };
}
const project = () => prisma.project.create({
  data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null },
});
const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang",
  author: "a", objective: "o", ...over,
});

describe("client: menerapkan tombstone (SPEC-799 · ADR-0119)", () => {
  it("tombstone dari feed menghapus baris lokal + menyimpan tombstone + memajukan kursor", async () => {
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 1, ...specData() } });
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData() }]);

    const s = await syncOnce(t);
    expect(s.deleted).toBe(1);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await findTombstone("spec", "SPEC-1")).toMatchObject({ version: 2 });
    expect(await getCursor()).toBe("99");
  });

  it("tombstone untuk baris yang TAK PERNAH ada = no-op sukses, kursor tetap maju", async () => {
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-ASING", version: 3, op: "delete", data: {} }]);
    const s = await syncOnce(t);
    expect(s.deleted).toBe(1);
    expect(await findTombstone("spec", "SPEC-ASING")).not.toBeNull();
    expect(await getCursor()).toBe("99");
  });

  it("upsert BASI atas id bertombstone dibuang (replay full-pull tak membangkitkan)", async () => {
    await project();
    await writeTombstone("spec", "SPEC-1", 5, {});
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-1", version: 4, data: specData() }]);
    const s = await syncOnce(t);
    expect(s.dropped).toBe(1);
    expect(s.pulled).toBe(0);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });

  it("upsert ber-version LEBIH TINGGI menghidupkan (pembuatan ulang sah dari hub)", async () => {
    await project();
    await writeTombstone("spec", "SPEC-1", 5, {});
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-1", version: 6, data: specData({ title: "lahir lagi" }) }]);
    const s = await syncOnce(t);
    expect(s.pulled).toBe(1);
    expect(await findTombstone("spec", "SPEC-1")).toBeNull();
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))?.title).toBe("lahir lagi");
  });

  it("record anak untuk induk bertombstone dibuang SENGAJA (bukan warn yatim)", async () => {
    await writeTombstone("project", "p-mati", 2, {});
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-9", version: 1, data: specData({ projectId: "p-mati" }) }]);
    const s = await syncOnce(t);
    expect(s.dropped).toBe(1);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-9" } })).toBeNull();
  });

  it("delete MENANG atas edit lokal pending + melahirkan notifikasi", async () => {
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 1, ...specData({ title: "edit lokal" }) } });
    await enqueueOutbox("spec", "SPEC-1");
    const t = fakeTransport([{ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData() }]);

    await syncOnce(t);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await listOutbox()).toHaveLength(0);
    expect(await prisma.notification.findFirst({ where: { key: "sync-delete:spec:SPEC-1:2" } })).not.toBeNull();
  });

  it("op tak dikenal DILEWATI tanpa menyalakan feedHole", async () => {
    await project();
    const t = fakeTransport([
      { entity: "spec", recordId: "SPEC-X", version: 1, op: "gaya-baru", data: specData() },
      { entity: "spec", recordId: "SPEC-Y", version: 1, data: specData() },
    ]);
    const s = await syncOnce(t);
    expect(s.dropped).toBe(1);
    expect(s.pulled).toBe(1);
    expect(await getCursor()).toBe("99");
  });

  it("hapus lokal saat offline → siklus berikutnya mem-push op=delete", async () => {
    await setConfig("SYNC_SERVER_URL", "http://hub.test");
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 4, ...specData() } });
    await deleteSynced("spec", "SPEC-1");

    let sent: any = null;
    const t = fakeTransport([], "0", (body) => { sent = body; return { results: [{ ok: true, version: 5 }] }; });
    const s = await syncOnce(t);

    expect(s.pushed).toBe(1);
    expect(sent.records[0]).toMatchObject({ entity: "spec", id: "SPEC-1", op: "delete", baseVersion: 4 });
    expect(sent.records[0].data).toMatchObject({ title: "t" }); // snapshot terakhir, demi hub lama
    expect(await listOutbox()).toHaveLength(0);
  });

  it("hub menolak upsert karena sudah dihapus → client mengadopsi tombstone & berhenti mendorong", async () => {
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 1, ...specData() } });
    await enqueueOutbox("spec", "SPEC-1");
    const t = fakeTransport([], "0", () => ({
      results: [{ ok: false, conflict: true, deleted: true, deletedVersion: 7, server: null }],
    }));

    const s = await syncOnce(t);
    expect(s.deleted).toBe(1);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await findTombstone("spec", "SPEC-1")).toMatchObject({ version: 7 });
    expect(await listOutbox()).toHaveLength(0);
  });

  it("frame WS op=delete diterapkan lewat applyFeedFrame", async () => {
    await project();
    await prisma.spec.create({ data: { id: "SPEC-1", version: 1, ...specData() } });
    const ok = await applyFeedFrame({
      entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData(), seq: "12",
    });
    expect(ok).toBe(true);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await getCursor()).toBe("12");
  });

  it("full pull (kursor 0) memutar ulang feed TANPA membangkitkan yang bertombstone", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const tok = await issueDeviceToken(u.id, "laptop");
    const real: Transport = async (method, path, body) => {
      const res = await app.inject({
        method, url: path, headers: { authorization: `Bearer ${tok.token}` }, ...(body ? { payload: body } : {}),
      });
      return { status: res.statusCode, body: res.json() };
    };
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());               // feed: upsert
    await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");   // feed: delete
    await prisma.spec.deleteMany();                                  // lokal sudah bersih

    await setCursor("0");
    await syncOnce(real);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();

    await setCursor("0");                 // putar ulang lagi — tetap konvergen
    await syncOnce(real);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });
});
