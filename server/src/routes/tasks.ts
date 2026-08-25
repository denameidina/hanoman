import type { FastifyInstance } from "fastify";
import { zCreateTask, zPatchTask } from "@hanoman/shared";
import { prisma } from "../db";
import { notifySynced } from "../services/sync-notify";
import { deleteSynced } from "../services/sync-delete";
import { buildTasksPage, taskView } from "../services/tasks-list";

// SPEC-945 · ADR-0150 · CRUD kartu kerja MANUSIA. Bukan backlog: `status` di sini milik manusia dan
// bebas dipindah, sementara `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024).
//
// Tak ada entri di `capabilityForRoute` maupun `clientRouteAllowed` — keduanya deny-by-default,
// jadi route ini tertutup bagi agent token DAN role `client` tanpa satu baris pun (ADR-0110).

/** Rujukan tanpa pesan yang bisa dibaca: P2003 Prisma menyebut nama constraint, bukan nilainya. */
async function refProblem(
  projectId: string | null | undefined, memberId: string | null | undefined,
): Promise<{ error: string; projectId?: string; memberId?: string } | null> {
  if (projectId && !(await prisma.project.findUnique({ where: { id: projectId } })))
    return { error: "project tak ditemukan", projectId };
  if (memberId && !(await prisma.member.findUnique({ where: { id: memberId } })))
    return { error: "anggota tak ditemukan", memberId };
  return null;
}

const dateOf = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

export default async function (app: FastifyInstance) {
  app.get("/tasks", async (req) => {
    const { projectId, status, memberId, page, limit } = req.query as Record<string, string | undefined>;
    // SPEC-908 · satu definisi dipakai bersama topik siar `tasks` (services/tasks-list.ts).
    return buildTasksPage({
      projectId, status, memberId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  });

  app.post("/tasks", async (req, reply) => {
    const parsed = zCreateTask.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    const bad = await refProblem(p.projectId, p.memberId);
    if (bad) return reply.code(400).send(bad);

    const row = await prisma.task.create({ data: {
      title: p.title, detail: p.detail ?? null, projectId: p.projectId ?? null,
      status: p.status, priority: p.priority, memberId: p.memberId ?? null,
      startDate: dateOf(p.startDate) ?? null, dueDate: dateOf(p.dueDate) ?? null,
      order: p.order ?? 0,
    } });
    await notifySynced("task", row.id);
    // Kartu baru tak pernah punya tautan backlog: `specId` lahir dari eskalasi.
    return reply.code(201).send(taskView(row, null));
  });

  app.patch("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPatchTask.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    if (!(await prisma.task.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "not found" });

    const bad = await refProblem(p.projectId, p.memberId);
    if (bad) return reply.code(400).send(bad);

    // Hanya field yang BENAR-BENAR dikirim yang ditulis: `undefined` di Prisma berarti "jangan
    // sentuh", sementara `null` berarti "kosongkan" — dan keduanya harus tetap berbeda supaya
    // PATCH {status} tak diam-diam menghapus tanggal yang sudah diisi.
    const row = await prisma.task.update({ where: { id }, data: {
      title: p.title, detail: p.detail, projectId: p.projectId,
      status: p.status, priority: p.priority, memberId: p.memberId,
      startDate: dateOf(p.startDate), dueDate: dateOf(p.dueDate), order: p.order,
    } });
    await notifySynced("task", id);
    const spec = row.specId
      ? await prisma.spec.findUnique({
          where: { id: row.specId }, select: { id: true, stage: true, priority: true },
        })
      : null;
    return taskView(row, spec);
  });

  app.delete("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deleteSynced("task", id))) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });
}
