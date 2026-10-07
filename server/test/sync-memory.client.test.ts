import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import {
  __resetSyncClientState, applyFeedFrame, catchUpOptional, syncOnce, validateIncomingRecord, type Transport,
} from "../src/services/sync-client";
import { enqueueOutbox } from "../src/services/outbox";
import { publishLocal } from "../src/services/sync";

const app = buildApp({ requireAuth: false });
let token = "";
const transport = (opts: { oldHub?: boolean } = {}): Transport => async (method, path, body) => {
  const r = await app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, ...(body ? { payload: body as object } : {}) });
  const parsed = r.body ? JSON.parse(r.body) : null;
  if (opts.oldHub && parsed && "entities" in parsed) delete parsed.entities;   // hub lama tak beriklan
  return { status: r.statusCode, body: parsed };
};
const seen: string[] = [];
const spy = (t: Transport): Transport => async (m, p, b) => { seen.push(`${m} ${p}`); return t(m, p, b); };

const clean = async () => {
  await prisma.syncOutbox.deleteMany(); await prisma.syncState.deleteMany(); await prisma.syncConflict.deleteMany();
  await prisma.syncLog.deleteMany(); await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "sc-p" } });
};
beforeEach(async () => {
  await clean(); __resetSyncClientState(); seen.length = 0;
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany({ where: { email: "sc@t.co" } });
  const u = await prisma.user.create({ data: { email: "sc@t.co", passwordHash: "x:y" } });
  token = (await issueDeviceToken(u.id, "dev")).token;
  await prisma.project.create({ data: { id: "sc-p", name: "p", desc: "", kind: "existing" } });
  await publishLocal("project", "sc-p");
});
afterAll(clean);

describe("toleransi entitas tak dikenal", () => {
  it("validateIncomingRecord tetap melempar UnknownEntityError (kontrak lama)", () => {
    expect(() => validateIncomingRecord({ entity: "masaDepan", recordId: "x", version: 1, data: {} })).toThrow(/entity/);
  });
  it("frame WS entitas tak dikenal tak menyalakan feedHole (kursor tetap maju)", async () => {
    expect(await applyFeedFrame({ entity: "masaDepan", recordId: "x", version: 1, data: {}, seq: "99" })).toBe(true);
  });
});

describe("negosiasi", () => {
  it("pull & bootstrap menyebut entities=", async () => {
    await syncOnce(spy(transport()));
    expect(seen.some((s) => s.includes("entities=projectMemory,memoryEvent"))).toBe(true);
  });
  it("hub lama (tanpa iklan) → push memori DITAHAN di outbox, tanpa error", async () => {
    const m = await prisma.projectMemory.create({ data: { projectId: "sc-p", kind: "fact", content: "c", scopePaths: [],
      anchors: [], status: "active", sourceRuntime: "human" } });
    await enqueueOutbox("projectMemory", m.id);
    await syncOnce(transport({ oldHub: true }));
    expect(await prisma.syncOutbox.count({ where: { entity: "projectMemory" } })).toBe(1);
  });
});

describe("merge pending di client", () => {
  it("record memori pending + hub mengirim status lebih tinggi → status lokal naik, tanpa SyncConflict", async () => {
    const m = await prisma.projectMemory.create({ data: { projectId: "sc-p", kind: "fact", content: "c", scopePaths: [],
      anchors: [], status: "active", sourceRuntime: "human" } });
    await publishLocal("projectMemory", m.id);
    await prisma.projectMemory.update({ where: { id: m.id }, data: { status: "invalidated" } });
    await publishLocal("projectMemory", m.id);     // "hub" kini invalidated
    await prisma.projectMemory.update({ where: { id: m.id }, data: { status: "active", version: 1 } }); // lokal basi
    await enqueueOutbox("projectMemory", m.id);
    await syncOnce(transport());
    expect(await prisma.syncConflict.count()).toBe(0);
    expect((await prisma.projectMemory.findUnique({ where: { id: m.id } }))?.status).toBe("invalidated");
  });
});

describe("catch-up entitas opsional", () => {
  it("kursor sudah maju, penanda kosong, hub beriklan → bootstrap only=… sekali, lalu penanda tercatat", async () => {
    await syncOnce(transport());                    // kursor > 0, hubOptional terisi
    await prisma.syncState.update({ where: { id: 1 }, data: { entities: "" } });
    seen.length = 0;
    await catchUpOptional(spy(transport()));
    expect(seen.some((s) => s.includes("/api/sync/bootstrap") && s.includes("only=projectMemory,memoryEvent"))).toBe(true);
    expect((await prisma.syncState.findUnique({ where: { id: 1 } }))?.entities).toBe("projectMemory,memoryEvent");
    seen.length = 0;
    await catchUpOptional(spy(transport()));
    expect(seen).toEqual([]);
  });
});
