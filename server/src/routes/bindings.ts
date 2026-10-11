import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { getBinding, setBinding, clearBinding } from "../services/local-binding";
import { CheckoutError, cloneProjectCheckout } from "../services/project-checkout";

// SPEC-213 · ADR-0043 · bind/clone project server ke checkout lokal (per-device, LOCAL-only).
const zBind = z.object({ repoDir: z.string().min(1) });
const zClone = z.object({ dir: z.string().min(1) });

export default async function (app: FastifyInstance) {
  app.get("/projects/:id/binding", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    return { repoDir: await getBinding(id) };
  });

  app.put("/projects/:id/binding", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zBind.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    await setBinding(id, p.data.repoDir);
    return { repoDir: p.data.repoDir };
  });

  // SPEC-217 · hapus override per-mesin → path efektif jatuh kembali ke Project.repoDir.
  app.delete("/projects/:id/binding", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.project.findUnique({ where: { id } }))) return reply.code(404).send({ error: "not found" });
    await clearBinding(id);
    return reply.code(204).send();
  });

  app.post("/projects/:id/clone", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zClone.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    // ADR-0203 · jalur yang sama dengan auto-clone saat launch: asinkron, token GitHub, satu clone
    // per project, dan folder yang sudah terisi hal lain tidak pernah ditimpa.
    try {
      const repoDir = await cloneProjectCheckout(id, { dir: p.data.dir });
      return reply.code(201).send({ repoDir });
    } catch (e) {
      if (!(e instanceof CheckoutError)) throw e;
      if (e.kind === "not-found") return reply.code(404).send({ error: "not found" });
      if (e.kind === "no-remote") return reply.code(409).send({ error: "project tidak punya gitRemote untuk clone" });
      return reply.code(409).send({ error: e.message, ...(e.detail ? { detail: e.detail } : {}) });
    }
  });
}
