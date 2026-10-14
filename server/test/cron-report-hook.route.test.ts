import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { sessionEventToken } from "../src/services/session-event-token";
import { makeProject, resetDb } from "./factory";

// ADR-0222 · hook `Stop` sesi cron → laporan. tmux di-mock seperti session-events.route.test.ts.
const PANE: Record<string, unknown> = {
  "cron-c1": { id: "cron-c1", projectId: "p1", exited: false, agent: "claude", decisionFile: "/m", cwd: "/w" },
  "spec-1": { id: "spec-1", projectId: "p1", specId: "SPEC-1", exited: false, agent: "claude", decisionFile: "/m", cwd: "/w" },
};
vi.mock("../src/services/pty", async (orig) => ({
  ...(await orig<typeof import("../src/services/pty")>()),
  getSession: vi.fn((id: string) => PANE[id]),
  getSessionAsync: vi.fn(async (id: string) => PANE[id]),
  listSessions: vi.fn(() => Object.values(PANE)),
}));

const app = buildApp({ requireAuth: false });
const stop = (id: string, msg: unknown, extra: object = {}) => app.inject({
  method: "POST", url: "/api/session-events",
  headers: { authorization: `Bearer ${sessionEventToken(id)}`, "x-hanoman-session": id },
  payload: { hook_event_name: "Stop", turn_id: "t1", last_assistant_message: msg, ...extra },
});

beforeEach(async () => {
  await resetDb();
  await prisma.schedulerCronRun.deleteMany(); await prisma.schedulerCron.deleteMany();
  await makeProject({ id: "p1" });
  await prisma.schedulerCron.create({ data: { id: "c1", projectId: "p1", name: "Cek biaya", expr: "0 1 * * *", prompt: "x" } });
});

describe("POST /api/session-events · Stop sesi cron", () => {
  it("menyimpan last_assistant_message sebagai laporan run launched", async () => {
    const run = await prisma.schedulerCronRun.create({ data: {
      cronId: "c1", projectId: "p1", dueAt: new Date(2026, 9, 14, 1, 0), status: "launched", sessionId: "cron-c1", startedAt: new Date() } });
    const res = await stop("cron-c1", "# Biaya hari ini\nRp 1");
    expect(res.statusCode).toBeLessThan(300);
    expect((await prisma.cronReport.findUnique({ where: { id: run.id } }))?.body).toBe("# Biaya hari ini\nRp 1");
  });

  it("tetap menyimpan walau stop_hook_active (giliran bangkitan hook lain)", async () => {
    const run = await prisma.schedulerCronRun.create({ data: {
      cronId: "c1", projectId: "p1", dueAt: new Date(2026, 9, 14, 1, 0), status: "launched", sessionId: "cron-c1", startedAt: new Date() } });
    await stop("cron-c1", "final", { stop_hook_active: true });
    expect((await prisma.cronReport.findUnique({ where: { id: run.id } }))?.body).toBe("final");
  });

  it("sesi non-cron tak menghasilkan laporan; pesan non-string diabaikan tanpa error", async () => {
    await prisma.schedulerCronRun.create({ data: {
      cronId: "c1", projectId: "p1", dueAt: new Date(), status: "launched", sessionId: "cron-c1", startedAt: new Date() } });
    expect((await stop("spec-1", "x")).statusCode).toBeLessThan(500);
    expect((await stop("cron-c1", 42)).statusCode).toBeLessThan(500);
    expect(await prisma.cronReport.count()).toBe(0);
  });
});
