import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "executing", priority: "tinggi" });
  await prisma.member.create({ data: { id: "a@x.id", name: "Adi", email: "a@x.id" } });
});

const create = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/tasks", payload });

describe("POST /tasks", () => {
  it("membuat kartu; hanya title yang wajib", async () => {
    const res = await create({ title: "Rapat internal" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: "Rapat internal", projectId: null, memberId: null,
      status: "backlog", priority: "sedang", order: 0, specId: null, spec: null,
    });
  });

  it("menerima project, assignee, tanggal, prioritas", async () => {
    const res = await create({
      title: "Desain landing", projectId: "p1", memberId: "a@x.id", priority: "tinggi",
      startDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-09-08T00:00:00.000Z", order: 1.5,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      projectId: "p1", memberId: "a@x.id", priority: "tinggi",
      startDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-09-08T00:00:00.000Z", order: 1.5,
    });
  });

  it("menolak 400 status di luar empat kolom", async () => {
    expect((await create({ title: "x", status: "executing" })).statusCode).toBe(400);
  });

  // FK ada, tapi pesan Prisma P2003 menyebut nama constraint, bukan nilai yang salah.
  it("menolak 400 memberId yang tak ada, menyebut nilainya", async () => {
    const res = await create({ title: "x", memberId: "hantu@x.id" });
    expect(res.statusCode).toBe(400);
    expect(res.json().memberId).toBe("hantu@x.id");
  });

  it("menolak 400 projectId yang tak ada, menyebut nilainya", async () => {
    const res = await create({ title: "x", projectId: "hantu" });
    expect(res.statusCode).toBe(400);
    expect(res.json().projectId).toBe("hantu");
  });

  it("mencatat version-stamp sync", async () => {
    const id = (await create({ title: "x" })).json().id;
    expect(await prisma.syncLog.findFirst({ where: { entity: "task", recordId: id } })).not.toBeNull();
  });
});

describe("GET /tasks", () => {
  beforeEach(async () => {
    await create({ title: "Desain", projectId: "p1", order: 2 });
    await create({ title: "Deploy", projectId: "p1", status: "doing", memberId: "a@x.id", order: 1 });
    await create({ title: "Rapat", order: 0 });
    await prisma.task.updateMany({ where: { title: "Deploy" }, data: { specId: "SPEC-1" } });
  });

  it("beramplop Paginated, urut `order` menaik", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((t: { title: string }) => t.title)).toEqual(["Rapat", "Deploy", "Desain"]);
    expect(res.json()).toMatchObject({ total: 3, page: 1, pageSize: 3 });
  });

  it("menyaring projectId, status, memberId", async () => {
    const byProject = await app.inject({ method: "GET", url: "/api/tasks?projectId=p1" });
    expect(byProject.json().total).toBe(2);
    const byStatus = await app.inject({ method: "GET", url: "/api/tasks?status=doing" });
    expect(byStatus.json().items.map((t: { title: string }) => t.title)).toEqual(["Deploy"]);
    const byMember = await app.inject({ method: "GET", url: "/api/tasks?memberId=a%40x.id" });
    expect(byMember.json().total).toBe(1);
  });

  it("memaginasi (ADR-0107)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks?page=2&limit=2" });
    expect(res.json()).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(res.json().items).toHaveLength(1);
  });

  // Cermin backlog BACA-SAJA, dihitung saat baca (ADR-0090) — tak ada kolom stage di Task.
  it("menyertakan cermin spec { id, stage, priority }", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks?status=doing" });
    expect(res.json().items[0].spec).toEqual({ id: "SPEC-1", stage: "executing", priority: "tinggi" });
  });

  it("tautan putus: specId tetap terisi, spec null", async () => {
    await prisma.spec.delete({ where: { id: "SPEC-1" } });
    const res = await app.inject({ method: "GET", url: "/api/tasks?status=doing" });
    expect(res.json().items[0]).toMatchObject({ specId: "SPEC-1", spec: null });
  });
});

describe("PATCH /tasks/:id", () => {
  it("memindahkan kolom & urutan (drop kanban)", async () => {
    const id = (await create({ title: "Desain", projectId: "p1" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`,
      payload: { status: "review", order: 3.25 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "review", order: 3.25 });
  });

  it("field yang tak dikirim tak tersentuh", async () => {
    const id = (await create({ title: "Desain", dueDate: "2026-09-08T00:00:00.000Z" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`, payload: { status: "doing" } });
    expect(res.json()).toMatchObject({ title: "Desain", dueDate: "2026-09-08T00:00:00.000Z", status: "doing" });
  });

  it("boleh mengosongkan assignee & project eksplisit", async () => {
    const id = (await create({ title: "x", projectId: "p1", memberId: "a@x.id" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`,
      payload: { memberId: null, projectId: null } });
    expect(res.json()).toMatchObject({ memberId: null, projectId: null });
  });

  it("menolak 400 memberId yang tak ada", async () => {
    const id = (await create({ title: "x" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`, payload: { memberId: "hantu@x.id" } });
    expect(res.statusCode).toBe(400);
  });

  // specId lahir dari eskalasi, bukan dari ketikan: kartu tak boleh mengaku tertaut pada Spec
  // yang tak pernah menyetujuinya.
  it("MENGABAIKAN specId di body — bukan field yang bisa ditulis CRUD", async () => {
    const id = (await create({ title: "x" })).json().id;
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`, payload: { specId: "SPEC-1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().specId).toBeNull();
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "PATCH", url: "/api/tasks/hantu", payload: { title: "x" } })).statusCode).toBe(404);
  });
});

describe("DELETE /tasks/:id", () => {
  it("menghapus & menulis tombstone sync", async () => {
    const id = (await create({ title: "x" })).json().id;
    expect((await app.inject({ method: "DELETE", url: `/api/tasks/${id}` })).statusCode).toBe(204);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.syncTombstone.findFirst({ where: { entity: "task", recordId: id } })).not.toBeNull();
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/tasks/hantu" })).statusCode).toBe(404);
  });
});
