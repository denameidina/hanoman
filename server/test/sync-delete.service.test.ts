import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { deleteSynced, listPendingDeletes } from "../src/services/sync-delete";
import { notifySynced } from "../src/services/sync-notify";
import { findTombstone } from "../src/services/tombstone";
import { pull, snapshot } from "../src/services/sync";
import { listOutbox } from "../src/services/outbox";
import { setConfig, clearConfig } from "../src/config";

const clean = async () => {
  await clearConfig("SYNC_SERVER_URL"); // peran default = HUB
  await prisma.syncTombstone.deleteMany(); await prisma.syncLog.deleteMany();
  await prisma.syncOutbox.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const project = () => prisma.project.create({
  data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null },
});
const specRow = (id: string) => prisma.spec.create({
  data: { id, projectId: "p1", title: "t", source: "brief", stage: "planned",
          priority: "sedang", author: "a", objective: "o", version: 4 },
});
const asClient = () => setConfig("SYNC_SERVER_URL", "http://hub.test");

describe("deleteSynced (SPEC-799 · ADR-0119)", () => {
  it("peran HUB: hapus baris, tulis tombstone, terbitkan ke feed", async () => {
    await project(); await specRow("SPEC-1");
    expect(await deleteSynced("spec", "SPEC-1")).toBe(true);

    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
    expect(await findTombstone("spec", "SPEC-1")).toMatchObject({ version: 5 });
    expect((await pull("0")).records).toContainEqual(
      expect.objectContaining({ entity: "spec", recordId: "SPEC-1", op: "delete", version: 5 }),
    );
    expect(await listOutbox()).toHaveLength(0);
  });

  it("peran CLIENT: tombstone + outbox, TANPA menulis feed", async () => {
    await asClient();
    await project(); await specRow("SPEC-1");
    await deleteSynced("spec", "SPEC-1");

    expect(await findTombstone("spec", "SPEC-1")).not.toBeNull();
    expect((await listOutbox()).map((o) => o.recordId)).toContain("SPEC-1");
    expect((await pull("0")).records.filter((r) => r.op === "delete")).toHaveLength(0);
  });

  it("baris yang tak ada → false, tanpa tombstone & tanpa feed", async () => {
    expect(await deleteSynced("spec", "SPEC-HANTU")).toBe(false);
    expect(await findTombstone("spec", "SPEC-HANTU")).toBeNull();
    expect((await pull("0")).records).toHaveLength(0);
  });

  it("listPendingDeletes hanya melaporkan outbox yang barisnya sudah tak ada", async () => {
    await asClient();
    await project(); await specRow("SPEC-1"); await specRow("SPEC-2");
    await deleteSynced("spec", "SPEC-1");
    await notifySynced("spec", "SPEC-2"); // edit biasa → outbox, TAPI barisnya masih ada

    expect((await listPendingDeletes()).map((p) => p.recordId)).toEqual(["SPEC-1"]);
  });

  it("membuat ulang id bertombstone lalu notifySynced → tombstone dikonsumsi, version terangkat", async () => {
    await asClient();
    await project(); await specRow("SPEC-1");
    await deleteSynced("spec", "SPEC-1");          // tombstone di version 5
    await specRow("SPEC-1");                        // lahir lagi (version 4 dari fixture)
    await notifySynced("spec", "SPEC-1");

    expect(await findTombstone("spec", "SPEC-1")).toBeNull();
    expect((await snapshot("spec", "SPEC-1"))?.version).toBe(5);
    expect(await listPendingDeletes()).toHaveLength(0);
  });
});
