import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { checkTriase, registerTriaseSource } from "../src/services/scheduler/sources/triase";
import { listQueue } from "../src/services/scheduler/queue";
import { listSources, clearSources } from "../src/services/scheduler/registry";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.ticketAttachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const mkProject = (id: string, schedulerOptIn: boolean) =>
  prisma.project.create({ data: { id, name: id, desc: "", kind: "existing", schedulerOptIn } });
let n = 0;
const mkTicket = (over: { projectId: string; category?: string; status?: string; specId?: string | null }) =>
  prisma.ticket.create({ data: {
    projectId: over.projectId, number: ++n, category: over.category ?? "bug",
    title: "keluhan", detail: "detail keluhan", reporterEmail: "r@e.co",
    status: over.status ?? "new", accessKeyHash: `k-${n}`, specId: over.specId ?? null,
  } });

describe("triase source-checker", () => {
  it("never promotes public tickets without an explicit human accept", async () => {
    await mkProject("opt", true);
    const t = await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    expect(await listQueue()).toHaveLength(0);
    expect(await prisma.spec.count()).toBe(0);
    const after = await prisma.ticket.findUnique({ where: { id: t.id } });
    expect(after!.status).toBe("new");
    expect(after!.specId).toBeNull();
  });

  it("does not promote either executable category", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug" });
    await mkTicket({ projectId: "opt", category: "fitur" });
    await checkTriase();
    expect(await prisma.spec.count()).toBe(0);
    expect(await prisma.ticket.count({ where: { status: "new" } })).toBe(2);
  });

  it("never auto-accepts pertanyaan/lainnya categories", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "pertanyaan" });
    await mkTicket({ projectId: "opt", category: "lainnya" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
    expect(await prisma.spec.count()).toBe(0);
    expect(await prisma.ticket.count({ where: { status: "new" } })).toBe(2);
  });

  it("skips tickets from non-opt-in projects", async () => {
    await mkProject("noopt", false);
    await mkTicket({ projectId: "noopt", category: "bug" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
  });

  it("is idempotent: accepted/rejected/linked tickets are not re-accepted", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug", status: "accepted", specId: "SPEC-EXIST" });
    await mkTicket({ projectId: "opt", category: "bug", status: "rejected" });
    await mkTicket({ projectId: "opt", category: "bug", status: "new", specId: "SPEC-LINK" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
  });

  it("leaves many public tickets pending instead of batch-launching them", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug" });
    await mkTicket({ projectId: "opt", category: "fitur" });
    await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
    expect(await prisma.ticket.count({ where: { status: "new" } })).toBe(3);
  });

  it("remains inert across repeated checks", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
    expect(await prisma.spec.count()).toBe(0);
  });

  it("registerTriaseSource registers a source with id 'triase'", () => {
    registerTriaseSource();
    expect(listSources().map((s) => s.id)).toContain("triase");
  });
});
