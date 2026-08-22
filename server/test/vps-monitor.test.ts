import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";
import { healthSweep, auditSweep } from "../src/services/vps-monitor";
import { PUBLISH_HEARTBEAT_MS } from "../src/services/vps-audit";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("vps monitor (SPEC-164)", () => {
  it("healthSweep mengisi lastSeenAt + health untuk semua vps", async () => {
    const v = await makeVps({ name: "m1", host: "198.51.100.31" });
    await healthSweep();
    const row = await prisma.vps.findUnique({ where: { id: v.id } });
    expect(row!.lastSeenAt).not.toBeNull();
    expect((row!.health as { disk: string }).disk).toBe("42%");
  });
  it("healthSweep: vps unreachable dilewati tanpa melempar, lastSeenAt tetap", async () => {
    await resetDb();
    process.env.FAKE_SSH_MODE = "unreachable";
    const v = await makeVps({ name: "m2", host: "198.51.100.32" });
    await expect(healthSweep()).resolves.toBeUndefined();
    expect((await prisma.vps.findUnique({ where: { id: v.id } }))!.lastSeenAt).toBeNull();
  });
  it("auditSweep melewati vps yang lastAuditAt-nya masih segar", async () => {
    await resetDb();
    const fresh = await makeVps({ name: "m3", host: "198.51.100.33", lastAuditAt: new Date() });
    const stale = await makeVps({ name: "m4", host: "198.51.100.34" });
    await auditSweep();
    expect((await prisma.vps.findUnique({ where: { id: fresh.id } }))!.audit).toBeNull();  // dilewati
    expect((await prisma.vps.findUnique({ where: { id: stale.id } }))!.audit).not.toBeNull(); // diaudit
  });
});

describe("SPEC-885 · healthSweep berhenti berdenyut ke change-feed", () => {
  const hitung = (id: string) => prisma.syncLog.count({ where: { entity: "vps", recordId: id } });

  it("health identik + denyut belum lewat → TIDAK ada baris SyncLog kedua", async () => {
    await resetDb(); await prisma.syncLog.deleteMany();
    const v = await makeVps({ name: "hb1", host: "198.51.100.41" });

    await healthSweep();
    expect(await hitung(v.id)).toBe(1);   // pertama kali selalu publish (health null → terisi)

    await healthSweep();
    expect(await hitung(v.id)).toBe(1);   // dulu: 2, dan begitu seterusnya tiap 5 menit
  });

  it("health berubah → tepat satu baris tambahan", async () => {
    await resetDb(); await prisma.syncLog.deleteMany();
    const v = await makeVps({ name: "hb2", host: "198.51.100.42" });
    await healthSweep();
    process.env.FAKE_SSH_DISK = "91%";
    try {
      await healthSweep();
      expect(await hitung(v.id)).toBe(2);
    } finally { delete process.env.FAKE_SSH_DISK; }
  });

  it("denyut berjangka: lastPublishedAt basi → publish walau health identik", async () => {
    await resetDb(); await prisma.syncLog.deleteMany();
    const v = await makeVps({ name: "hb3", host: "198.51.100.43" });
    await healthSweep();
    await prisma.vps.update({ where: { id: v.id }, data: {
      lastPublishedAt: new Date(Date.now() - PUBLISH_HEARTBEAT_MS - 1_000) } });

    await healthSweep();
    expect(await hitung(v.id)).toBe(2);
  });

  it("lastSeenAt tetap disegarkan tiap sapuan, publish atau tidak", async () => {
    await resetDb(); await prisma.syncLog.deleteMany();
    const v = await makeVps({ name: "hb4", host: "198.51.100.44" });
    await healthSweep();
    const pertama = (await prisma.vps.findUnique({ where: { id: v.id } }))!.lastSeenAt!;

    await healthSweep();
    const kedua = (await prisma.vps.findUnique({ where: { id: v.id } }))!.lastSeenAt!;
    expect(kedua.getTime()).toBeGreaterThanOrEqual(pertama.getTime());
    expect(await hitung(v.id)).toBe(1);   // disegarkan lokal TANPA menerbitkan
  });
});
