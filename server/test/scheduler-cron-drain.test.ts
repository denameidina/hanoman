import { LaunchAdmissionError } from "../src/services/session-admission";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { drainCronRuns, type CronDeps } from "../src/services/scheduler/governor";

const clean = async () => {
  await prisma.schedulerCronRun.deleteMany();
  await prisma.schedulerCron.deleteMany();
  await prisma.project.deleteMany();
  await prisma.notification.deleteMany();
};
beforeEach(clean); afterAll(clean);

const mk = async (over: Record<string, unknown> = {}, projectOver: Record<string, unknown> = {}) => {
  await prisma.project.upsert({
    where: { id: "p1" },
    update: { schedulerOptIn: true, ...projectOver },
    create: { id: "p1", name: "P1", desc: "", kind: "existing", schedulerOptIn: true, ...projectOver },
  });
  const cron = await prisma.schedulerCron.create({
    data: { projectId: "p1", name: "Cek pagi", expr: "0 7 * * *", prompt: "x", enabled: true, ...over },
  });
  const run = await prisma.schedulerCronRun.create({
    data: { cronId: cron.id, projectId: "p1", dueAt: new Date(2026, 7, 11, 7, 0) },
  });
  return { cron, run };
};
const deps = (over: Partial<CronDeps> = {}): CronDeps => ({
  liveCron: () => null,
  launchCron: async () => "cron_s1",
  ...over,
});
const statusOf = async (id: string) => (await prisma.schedulerCronRun.findUnique({ where: { id } }))!;

describe("drainCronRuns", () => {
  it("resource pressure keeps the existing cron run queued with metrics", async () => {
    const { run } = await mk();
    const remaining = await drainCronRuns(2, deps({ launchCron: async () => {
      throw new LaunchAdmissionError("host-load", {
        enabled: true, liveCount: 0, liveAgentCount: 0, maxConcurrent: 2,
        loadPerCore: 3.75, maxLoadPerCore: 2.5, loadStatus: "available",
      });
    } }));
    expect(remaining).toBe(2);
    expect(await statusOf(run.id)).toMatchObject({ status: "queued", sessionId: null });
    expect((await statusOf(run.id)).note).toContain("3.75");
  });

  it("meluncurkan dan mengembalikan sisa slot", async () => {
    const { run } = await mk();
    expect(await drainCronRuns(2, deps())).toBe(1);
    const r = await statusOf(run.id);
    expect(r.status).toBe("launched");
    expect(r.sessionId).toBe("cron_s1");
    expect(r.startedAt).not.toBeNull();
  });

  it("slot habis → baris tetap queued ber-note 'cap penuh', tak meluncur", async () => {
    const { run } = await mk();
    let launches = 0;
    expect(await drainCronRuns(0, deps({ launchCron: async () => { launches++; return "s"; } }))).toBe(0);
    expect(launches).toBe(0);
    const r = await statusOf(run.id);
    expect(r.status).toBe("queued");
    expect(r.note).toContain("cap penuh");
  });

  it("sesi cron sebelumnya masih hidup → skipped, slot tak terpakai", async () => {
    const { cron, run } = await mk();
    let launches = 0;
    const left = await drainCronRuns(2, deps({
      liveCron: (id) => (id === cron.id ? "cron_live" : null),
      launchCron: async () => { launches++; return "s"; },
    }));
    expect(left).toBe(2);
    expect(launches).toBe(0);
    const r = await statusOf(run.id);
    expect(r.status).toBe("skipped");
    expect(r.note).toContain("masih berjalan");
  });

  it("cron dinonaktifkan selagi mengantre → skipped", async () => {
    const { cron, run } = await mk();
    await prisma.schedulerCron.update({ where: { id: cron.id }, data: { enabled: false } });
    await drainCronRuns(2, deps());
    const r = await statusOf(run.id);
    expect(r.status).toBe("skipped");
    expect(r.note).toContain("nonaktif");
  });

  it("cron dihapus selagi mengantre → skipped", async () => {
    const { cron, run } = await mk();
    await prisma.schedulerCron.delete({ where: { id: cron.id } });
    await drainCronRuns(2, deps());
    expect((await statusOf(run.id)).status).toBe("skipped");
  });

  it("project belum opt-in scheduler → skipped dengan alasan tercatat", async () => {
    const { run } = await mk({}, { schedulerOptIn: false });
    await drainCronRuns(2, deps());
    const r = await statusOf(run.id);
    expect(r.status).toBe("skipped");
    expect(r.note).toContain("opt-in");
  });

  it("launch melempar → failed dengan pesannya, slot tak terpakai", async () => {
    const { run } = await mk();
    const left = await drainCronRuns(2, deps({
      launchCron: async () => { throw new Error('project "p1" belum di-bind ke checkout lokal'); },
    }));
    expect(left).toBe(2);
    const r = await statusOf(run.id);
    expect(r.status).toBe("failed");
    expect(r.note).toContain("belum di-bind");
  });

  it("peluncuran sukses menstempel lastRunAt cron", async () => {
    const { cron } = await mk();
    await drainCronRuns(1, deps());
    expect((await prisma.schedulerCron.findUnique({ where: { id: cron.id } }))!.lastRunAt).not.toBeNull();
  });

  it("tiap keadaan terminal menerbitkan tepat satu notifikasi", async () => {
    await mk();
    await drainCronRuns(1, deps());
    expect(await prisma.notification.count({ where: { type: "cron" } })).toBe(1);
  });
});
