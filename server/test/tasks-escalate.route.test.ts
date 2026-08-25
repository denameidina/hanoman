import { describe, it, expect, beforeEach } from "vitest";
import { payloadMatchesSource } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject } from "./factory";
import { COOKIE_NAME, createSession } from "../src/services/auth";

const app = buildApp({ requireAuth: false });

const makeTask = (over: Record<string, unknown> = {}) =>
  prisma.task.create({ data: {
    id: "t1", title: "Perbaiki halaman harga", detail: "Harga paket pro salah di mobile",
    status: "doing", priority: "tinggi", projectId: "p1", ...over } });

const escalate = (id: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: `/api/tasks/${id}/escalate`, payload });

const unlink = (id: string) =>
  app.inject({ method: "DELETE", url: `/api/tasks/${id}/escalate` });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeProject({ id: "p2" });
  await prisma.member.create({ data: { id: "a@x.id", name: "Adi", email: "a@x.id" } });
});

describe("POST /tasks/:id/escalate", () => {
  it("membuat Spec dari kartu dan mengisi task.specId", async () => {
    await makeTask();
    const res = await escalate("t1", { source: "brief", priority: "tinggi" });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.created).toBe(true);
    expect(b.spec.id).toMatch(/^SPEC-\d+$/);
    expect(b.spec).toMatchObject({
      projectId: "p1", title: "Perbaiki halaman harga",
      source: "brief", stage: "brainstorming", priority: "tinggi",
    });
    expect(b.task.specId).toBe(b.spec.id);
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.specId).toBe(b.spec.id);
  });

  // Cermin stage dihitung saat baca (ADR-0150 keputusan 4) — jawaban POST sudah membawanya.
  it("mengembalikan TaskView dengan cermin stage terisi", async () => {
    await makeTask();
    const b = (await escalate("t1")).json();
    expect(b.task.spec).toMatchObject({ id: b.spec.id, stage: "brainstorming" });
  });

  it("idempoten: panggilan kedua 200 created:false, Spec tak bertambah", async () => {
    await makeTask();
    const first = (await escalate("t1")).json();
    const res = await escalate("t1", { source: "qa" });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
    expect(res.json().spec.id).toBe(first.spec.id);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("menolak 400 kartu tanpa project, menyebut sebabnya", async () => {
    await makeTask({ projectId: null });
    const res = await escalate("t1");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/project/i);
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.specId).toBeNull();
  });

  it("kartu tanpa project + projectId di body: Spec lahir DAN kartu ikut pindah", async () => {
    await makeTask({ projectId: null });
    const res = await escalate("t1", { projectId: "p2" });
    expect(res.statusCode).toBe(201);
    expect(res.json().spec.projectId).toBe("p2");
    expect(res.json().task.projectId).toBe("p2");
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.projectId).toBe("p2");
  });

  it("menolak 400 bila body menyebut project LAIN dari milik kartu", async () => {
    await makeTask();
    const res = await escalate("t1", { projectId: "p2" });
    expect(res.statusCode).toBe(400);
    expect(res.json().projectId).toBe("p1");
    expect(await prisma.spec.count()).toBe(0);
  });

  it("menerima body yang menyebut project yang SAMA", async () => {
    await makeTask();
    expect((await escalate("t1", { projectId: "p1" })).statusCode).toBe(201);
  });

  it("menolak 400 projectId yang tak ada, menyebut nilainya", async () => {
    await makeTask({ projectId: null });
    const res = await escalate("t1", { projectId: "hantu" });
    expect(res.statusCode).toBe(400);
    expect(res.json().projectId).toBe("hantu");
  });

  it("menolak 400 source di luar tiga", async () => {
    await makeTask();
    expect((await escalate("t1", { source: "goal" })).statusCode).toBe(400);
  });

  it("404 untuk kartu yang tak ada", async () => {
    expect((await escalate("hantu")).statusCode).toBe(404);
  });
});

// Bentuk payload WAJIB cocok source: `zCreateSpec.superRefine` menuntutnya (SPEC-197/546), dan
// baris ini akan lewat `zSpec`/`zPatchSpec`/validasi sync kelak.
describe("POST /tasks/:id/escalate · bentuk payload", () => {
  it("brief & audit memakai bentuk brief, lengkap dengan priority", async () => {
    for (const source of ["brief", "audit"]) {
      await prisma.task.deleteMany({});
      await prisma.spec.deleteMany({});
      await makeTask();
      const spec = (await escalate("t1", { source, priority: "rendah" })).json().spec;
      expect(payloadMatchesSource(source, spec.payload)).toBe(true);
      expect(spec.payload.priority).toBe("rendah");
      expect(spec.payload.context).toContain("Harga paket pro salah di mobile");
    }
  });

  it("qa memakai bentuk qa, severity DITURUNKAN dari prioritas", async () => {
    await makeTask();
    const spec = (await escalate("t1", { source: "qa", priority: "rendah" })).json().spec;
    expect(payloadMatchesSource("qa", spec.payload)).toBe(true);
    expect(spec.payload.severity).toBe("minor");
    expect(spec.payload.actual).toContain("Harga paket pro salah di mobile");
  });

  it("severity major untuk prioritas tinggi", async () => {
    await makeTask();
    const spec = (await escalate("t1", { source: "qa", priority: "tinggi" })).json().spec;
    expect(spec.payload.severity).toBe("major");
  });

  // Pembungkus UNTRUSTED ada karena tiket datang dari PUBLIK. Kartu tim ditulis anggota tim di
  // dashboard ber-auth; memperlakukannya sebagai racun melatih agen mengabaikan konteks yang
  // justru sengaja diberikan.
  it("TIDAK membungkus teks kartu dengan penanda untrusted", async () => {
    await makeTask();
    const spec = (await escalate("t1")).json().spec;
    expect(JSON.stringify(spec.payload)).not.toContain("UNTRUSTED");
  });

  it("membawa konteks kartu yang tak dipunyai Spec: kolom, assignee, jadwal", async () => {
    await makeTask({ memberId: "a@x.id", dueDate: new Date("2026-09-08T00:00:00.000Z") });
    const spec = (await escalate("t1")).json().spec;
    expect(spec.payload.context).toContain("Adi");
    expect(spec.payload.context).toContain("doing");
    expect(spec.payload.context).toContain("2026-09-08");
  });

  // Tanpa principal tak ada yang menyetujui peluncuran — dan itu HARUS terlihat sebagai null,
  // bukan sebagai stempel karangan. Jalur ber-principal diuji di describe berikutnya.
  it("tanpa principal: launchApprovedBy null, author jatuh ke system", async () => {
    await makeTask();
    const id = (await escalate("t1")).json().spec.id;
    const spec = await prisma.spec.findUnique({ where: { id } });
    expect(spec!.launchApprovedBy).toBeNull();
    expect(spec!.launchApprovedAt).toBeNull();
    expect(spec!.author).toBe("Tim · system");
  });

  it("mencatat version-stamp sync untuk spec DAN task", async () => {
    await makeTask();
    const id = (await escalate("t1")).json().spec.id;
    expect(await prisma.syncLog.findFirst({ where: { entity: "spec", recordId: id } })).not.toBeNull();
    expect(await prisma.syncLog.findFirst({ where: { entity: "task", recordId: "t1" } })).not.toBeNull();
  });
});

// `specId` terisi tanpa Spec = tautan putus (ADR-0150 keputusan 5). API tak boleh punya keadaan
// buntu: eskalasi ulang menyembuhkannya.
describe("POST /tasks/:id/escalate · tautan putus", () => {
  it("membuat Spec baru saat specId menunjuk Spec yang sudah terhapus", async () => {
    await makeTask({ specId: "SPEC-hantu" });
    const before = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(before.json().items[0]).toMatchObject({ specId: "SPEC-hantu", spec: null });

    const res = await escalate("t1");
    expect(res.statusCode).toBe(201);
    expect(res.json().created).toBe(true);
    expect(res.json().task.specId).not.toBe("SPEC-hantu");

    const after = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(after.json().items[0].spec).toMatchObject({ stage: "brainstorming" });
  });
});

describe("DELETE /tasks/:id/escalate", () => {
  it("mengosongkan specId dan mengembalikan TaskView", async () => {
    await makeTask();
    await escalate("t1");
    const res = await unlink("t1");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "t1", specId: null, spec: null });
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.specId).toBeNull();
  });

  // Non-destruktif, cermin POST /tickets/:id/unlink: Spec dibiarkan dan dihapus manual dari
  // Backlog bila memang salah.
  it("TIDAK menghapus Spec-nya", async () => {
    await makeTask();
    const id = (await escalate("t1")).json().spec.id;
    await unlink("t1");
    expect(await prisma.spec.findUnique({ where: { id } })).not.toBeNull();
  });

  it("idempoten: kartu yang belum tertaut menjawab 200, bukan 404", async () => {
    await makeTask();
    expect((await unlink("t1")).statusCode).toBe(200);
    await escalate("t1");
    expect((await unlink("t1")).statusCode).toBe(200);
    expect((await unlink("t1")).statusCode).toBe(200);
  });

  it("melepas tautan PUTUS juga", async () => {
    await makeTask({ specId: "SPEC-hantu" });
    expect((await unlink("t1")).json().specId).toBeNull();
  });

  it("mencatat version-stamp sync", async () => {
    await makeTask();
    await escalate("t1");
    await prisma.syncLog.deleteMany({ where: { entity: "task" } });
    await unlink("t1");
    expect(await prisma.syncLog.findFirst({ where: { entity: "task", recordId: "t1" } })).not.toBeNull();
  });

  it("404 untuk kartu yang tak ada", async () => {
    expect((await unlink("hantu")).statusCode).toBe(404);
  });

  // Kartu tetap DI PAPAN sesudah lepas tautan — eskalasi tak pernah memindahkannya keluar.
  it("kartu tetap ada di papan", async () => {
    await makeTask();
    await escalate("t1");
    await unlink("t1");
    const list = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({ id: "t1", status: "doing" });
  });
});

// SPEC-761 · principal yang menekan eskalasi adalah principal yang menyetujui peluncurannya —
// cermin POST /tickets/:id/accept. Butuh app ber-auth: `requireAuth: false` tak pernah memasang
// hook yang mengisi `req.user`, jadi harness papan di atas tak bisa membuktikannya.
describe("POST /tasks/:id/escalate · principal", () => {
  const authed = buildApp({ requireAuth: true });

  it("mengisi launchApprovedBy & author dari operator yang login", async () => {
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});
    const user = await prisma.user.create({
      data: { id: "u1", email: "dena@x.id", passwordHash: "x", role: "admin" } });
    const token = await createSession(user.id);
    await makeTask();

    const res = await authed.inject({
      method: "POST", url: "/api/tasks/t1/escalate",
      cookies: { [COOKIE_NAME]: token }, payload: { source: "brief", priority: "sedang" },
    });
    expect(res.statusCode).toBe(201);
    const spec = await prisma.spec.findUnique({ where: { id: res.json().spec.id } });
    expect(spec!.launchApprovedBy).toBe("user:dena@x.id");
    expect(spec!.launchApprovedAt).not.toBeNull();
    expect(spec!.author).toBe("Tim · dena@x.id");
  });
});
