import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { sweepCronDue, GRACE_MS, queuedCronRuns } from "../src/services/scheduler/cron";
import { setScheduler } from "../src/services/scheduler/config";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = async () => {
  await prisma.schedulerCronRun.deleteMany();
  await prisma.schedulerCron.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => { await clean(); await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: true }); });
afterAll(clean);

const mkCron = (over: Record<string, unknown> = {}) => prisma.schedulerCron.create({
  data: {
    projectId: "p1", name: "Cek pagi", expr: "0 7 * * *", prompt: "Periksa error.",
    enabled: true, nextRunAt: new Date(2026, 7, 11, 7, 0), ...over,
  },
});

describe("sweepCronDue", () => {
  it("materialisasi SATU baris queued saat jatuh tempo dalam grace", async () => {
    const c = await mkCron();
    await sweepCronDue(new Date(2026, 7, 11, 7, 0, 30).getTime());
    const runs = await prisma.schedulerCronRun.findMany({ where: { cronId: c.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("queued");
    expect(runs[0]!.dueAt.getTime()).toBe(new Date(2026, 7, 11, 7, 0).getTime());
  });

  it("tick berulang tak menduplikasi baris untuk jatuh tempo yang sama", async () => {
    const c = await mkCron();
    const t = new Date(2026, 7, 11, 7, 0, 30).getTime();
    await sweepCronDue(t);
    // Paksa nextRunAt mundur lagi seolah tulisan sebelumnya gagal — kunci idempotensinya harus
    // baris run, bukan kolom nextRunAt.
    await prisma.schedulerCron.update({ where: { id: c.id }, data: { nextRunAt: new Date(2026, 7, 11, 7, 0) } });
    await sweepCronDue(t + 1000);
    expect(await prisma.schedulerCronRun.count({ where: { cronId: c.id } })).toBe(1);
  });

  // Dua kasus, dan bedanya mengikat: "tertunggak" tak sama dengan "terlambat". Yang dilarang
  // adalah BURST — 21 jatuh tempo yang lewat tak boleh jadi 21 baris — sementara jatuh tempo
  // TERBARU tetap dinilai dengan grace yang sama seperti jatuh tempo biasa.
  it("jatuh tempo tertunggak: 21 yang lewat jadi SATU baris, bukan burst", async () => {
    // Cron tiap jam, nextRunAt tertinggal 20 jam; jatuh tempo terbaru (08:00) baru 5 menit lalu.
    const c = await mkCron({ expr: "0 * * * *", nextRunAt: new Date(2026, 7, 10, 12, 0) });
    await sweepCronDue(new Date(2026, 7, 11, 8, 5).getTime());
    const runs = await prisma.schedulerCronRun.findMany({ where: { cronId: c.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("queued");   // masih dalam grace → memang layak dijalankan
    expect(runs[0]!.dueAt.getTime()).toBe(new Date(2026, 7, 11, 8, 0).getTime());
  });

  it("jatuh tempo terbaru di LUAR grace → satu baris skipped ber-alasan terlewat", async () => {
    const c = await mkCron({ expr: "0 * * * *", nextRunAt: new Date(2026, 7, 10, 12, 0) });
    await sweepCronDue(new Date(2026, 7, 11, 8, 45).getTime());
    const runs = await prisma.schedulerCronRun.findMany({ where: { cronId: c.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("skipped");
    expect(runs[0]!.note).toContain("terlewat 20 jatuh tempo");
    expect(runs[0]!.dueAt.getTime()).toBe(new Date(2026, 7, 11, 8, 0).getTime());
  });

  it("baris queued yang lewat grace jadi skipped membawa note terakhirnya", async () => {
    const c = await mkCron();
    await prisma.schedulerCronRun.create({
      data: { cronId: c.id, projectId: "p1", dueAt: new Date(2026, 7, 11, 7, 0), note: "cap penuh" },
    });
    await sweepCronDue(new Date(2026, 7, 11, 7, 0).getTime() + GRACE_MS + 60_000);
    const run = await prisma.schedulerCronRun.findFirst({ where: { cronId: c.id } });
    expect(run!.status).toBe("skipped");
    expect(run!.note).toContain("cap penuh");
  });

  it("cron nonaktif tak pernah dimaterialisasi", async () => {
    const c = await mkCron({ enabled: false });
    await sweepCronDue(new Date(2026, 7, 11, 7, 0, 30).getTime());
    expect(await prisma.schedulerCronRun.count({ where: { cronId: c.id } })).toBe(0);
  });

  it("baris terminal menerbitkan notifikasi ber-key stabil (tak dobel)", async () => {
    const c = await mkCron({ expr: "0 * * * *", nextRunAt: new Date(2026, 7, 10, 12, 0) });
    const t = new Date(2026, 7, 11, 8, 45).getTime();
    await sweepCronDue(t);
    await sweepCronDue(t + 1000);
    const notifs = await prisma.notification.findMany({ where: { type: "cron" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.key).toContain(c.id);
  });

  it("nextRunAt selalu bergerak MAJU melewati now", async () => {
    const c = await mkCron();
    const t = new Date(2026, 7, 11, 7, 0, 30).getTime();
    await sweepCronDue(t);
    const after = await prisma.schedulerCron.findUnique({ where: { id: c.id } });
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(t);
  });

  it("queuedCronRuns mengembalikan baris queued urut jatuh tempo", async () => {
    const c = await mkCron({ enabled: false });
    for (const h of [9, 7, 8]) {
      await prisma.schedulerCronRun.create({ data: { cronId: c.id, projectId: "p1", dueAt: new Date(2026, 7, 11, h, 0) } });
    }
    expect((await queuedCronRuns()).map((r) => r.dueAt.getHours())).toEqual([7, 8, 9]);
  });
});
