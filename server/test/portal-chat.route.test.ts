import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";
import { PORTAL_CHAT_DEFAULTS, TEKS_TETAP } from "@hanoman/shared";

const runTurn = vi.hoisted(() => vi.fn());
vi.mock("../src/services/portal-chat/turn", () => ({ runTurn }));

const app = buildApp();
const clean = async () => {
  await prisma.portalChatMessage.deleteMany(); await prisma.portalChatSession.deleteMany();
  await prisma.clientProjectAccess.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(async () => { runTurn.mockReset(); await clean(); });
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) =>
  (r.headers["set-cookie"] as string).split(";")[0]!;
const login = async (email: string, password: string) =>
  cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } }));

const setting = (over: object) => ({
  autoDefault: true, autoScaffold: true, notifyFail: true, portalChat: over });

async function seed(enabled = true) {
  await prisma.setting.create({ data: { id: 1,
    data: setting({ ...PORTAL_CHAT_DEFAULTS, enabled }) as object } });
  for (const id of ["p1", "p2"])
    await prisma.project.create({ data: { id, name: id.toUpperCase(), desc: "", kind: "existing" } });
  const c = await prisma.user.create({ data: {
    email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: c.id, projectId: "p1" } });
  const c2 = await prisma.user.create({ data: {
    email: "klien2@x.co", passwordHash: await hashPassword("password3"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: c2.id, projectId: "p1" } });
  return { cookie: await login("klien@x.co", "password2"),
           cookie2: await login("klien2@x.co", "password3") };
}

const jawab = (over: Record<string, unknown> = {}) => runTurn.mockResolvedValue({
  reply: "Fitur itu sedang dikerjakan.", blocked: false, reasons: [], raw: null,
  summary: "tanya jadwal", prd: null, escapeAttempts: 0, ...over });

const mulai = (cookie: string, type = "tanya", project = "p1") =>
  app.inject({ method: "POST", url: `/api/portal/projects/${project}/chat/sessions`,
    headers: { cookie }, payload: { type } });

describe("route chat portal klien (SPEC-854)", () => {
  it("mulai sesi lalu kirim pesan; keduanya terekam berurutan", async () => {
    const { cookie } = await seed(); jawab();
    const s = await mulai(cookie);
    expect(s.statusCode).toBe(201);
    const sid = s.json().id;
    const m = await app.inject({ method: "POST",
      url: `/api/portal/projects/p1/chat/sessions/${sid}/messages`,
      headers: { cookie }, payload: { text: "kapan selesai?" } });
    expect(m.statusCode).toBe(201);
    expect(m.json().text).toContain("sedang dikerjakan");

    const d = await app.inject({ method: "GET",
      url: `/api/portal/projects/p1/chat/sessions/${sid}`, headers: { cookie } });
    expect(d.json().messages.items.map((x: { role: string }) => x.role)).toEqual(["klien", "hanoman"]);
    expect(d.json().session.summary).toBe("tanya jadwal");
  });

  it("tipe sesi wajib salah satu dari dua", async () => {
    const { cookie } = await seed();
    expect((await mulai(cookie, "operator")).statusCode).toBe(400);
  });

  // Scope: project yang tak ditugaskan menjawab hal yang SAMA dengan project tak ada.
  it("project tetangga → 404, sama dengan project tak ada", async () => {
    const { cookie } = await seed();
    for (const id of ["p2", "tak-ada"])
      expect((await mulai(cookie, "tanya", id)).statusCode, id).toBe(404);
  });

  it("sesi akun klien lain → 404", async () => {
    const { cookie, cookie2 } = await seed(); jawab();
    const sid = (await mulai(cookie)).json().id;
    const r = await app.inject({ method: "GET",
      url: `/api/portal/projects/p1/chat/sessions/${sid}`, headers: { cookie: cookie2 } });
    expect(r.statusCode).toBe(404);
    const kirim = await app.inject({ method: "POST",
      url: `/api/portal/projects/p1/chat/sessions/${sid}/messages`,
      headers: { cookie: cookie2 }, payload: { text: "halo" } });
    expect(kirim.statusCode).toBe(404);
  });

  it("balasan yang diblokir tetap terekam dengan alasannya", async () => {
    const { cookie } = await seed();
    jawab({ reply: TEKS_TETAP.diblokir, blocked: true, reasons: ["project-lain"],
      raw: "Di P2 sudah selesai." });
    const sid = (await mulai(cookie)).json().id;
    await app.inject({ method: "POST",
      url: `/api/portal/projects/p1/chat/sessions/${sid}/messages`,
      headers: { cookie }, payload: { text: "gimana project lain?" } });
    const row = await prisma.portalChatMessage.findFirst({ where: { role: "hanoman" } });
    expect(row?.blocked).toBe(true);
    expect(row?.rawText).toContain("P2");
    expect(row?.blockReasons).toEqual(["project-lain"]);
  });

  it("chat mati di Settings → permukaan tak ada", async () => {
    const { cookie } = await seed(false);
    expect((await mulai(cookie)).statusCode).toBe(404);
  });

  it("pesan kosong ditolak", async () => {
    const { cookie } = await seed(); jawab();
    const sid = (await mulai(cookie)).json().id;
    const r = await app.inject({ method: "POST",
      url: `/api/portal/projects/p1/chat/sessions/${sid}/messages`,
      headers: { cookie }, payload: { text: "   " } });
    expect(r.statusCode).toBe(400);
  });

  it("daftar sesi berhalaman dengan amplop yang sama dengan daftar portal lain", async () => {
    const { cookie } = await seed(); jawab();
    for (let i = 0; i < 3; i++) await mulai(cookie);
    const r = await app.inject({ method: "GET",
      url: "/api/portal/projects/p1/chat/sessions?page=1&limit=2", headers: { cookie } });
    expect(r.json()).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(r.json().items).toHaveLength(2);
  });

  // Riwayat yang diteruskan ke runTurn adalah giliran SEBELUM pesan baru, urut, tanpa duplikat.
  it("riwayat diputar ulang urut ke mesin", async () => {
    const { cookie } = await seed(); jawab();
    const sid = (await mulai(cookie)).json().id;
    for (const t of ["pertama", "kedua"])
      await app.inject({ method: "POST",
        url: `/api/portal/projects/p1/chat/sessions/${sid}/messages`,
        headers: { cookie }, payload: { text: t } });
    const panggilanKedua = runTurn.mock.calls[1]![0] as {
      history: { role: string; text: string }[]; message: string };
    expect(panggilanKedua.message).toBe("kedua");
    expect(panggilanKedua.history.map((h) => h.text)).toEqual(["pertama", "Fitur itu sedang dikerjakan."]);
  });
});
