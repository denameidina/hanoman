import type { FastifyInstance, FastifyReply } from "fastify";
import { zLogin, zSignup, zChangePassword, type UserView } from "@hanoman/shared";
import { prisma } from "../db";
import * as auth from "../services/auth";

const view = (u: { id: string; email: string; role: string; createdAt: Date }): UserView =>
  ({ id: u.id, email: u.email, role: u.role as UserView["role"], createdAt: u.createdAt.toISOString() });

async function issue(reply: FastifyReply, userId: string) {
  const token = await auth.createSession(userId);
  reply.setCookie(auth.COOKIE_NAME, token, auth.cookieOpts());
}

export default async function (app: FastifyInstance) {
  app.get("/auth/status", async (req) => {
    const needsSetup = (await prisma.user.count()) === 0;
    return { needsSetup, user: req.user ?? null };
  });

  app.post("/auth/setup", async (req, reply) => {
    if ((await prisma.user.count()) > 0) return reply.code(409).send({ error: "already set up" });
    const p = zSignup.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const user = await prisma.user.create({
      data: { email: p.data.email, passwordHash: await auth.hashPassword(p.data.password) },
    });
    await issue(reply, user.id);
    return { user: view(user) };
  });

  app.post("/auth/login", async (req, reply) => {
    if (auth.loginThrottle(req.ip).blocked) return reply.code(429).send({ error: "too many attempts" });
    const p = zLogin.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const user = await prisma.user.findUnique({ where: { email: p.data.email } });
    // SPEC-617 · akun nonaktif ditolak dengan pesan yang SAMA seperti password salah —
    // membedakannya membocorkan keberadaan akun (standar keamanan: error selalu generic).
    if (!user || user.disabled || !(await auth.verifyPassword(p.data.password, user.passwordHash))) {
      auth.noteLoginFail(req.ip);
      return reply.code(401).send({ error: "email atau password salah" });
    }
    auth.clearLoginFails(req.ip);
    await issue(reply, user.id);
    return { user: view(user) };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies?.[auth.COOKIE_NAME];
    if (token) await auth.deleteSession(token);
    reply.clearCookie(auth.COOKIE_NAME, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/auth/users", async () =>
    (await prisma.user.findMany({ orderBy: { createdAt: "asc" } })).map(view));

  // invite: set password langsung, tanpa email invitation (brief SPEC-169).
  app.post("/auth/users", async (req, reply) => {
    const p = zSignup.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (await prisma.user.findUnique({ where: { email: p.data.email } }))
      return reply.code(409).send({ error: "email dipakai" });
    const user = await prisma.user.create({
      data: { email: p.data.email, passwordHash: await auth.hashPassword(p.data.password) },
    });
    return view(user);
  });

  app.delete<{ Params: { id: string } }>("/auth/users/:id", async (req, reply) => {
    if ((await prisma.user.count()) <= 1) return reply.code(400).send({ error: "tak bisa hapus user terakhir" });
    await prisma.user.deleteMany({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  app.post("/auth/change-password", async (req, reply) => {
    const p = zChangePassword.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const me = req.user!;
    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user || !(await auth.verifyPassword(p.data.currentPassword, user.passwordHash)))
      return reply.code(400).send({ error: "password lama salah" });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await auth.hashPassword(p.data.newPassword) },
    });
    await auth.deleteUserSessions(user.id); // cabut semua sesi lama (termasuk yang sekarang)
    await issue(reply, user.id);            // re-issue sesi sekarang → perangkat lain ter-logout
    return { user: view(user) };
  });
}
