// SPEC-617 · ADR-0110 · kelola akun klien (cookie-only, admin). Hanya menyentuh baris
// ber-`role="client"` — akun operator tetap dikelola /auth/users, jadi pintu ini tak pernah bisa
// jadi jalan memutar mengubah kredensial admin.
import type { FastifyInstance } from "fastify";
import { zCreateClientAccount, zUpdateClientAccount, type ClientAccountView } from "@hanoman/shared";
import { prisma } from "../db";
import { hashPassword, deleteUserSessions } from "../services/auth";

type Row = { id: string; email: string; disabled: boolean; createdAt: Date;
  projectAccess: { projectId: string }[] };

const view = (u: Row): ClientAccountView => ({
  id: u.id, email: u.email, disabled: u.disabled, createdAt: u.createdAt.toISOString(),
  projects: u.projectAccess.map((a) => a.projectId).sort(),
});

const load = (id: string) => prisma.user.findFirst({
  where: { id, role: "client" },
  include: { projectAccess: { select: { projectId: true } } },
});

/** Ganti seluruh daftar akses jadi `projects`. Project tak dikenal → null (pemanggil → 400). */
async function setAccess(userId: string, projects: string[]): Promise<string[] | null> {
  const ids = [...new Set(projects)];
  const known = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (known.length !== ids.length) return null;
  await prisma.clientProjectAccess.deleteMany({ where: { userId, projectId: { notIn: ids } } });
  for (const projectId of ids)
    await prisma.clientProjectAccess.upsert({
      where: { userId_projectId: { userId, projectId } },
      update: {}, create: { userId, projectId },
    });
  return ids;
}

export default async function (app: FastifyInstance) {
  app.get("/client-accounts", async () => {
    const rows = await prisma.user.findMany({
      where: { role: "client" }, orderBy: { createdAt: "asc" },
      include: { projectAccess: { select: { projectId: true } } },
    });
    return { items: rows.map(view) };
  });

  app.post("/client-accounts", async (req, reply) => {
    const p = zCreateClientAccount.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (await prisma.user.findUnique({ where: { email: p.data.email } }))
      return reply.code(409).send({ error: "email dipakai" });
    const user = await prisma.user.create({
      data: { email: p.data.email, passwordHash: await hashPassword(p.data.password), role: "client" },
    });
    // Daftar project ditolak → akun tak boleh tertinggal separuh jadi.
    if ((await setAccess(user.id, p.data.projects)) === null) {
      await prisma.user.delete({ where: { id: user.id } });
      return reply.code(400).send({ error: "ada project yang tidak dikenal" });
    }
    return reply.code(201).send(view((await load(user.id))!));
  });

  app.patch("/client-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zUpdateClientAccount.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (!(await load(id))) return reply.code(404).send({ error: "not found" });

    if (p.data.projects && (await setAccess(id, p.data.projects)) === null)
      return reply.code(400).send({ error: "ada project yang tidak dikenal" });
    if (p.data.disabled !== undefined)
      await prisma.user.update({ where: { id }, data: { disabled: p.data.disabled } });
    if (p.data.password)
      await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(p.data.password) } });
    // Nonaktif & reset password harus berlaku SEKARANG: sesi yang sudah terbit hidup 7 hari.
    if (p.data.disabled || p.data.password) await deleteUserSessions(id);
    return view((await load(id))!);
  });

  app.delete("/client-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await load(id))) return reply.code(404).send({ error: "not found" });
    await prisma.user.delete({ where: { id } });   // sesi & akses ikut cascade
    return reply.code(204).send();
  });
}
