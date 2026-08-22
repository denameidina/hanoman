import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { zLogin, zSetup, zSignup, zChangePassword, type UserView } from "@hanoman/shared";
import { prisma } from "../db";
import * as auth from "../services/auth";
import { BootstrapError, consumeSetupToken, ensureSetupToken, verifySetupToken } from "../services/bootstrap";
import { BoundedRateLimiter } from "../services/bounded-rate-limit";

const BOOTSTRAP_USER_ID = "bootstrap-admin";

const view = (u: { id: string; email: string; role: string; createdAt: Date }): UserView =>
  ({ id: u.id, email: u.email, role: u.role as UserView["role"], createdAt: u.createdAt.toISOString() });

async function issue(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = await auth.createSession(userId);
  reply.setCookie(auth.COOKIE_NAME, token, auth.cookieOpts(req));
}

export default async function (app: FastifyInstance, opts: { bootstrapRequired?: boolean; home?: string }) {
  const setupAttempts = new BoundedRateLimiter({ windowMs: 60_000, limit: 10, maxKeys: 4_096 });
  app.get("/auth/status", async (req) => {
    const needsSetup = (await prisma.user.count()) === 0;
    let setupTokenPath: string | undefined;
    if (needsSetup && opts.bootstrapRequired && opts.home)
      setupTokenPath = (await ensureSetupToken(opts.home)).path;
    return { needsSetup, user: req.user ?? null, setupTokenRequired: !!opts.bootstrapRequired, setupTokenPath };
  });

  app.post("/auth/setup", async (req, reply) => {
    if ((await prisma.user.count()) > 0) return reply.code(409).send({ error: "already set up" });
    if (setupAttempts.hit(req.ip).blocked) return reply.code(429).send({ error: "too many attempts" });
    const p = (opts.bootstrapRequired ? zSetup : zSignup).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (opts.bootstrapRequired) {
      const setupToken = "setupToken" in p.data && typeof p.data.setupToken === "string" ? p.data.setupToken : "";
      try { await verifySetupToken(setupToken, opts.home!); }
      catch (error) {
        if (error instanceof BootstrapError) return reply.code(403).send({ error: "invalid setup proof" });
        throw error;
      }
    }
    let user;
    try {
      user = await prisma.user.create({
        data: { id: BOOTSTRAP_USER_ID, email: p.data.email, passwordHash: await auth.hashPassword(p.data.password), role: "admin" },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return reply.code(409).send({ error: "already set up" });
      throw error;
    }
    if (opts.bootstrapRequired) await consumeSetupToken(opts.home!);
    setupAttempts.clear(req.ip);
    await issue(req, reply, user.id);
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
    await issue(req, reply, user.id);
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
      // SPEC-617 · pintu ini melahirkan OPERATOR. Akun klien punya pintunya sendiri
      // (/api/client-accounts) supaya "undang rekan" dan "beri akses klien" tak pernah tertukar.
      data: { email: p.data.email, passwordHash: await auth.hashPassword(p.data.password), role: "admin" },
    });
    return view(user);
  });

  app.delete<{ Params: { id: string } }>("/auth/users/:id", async (req, reply) => {
    // SPEC-617 · yang dijaga adalah admin TERAKHIR, bukan user terakhir: sejak ada akun klien,
    // "user terakhir" bisa terpenuhi oleh akun yang justru tak boleh melihat apa pun — dan
    // workspace-nya terkunci tanpa satu pun operator.
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return reply.code(204).send();
    if (target.role === "admin" && (await prisma.user.count({ where: { role: "admin" } })) <= 1)
      return reply.code(400).send({ error: "tak bisa hapus admin terakhir" });
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
    await issue(req, reply, user.id);            // re-issue sesi sekarang → perangkat lain ter-logout
    return { user: view(user) };
  });
}
