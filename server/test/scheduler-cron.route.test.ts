import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { setScheduler } from "../src/services/scheduler/config";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.schedulerCronRun.deleteMany();
  await prisma.schedulerCron.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing", schedulerOptIn: true } });
  await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: true });
});
afterAll(clean);

const body = { project: "p1", name: "Cek pagi", expr: "0 7 * * *", prompt: "Periksa error." };
const create = () => app.inject({ method: "POST", url: "/api/scheduler/crons", payload: body });

describe("cron CRUD", () => {
  it("POST membuat cron nonaktif + nextRunAt terhitung", async () => {
    const r = await create();
    expect(r.statusCode).toBe(201);
    expect(r.json().enabled).toBe(false);
    expect(r.json().nextRunAt).not.toBeNull();
    expect(r.json().projectId).toBe("p1");
  });
  it("POST menolak expr tak sah (400)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/scheduler/crons", payload: { ...body, expr: "0 99 * * *" } });
    expect(r.statusCode).toBe(400);
  });
  it("POST menolak project yang tak ada (404)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/scheduler/crons", payload: { ...body, project: "nope" } });
    expect(r.statusCode).toBe(404);
  });
  it("GET menyaring per project dan beramplop paginasi", async () => {
    await create();
    const r = await app.inject({ method: "GET", url: "/api/scheduler/crons?projectId=p1&page=1&limit=10" });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(1);
    expect(r.json().pageSize).toBe(10);
    expect(r.json().items[0].name).toBe("Cek pagi");
  });
  it("PATCH expr menghitung ulang nextRunAt", async () => {
    const id = (await create()).json().id;
    const before = (await prisma.schedulerCron.findUnique({ where: { id } }))!.nextRunAt;
    const r = await app.inject({ method: "PATCH", url: `/api/scheduler/crons/${id}`, payload: { expr: "0 21 * * *" } });
    expect(r.statusCode).toBe(200);
    const after = (await prisma.schedulerCron.findUnique({ where: { id } }))!.nextRunAt;
    expect(after!.getTime()).not.toBe(before!.getTime());
    expect(after!.getHours()).toBe(21);
  });
  it("PATCH enabled=true menghitung nextRunAt bila belum ada", async () => {
    const id = (await create()).json().id;
    await prisma.schedulerCron.update({ where: { id }, data: { nextRunAt: null } });
    await app.inject({ method: "PATCH", url: `/api/scheduler/crons/${id}`, payload: { enabled: true } });
    expect((await prisma.schedulerCron.findUnique({ where: { id } }))!.nextRunAt).not.toBeNull();
  });
  it("DELETE menghapus cron beserta riwayat run-nya", async () => {
    const id = (await create()).json().id;
    await prisma.schedulerCronRun.create({ data: { cronId: id, projectId: "p1", dueAt: new Date() } });
    const r = await app.inject({ method: "DELETE", url: `/api/scheduler/crons/${id}` });
    expect(r.statusCode).toBe(204);
    expect(await prisma.schedulerCronRun.count({ where: { cronId: id } })).toBe(0);
  });
  it("PATCH/DELETE cron yang tak ada → 404", async () => {
    expect((await app.inject({ method: "PATCH", url: "/api/scheduler/crons/x", payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/scheduler/crons/x" })).statusCode).toBe(404);
  });
});

describe("jalankan sekarang", () => {
  it("membuat baris run manual berstatus queued", async () => {
    const id = (await create()).json().id;
    const r = await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` });
    expect(r.statusCode).toBe(201);
    expect(r.json().manual).toBe(true);
    expect(r.json().status).toBe("queued");
  });
  it("menolak 409 bila sudah ada run yang menunggu", async () => {
    const id = (await create()).json().id;
    await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` });
    const r = await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` });
    expect(r.statusCode).toBe(409);
  });
  it("menolak 409 saat scheduler mati", async () => {
    const id = (await create()).json().id;
    await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: false });
    const r = await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain("scheduler");
  });
  it("menolak 409 saat scheduler dijeda", async () => {
    const id = (await create()).json().id;
    await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: true, paused: true });
    expect((await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run` })).statusCode).toBe(409);
  });
});

describe("riwayat run", () => {
  it("beramplop paginasi, urut jatuh tempo turun", async () => {
    const id = (await create()).json().id;
    for (const h of [7, 8, 9]) {
      await prisma.schedulerCronRun.create({ data: { cronId: id, projectId: "p1", dueAt: new Date(2026, 7, 11, h, 0), status: "launched" } });
    }
    const r = await app.inject({ method: "GET", url: `/api/scheduler/crons/${id}/runs?page=1&limit=2` });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(3);
    expect(r.json().items).toHaveLength(2);
    expect(new Date(r.json().items[0].dueAt).getHours()).toBe(9);
  });
});

// SPEC-646 · gerbang capability: sebuah cron adalah `POST /terminal/sessions` yang DITUNDA, jadi
// `settings:write` tak boleh cukup untuknya.
describe("capabilityForRoute", () => {
  it("seluruh /scheduler/crons* COOKIE_ONLY di semua method", () => {
    for (const [m, p] of [
      ["GET", "/api/scheduler/crons"], ["POST", "/api/scheduler/crons"],
      ["PATCH", "/api/scheduler/crons/c1"], ["DELETE", "/api/scheduler/crons/c1"],
      ["POST", "/api/scheduler/crons/c1/run"], ["GET", "/api/scheduler/crons/c1/runs"],
    ] as const) {
      expect(capabilityForRoute(m, p), `${m} ${p}`).toBe("COOKIE_ONLY");
    }
  });
  it("endpoint scheduler lain tak berubah", () => {
    expect(capabilityForRoute("GET", "/api/scheduler/config")).toBe("settings:read");
    expect(capabilityForRoute("PUT", "/api/scheduler/config")).toBe("settings:write");
    expect(capabilityForRoute("GET", "/api/scheduler/queue")).toBe("settings:read");
  });
});
