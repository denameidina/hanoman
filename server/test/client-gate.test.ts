import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";

const app = buildApp();
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) =>
  (r.headers["set-cookie"] as string).split(";")[0];

async function login(email: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  expect(r.statusCode).toBe(200);
  return cookieOf(r);
}

async function seed() {
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
  await prisma.user.create({ data: { email: "admin@x.co", passwordHash: await hashPassword("password1") } });
  const c = await prisma.user.create({
    data: { email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: c.id, projectId: "p1" } });
  return { adminCookie: await login("admin@x.co", "password1"), clientCookie: await login("klien@x.co", "password2") };
}

describe("gerbang role client (SPEC-617)", () => {
  it("klien ditolak 403 di seluruh route tulis", async () => {
    const { clientCookie: cookie } = await seed();
    const writes: [string, string, unknown?][] = [
      ["POST", "/api/specs", { project: "p1", title: "x", source: "brief", payload: {} }],
      ["PATCH", "/api/specs/SPEC-1", { stage: "done" }],
      ["DELETE", "/api/specs/SPEC-1"],
      ["POST", "/api/terminal/sessions", { project: "p1" }],
      ["POST", "/api/projects", { id: "z", name: "Z", desc: "", kind: "existing" }],
      ["PUT", "/api/settings", {}],
      ["POST", "/api/tickets/t1/accept", {}],
      ["POST", "/api/lead/decisions", {}],
    ];
    for (const [method, url, payload] of writes) {
      const r = await app.inject({ method: method as "POST", url, headers: { cookie }, payload: payload as object });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("klien ditolak 403 di route baca internal", async () => {
    const { clientCookie: cookie } = await seed();
    for (const url of ["/api/specs", "/api/projects", "/api/tickets", "/api/settings",
      "/api/vps", "/api/notifications", "/api/agent-tokens", "/api/session-results",
      "/api/scheduler/config", "/api/webhooks", "/api/auth/users"]) {
      const r = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(r.statusCode, url).toBe(403);
      expect(r.json()).toMatchObject({ error: expect.any(String) });
    }
  });

  it("admin tetap normal di route yang sama", async () => {
    const { adminCookie: cookie } = await seed();
    for (const url of ["/api/specs", "/api/projects", "/api/tickets", "/api/notifications"])
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode, url).toBe(200);
  });

  it("klien boleh keluar dan mengganti password sendiri", async () => {
    const { clientCookie: cookie } = await seed();
    expect((await app.inject({
      method: "POST", url: "/api/auth/change-password", headers: { cookie },
      payload: { currentPassword: "password2", newPassword: "password9" } })).statusCode).toBe(200);
  });

  it("/api/auth/status tetap menjawab & membawa role", async () => {
    const { clientCookie: cookie } = await seed();
    const r = await app.inject({ method: "GET", url: "/api/auth/status", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ email: "klien@x.co", role: "client" });
  });

  // Hanya menutup login berarti cookie yang sudah terbit hidup sampai 7 hari — pencabutan
  // yang tak mencabut. Dibuktikan lewat route yang MEMANG ADA: di Fastify, hook `onRequest`
  // ber-scope tak pernah berjalan untuk path yang tak punya route (404 lahir dari
  // not-found handler), jadi path karangan tak bisa membuktikan apa pun tentang gerbang.
  it("menonaktifkan akun mematikan sesi yang SUDAH terbit, bukan cuma login berikutnya", async () => {
    const { clientCookie: cookie } = await seed();
    const status = () => app.inject({ method: "GET", url: "/api/auth/status", headers: { cookie } });
    expect((await status()).json().user).toMatchObject({ email: "klien@x.co" });

    await prisma.user.updateMany({ where: { email: "klien@x.co" }, data: { disabled: true } });

    expect((await status()).json().user).toBeNull();
    expect((await app.inject({ method: "POST", url: "/api/auth/change-password", headers: { cookie },
      payload: { currentPassword: "password2", newPassword: "password9" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "klien@x.co", password: "password2" } })).statusCode).toBe(401);
  });
});
