import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  applyPush, pull, snapshot, publishDelete, backfillFeed, deleteRow,
  consumeTombstoneOnRecreate, setAcceptedHook,
} from "../src/services/sync";
import { findTombstone, writeTombstone } from "../src/services/tombstone";

const clean = async () => {
  await prisma.syncTombstone.deleteMany(); await prisma.syncLog.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(async () => { setAcceptedHook(undefined); await clean(); });

const project = () => prisma.project.create({
  data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: "/local/only" },
});
const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang",
  author: "a@b.co", objective: "o", ...over,
});

describe("hub: tombstone di change-feed (SPEC-799 · ADR-0119)", () => {
  it("push op=delete menghapus baris, menulis tombstone, meng-append feed op=delete", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    const r = await applyPush("spec", "SPEC-1", 1, {}, "dev-1", "delete");

    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await findTombstone("spec", "SPEC-1")).toMatchObject({ version: 2 });

    const feed = (await pull("0")).records;
    expect(feed[feed.length - 1]).toMatchObject({ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete" });
  });

  it("baris feed op=delete membawa snapshot TERAKHIR — kontrak kompat client lama", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData({ title: "judul terakhir" }));
    await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");
    const last = (await pull("0")).records.at(-1)!;
    expect(last.data).toMatchObject({ title: "judul terakhir", projectId: "p1" });
  });

  it("delete menang TANPA SYARAT: baseVersion basi tetap diterima", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    await applyPush("spec", "SPEC-1", 1, specData({ stage: "executing" }));
    const r = await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete"); // basi (server di 2)
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });

  it("delete atas id yang tak pernah ada = ok, tombstone tetap lahir", async () => {
    const r = await applyPush("spec", "SPEC-HANTU", 0, {}, undefined, "delete");
    expect(r).toMatchObject({ ok: true, version: 1 });
    expect(await findTombstone("spec", "SPEC-HANTU")).not.toBeNull();
  });

  it("delete berulang IDEMPOTEN: nol baris feed kedua, version tak naik", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");
    const before = await prisma.syncLog.count();
    const r = await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(await prisma.syncLog.count()).toBe(before);
  });

  it("upsert atas id bertombstone DITOLAK sebagai conflict ber-deleted", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    await applyPush("spec", "SPEC-1", 1, {}, undefined, "delete");
    const r = await applyPush("spec", "SPEC-1", 1, specData({ title: "BANGKIT" }));
    expect(r).toMatchObject({ ok: false, conflict: true, deleted: true, deletedVersion: 2, server: null });
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });

  it("insert id-absen yang bertombstone tak lagi otomatis diterima (jalur 2 brief)", async () => {
    await project();
    await writeTombstone("spec", "SPEC-9", 4, {});
    const r = await applyPush("spec", "SPEC-9", 0, specData());
    expect(r).toMatchObject({ ok: false, conflict: true, deleted: true });
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-9" } })).toBeNull();
  });

  it("push ber-baseVersion = versi tombstone DITERIMA (pembuatan ulang yang sah)", async () => {
    await project();
    await writeTombstone("spec", "SPEC-9", 4, {});
    const r = await applyPush("spec", "SPEC-9", 4, specData({ title: "lahir lagi" }));
    expect(r).toMatchObject({ ok: true, version: 5 });
    expect(await findTombstone("spec", "SPEC-9")).toBeNull();
    expect((await snapshot("spec", "SPEC-9"))?.data).toMatchObject({ title: "lahir lagi" });
  });

  it("publishDelete memicu siar ber-op delete", async () => {
    const seen: { op?: string; recordId: string }[] = [];
    setAcceptedHook((row) => { seen.push(row as never); });
    await project();
    await prisma.spec.create({ data: { id: "SPEC-2", version: 1, ...specData() } });
    const snap = (await snapshot("spec", "SPEC-2"))!;
    await deleteRow("spec", "SPEC-2");
    await writeTombstone("spec", "SPEC-2", snap.version + 1, snap.data);
    await publishDelete("spec", "SPEC-2");
    expect(seen.at(-1)).toMatchObject({ recordId: "SPEC-2", op: "delete" });
    setAcceptedHook(undefined);
  });

  it("backfillFeed mempublish tombstone yang belum punya baris feed", async () => {
    await writeTombstone("project", "p-lama", 3, { name: "p-lama" });
    const n = await backfillFeed();
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await pull("0")).records).toContainEqual(
      expect.objectContaining({ entity: "project", recordId: "p-lama", op: "delete", version: 3 }),
    );
    expect(await backfillFeed()).toBe(0); // idempoten
  });

  it("consumeTombstoneOnRecreate mengangkat version baris baru ke versi tombstone", async () => {
    await project();
    await writeTombstone("spec", "SPEC-5", 6, {});
    await prisma.spec.create({ data: { id: "SPEC-5", ...specData() } }); // lahir di version 0
    expect(await consumeTombstoneOnRecreate("spec", "SPEC-5")).toBe(true);
    expect(await findTombstone("spec", "SPEC-5")).toBeNull();
    expect((await snapshot("spec", "SPEC-5"))?.version).toBe(6);
  });

  // Kendala eksplisit brief: rename BUKAN hapus — keduanya tak boleh saling menelan.
  it("rename project tidak melahirkan tombstone bagi id lama", async () => {
    await project();
    await applyPush("project", "p2", 0, { name: "p1", desc: "d", kind: "existing", renamedFrom: "p1" });
    expect(await findTombstone("project", "p1")).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "p2" } })).not.toBeNull();
  });

  it("rename ke id yang BERTOMBSTONE ditolak, bukan diam-diam membangkitkannya", async () => {
    await project();
    await writeTombstone("project", "p2", 3, {});
    const r = await applyPush("project", "p2", 0, { name: "p1", desc: "d", kind: "existing", renamedFrom: "p1" });
    expect(r).toMatchObject({ ok: false, conflict: true, deleted: true });
    expect(await prisma.project.findUnique({ where: { id: "p2" } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "p1" } })).not.toBeNull(); // tak ikut hilang
  });

  it("consumeTombstoneOnRecreate no-op bila barisnya memang tak ada", async () => {
    await writeTombstone("spec", "SPEC-6", 2, {});
    expect(await consumeTombstoneOnRecreate("spec", "SPEC-6")).toBe(false);
    expect(await findTombstone("spec", "SPEC-6")).not.toBeNull();
  });
});
