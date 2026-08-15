import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { findTombstone, writeTombstone, clearTombstone } from "../src/services/tombstone";

const clean = async () => { await prisma.syncTombstone.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("tombstone store (SPEC-799 · ADR-0119)", () => {
  it("tulis lalu baca kembali", async () => {
    await writeTombstone("project", "p1", 3, { name: "p1" }, "dev-1");
    const t = await findTombstone("project", "p1");
    expect(t).toMatchObject({ entity: "project", recordId: "p1", version: 3, deviceId: "dev-1" });
    expect(t?.data).toMatchObject({ name: "p1" });
  });

  it("id yang belum pernah dihapus → null", async () => {
    expect(await findTombstone("project", "belum-ada")).toBeNull();
  });

  it("idempoten & MONOTON: tulis ulang di version lebih rendah tak menurunkan", async () => {
    await writeTombstone("project", "p1", 5, { name: "baru" });
    await writeTombstone("project", "p1", 2, { name: "lama" });
    const t = await findTombstone("project", "p1");
    expect(t?.version).toBe(5);
    expect(t?.data).toMatchObject({ name: "baru" });
    expect(await prisma.syncTombstone.count()).toBe(1);
  });

  it("version lebih tinggi menimpa", async () => {
    await writeTombstone("project", "p1", 2, { name: "lama" });
    await writeTombstone("project", "p1", 7, { name: "baru" });
    expect((await findTombstone("project", "p1"))?.version).toBe(7);
  });

  it("clear menghapus; clear atas yang tak ada tak melempar", async () => {
    await writeTombstone("project", "p1", 1, {});
    await clearTombstone("project", "p1");
    expect(await findTombstone("project", "p1")).toBeNull();
    await expect(clearTombstone("project", "tak-ada")).resolves.toBeUndefined();
  });
});
