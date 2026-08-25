import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => { await resetDb(); });

const create = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/members", payload });

describe("POST /members", () => {
  it("membuat anggota dengan id DETERMINISTIK dari email ternormalisasi", async () => {
    const res = await create({ name: "Dena", email: "  Dena@Nafanesia.ID " });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("dena@nafanesia.id");
    expect(res.json().email).toBe("Dena@Nafanesia.ID");   // apa yang diketik operator
    expect(res.json().active).toBe(true);
    expect(res.json().role).toBeNull();
  });

  // Inti id deterministik: dua ejaan yang sama TIDAK boleh melahirkan dua baris.
  it("menolak 409 untuk email yang sama walau beda kapitalisasi", async () => {
    await create({ name: "Dena", email: "dena@x.id" });
    const res = await create({ name: "Dena Lagi", email: "DENA@X.ID" });
    expect(res.statusCode).toBe(409);
    expect(res.json().id).toBe("dena@x.id");
    expect(await prisma.member.count()).toBe(1);
  });

  it("menolak 400 email cacat & nama kosong", async () => {
    expect((await create({ name: "D", email: "bukan" })).statusCode).toBe(400);
    expect((await create({ name: " ", email: "a@b.id" })).statusCode).toBe(400);
  });

  it("mencatat version-stamp sync (baris menyeberang)", async () => {
    await create({ name: "Dena", email: "dena@x.id" });
    const log = await prisma.syncLog.findFirst({ where: { entity: "member", recordId: "dena@x.id" } });
    expect(log).not.toBeNull();
  });
});

describe("GET /members", () => {
  beforeEach(async () => {
    await create({ name: "Zain", email: "z@x.id" });
    await create({ name: "Adi", email: "a@x.id" });
    await create({ name: "Budi", email: "b@x.id" });
    await app.inject({ method: "PATCH", url: "/api/members/z@x.id", payload: { active: false } });
  });

  it("aktif dulu, lalu nama asc", async () => {
    const res = await app.inject({ method: "GET", url: "/api/members" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((m: { name: string }) => m.name)).toEqual(["Adi", "Budi", "Zain"]);
  });

  it("beramplop Paginated; tanpa limit → seluruh item satu halaman (ADR-0107)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/members" });
    expect(res.json()).toMatchObject({ total: 3, page: 1, pageSize: 3 });
  });

  it("?active=true menyaring yang nonaktif", async () => {
    const res = await app.inject({ method: "GET", url: "/api/members?active=true" });
    expect(res.json().items.map((m: { name: string }) => m.name)).toEqual(["Adi", "Budi"]);
  });
});

describe("PATCH /members/:id", () => {
  beforeEach(async () => { await create({ name: "Dena", email: "dena@x.id" }); });

  it("mengubah nama, role, active", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/members/dena@x.id",
      payload: { name: "Dena M", role: "desainer", active: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Dena M", role: "desainer", active: false });
  });

  // ADR-0094 keputusan 2 · ditolak EKSPLISIT, bukan diabaikan senyap: "ganti email diterima lalu
  // tak terjadi apa-apa" adalah bug yang tak terlihat operator.
  it("MENOLAK 400 bila body membawa email", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/members/dena@x.id",
      payload: { name: "X", email: "baru@x.id" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/email/i);
    expect((await prisma.member.findUnique({ where: { id: "dena@x.id" } }))!.name).toBe("Dena");
  });

  // Badan responsnya ikut diperiksa: 404 telanjang juga muncul di pohon yang BELUM punya route
  // ini, dan `{"error":"Not Found"}` bawaan Fastify tak sama dengan `{"error":"not found"}` milik
  // handler. Tanpa assertion ini, test lulus justru saat route-nya hilang.
  it("404 untuk id yang tak ada — dari handler, bukan dari router", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/members/hantu@x.id", payload: { name: "X" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found" });
  });
});

describe("DELETE /members/:id", () => {
  it("task-nya jatuh ke belum-ditugaskan, tidak ikut terhapus (SetNull)", async () => {
    await create({ name: "Dena", email: "dena@x.id" });
    await prisma.task.create({ data: { id: "t1", title: "Nego", status: "doing", memberId: "dena@x.id" } });
    const res = await app.inject({ method: "DELETE", url: "/api/members/dena@x.id" });
    expect(res.statusCode).toBe(204);
    const t = await prisma.task.findUnique({ where: { id: "t1" } });
    expect(t).not.toBeNull();
    expect(t!.memberId).toBeNull();
  });

  it("404 untuk id yang tak ada — dari handler, bukan dari router", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/members/hantu@x.id" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found" });
  });
});
