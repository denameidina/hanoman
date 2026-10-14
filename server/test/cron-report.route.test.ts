import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { checkAgentCapability } from "../src/services/agent-capabilities";
import { makeProject, resetDb } from "./factory";

// ADR-0222 · REST laporan run cron.
const app = buildApp({ requireAuth: false });
const get = (url: string) => app.inject({ method: "GET", url });
const mk = (id: string, cronId: string, day: number, body: string, projectId = "p1") =>
  prisma.cronReport.create({ data: {
    id, projectId, cronId, cronName: "Cek biaya", runDate: `2026-10-${String(day).padStart(2, "0")}`,
    dueAt: new Date(2026, 9, day, 1, 0), body, bytes: Buffer.byteLength(body) } });

beforeEach(async () => {
  await resetDb(); await makeProject({ id: "p1" }); await makeProject({ id: "p2" });
  await mk("r1", "c1", 13, "A"); await mk("r2", "c1", 14, "B"); await mk("r3", "c2", 14, "C", "p2");
});

describe("GET /api/scheduler/reports", () => {
  it("daftar terbaru dulu, tanpa body; filter cronId/projectId; berhalaman", async () => {
    const all = (await get("/api/scheduler/reports")).json();
    expect(all.total).toBe(3);
    expect(all.items[0]).not.toHaveProperty("body");
    const c1 = (await get("/api/scheduler/reports?cronId=c1")).json();
    expect(c1.items.map((i: { id: string }) => i.id)).toEqual(["r2", "r1"]);
    expect((await get("/api/scheduler/reports?projectId=p2")).json().items.map((i: { id: string }) => i.id)).toEqual(["r3"]);
    expect((await get("/api/scheduler/reports?cronId=c1&limit=1&page=2")).json().items.map((i: { id: string }) => i.id)).toEqual(["r1"]);
  });
  it("cron tak dikenal → 200 daftar kosong, BUKAN 404", async () => {
    const r = await get("/api/scheduler/reports?cronId=tak-ada");
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(0);
  });
});

describe("GET /api/scheduler/reports/latest & /:id", () => {
  it("latest membawa body + filename; 404 bila kosong", async () => {
    const r = (await get("/api/scheduler/reports/latest?cronId=c1")).json();
    expect(r).toMatchObject({ id: "r2", body: "B", filename: "2026-10-14-cek-biaya-r2.md" });
    expect((await get("/api/scheduler/reports/latest?cronId=zzz")).statusCode).toBe(404);
  });
  it("latest tanpa filter = terbaru se-instance", async () => {
    expect((await get("/api/scheduler/reports/latest")).json().dueAt).toBeTruthy();
  });
  it(":id membawa body; tak ada → 404", async () => {
    expect((await get("/api/scheduler/reports/r1")).json()).toMatchObject({ id: "r1", body: "A" });
    expect((await get("/api/scheduler/reports/nope")).statusCode).toBe(404);
  });
});

describe("capability agent token", () => {
  it("scheduler:read cukup; settings:* tidak diwarisi; tulis tak ada", () => {
    expect(checkAgentCapability(["scheduler:read"], "GET", "/api/scheduler/reports")).toEqual({ ok: true });
    expect(checkAgentCapability(["scheduler:read"], "GET", "/api/scheduler/reports/latest")).toEqual({ ok: true });
    expect(checkAgentCapability(["settings:read"], "GET", "/api/scheduler/reports"))
      .toMatchObject({ ok: false, need: "scheduler:read" });
  });
});
