import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";

const app = buildApp();
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
const login = async (email: string, password: string) =>
  cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } }));

async function seedAdmin() {
  for (const id of ["p1", "p2"])
    await prisma.project.create({ data: { id, name: id.toUpperCase(), desc: "", kind: "existing" } });
  await prisma.user.create({ data: { email: "admin@x.co", passwordHash: await hashPassword("password1") } });
  return login("admin@x.co", "password1");
}

describe("kelola akun klien (SPEC-617)", () => {
  it("buat → daftar → ubah akses → nonaktifkan → hapus", async () => {
    const cookie = await seedAdmin();

    let r = await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: ["p1"] } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ email: "klien@x.co", disabled: false, projects: ["p1"] });
    expect(r.json()).not.toHaveProperty("passwordHash");
    const id = r.json().id;

    // Akun yang lahir dari sini SELALU berperan client — form admin tak boleh jadi jalan
    // membuat operator baru tanpa sadar.
    expect((await prisma.user.findUnique({ where: { id } }))!.role).toBe("client");

    r = await app.inject({ method: "GET", url: "/api/client-accounts", headers: { cookie } });
    expect(r.json().items).toHaveLength(1);
    expect(r.json().items[0]).toMatchObject({ email: "klien@x.co", projects: ["p1"] });

    r = await app.inject({ method: "PATCH", url: `/api/client-accounts/${id}`, headers: { cookie },
      payload: { projects: ["p1", "p2"] } });
    expect(r.json().projects).toEqual(["p1", "p2"]);

    // Nonaktif = akses dicabut sekarang juga, bukan saat token kedaluwarsa.
    const clientCookie = await login("klien@x.co", "password2");
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie: clientCookie } })).statusCode).toBe(200);
    r = await app.inject({ method: "PATCH", url: `/api/client-accounts/${id}`, headers: { cookie }, payload: { disabled: true } });
    expect(r.json().disabled).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie: clientCookie } })).statusCode).toBe(401);

    expect((await app.inject({ method: "DELETE", url: `/api/client-accounts/${id}`, headers: { cookie } })).statusCode).toBe(204);
    expect(await prisma.user.count({ where: { role: "client" } })).toBe(0);
    expect(await prisma.clientProjectAccess.count()).toBe(0);
  });

  it("reset password mencabut sesi lama", async () => {
    const cookie = await seedAdmin();
    const id = (await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: ["p1"] } })).json().id;
    const clientCookie = await login("klien@x.co", "password2");
    await app.inject({ method: "PATCH", url: `/api/client-accounts/${id}`, headers: { cookie }, payload: { password: "password9" } });
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie: clientCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "klien@x.co", password: "password9" } })).statusCode).toBe(200);
  });

  it("email dipakai → 409; project tak dikenal → 400", async () => {
    const cookie = await seedAdmin();
    await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: [] } });
    expect((await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password3", projects: [] } })).statusCode).toBe(409);
    const r = await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "lain@x.co", password: "password3", projects: ["hantu"] } });
    expect(r.statusCode).toBe(400);
    // Akun tak boleh tertinggal separuh jadi saat daftar project-nya ditolak.
    expect(await prisma.user.findUnique({ where: { email: "lain@x.co" } })).toBeNull();
  });

  // Akun operator tak boleh bisa disentuh lewat pintu ini — kalau bisa, "kelola akses klien"
  // diam-diam jadi permukaan mengubah kredensial admin.
  it("akun admin tak terlihat & tak bisa disentuh dari endpoint ini", async () => {
    const cookie = await seedAdmin();
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin" } });
    expect((await app.inject({ method: "GET", url: "/api/client-accounts", headers: { cookie } })).json().items).toEqual([]);
    expect((await app.inject({ method: "PATCH", url: `/api/client-accounts/${admin.id}`, headers: { cookie }, payload: { disabled: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/client-accounts/${admin.id}`, headers: { cookie } })).statusCode).toBe(404);
  });

  // Tanpa pagar ini, adanya satu akun klien membuat admin TERAKHIR bisa dihapus dan workspace
  // tersisa hanya bisa dimasuki akun yang tak boleh melihat apa pun.
  it("DELETE /auth/users menolak menghapus admin terakhir walau ada akun klien", async () => {
    const cookie = await seedAdmin();
    await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: [] } });
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin" } });
    const r = await app.inject({ method: "DELETE", url: `/api/auth/users/${admin.id}`, headers: { cookie } });
    expect(r.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { role: "admin" } })).toBe(1);
  });

  it("POST /auth/users tetap melahirkan admin", async () => {
    const cookie = await seedAdmin();
    const r = await app.inject({ method: "POST", url: "/api/auth/users", headers: { cookie },
      payload: { email: "op2@x.co", password: "password4" } });
    expect(r.json()).toMatchObject({ email: "op2@x.co", role: "admin" });
  });

  it("akun klien tak bisa menyentuh permukaan kelola akun sama sekali", async () => {
    const cookie = await seedAdmin();
    const id = (await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: ["p1"] } })).json().id;
    const clientCookie = await login("klien@x.co", "password2");
    for (const [method, url] of [
      ["GET", "/api/client-accounts"], ["POST", "/api/client-accounts"],
      ["PATCH", `/api/client-accounts/${id}`], ["DELETE", `/api/client-accounts/${id}`],
    ] as const)
      expect((await app.inject({ method, url, headers: { cookie: clientCookie }, payload: {} })).statusCode,
        `${method} ${url}`).toBe(403);
  });
});
