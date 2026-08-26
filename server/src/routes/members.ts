import type { FastifyInstance } from "fastify";
import type { Member } from "@prisma/client";
import { zCreateMember, zPatchMember, memberId, type MemberView } from "@hanoman/shared";
import { prisma } from "../db";
import { notifySynced } from "../services/sync-notify";
import { deleteSynced } from "../services/sync-delete";
import { paginate } from "../services/paginate";

// SPEC-945 · ADR-0150 · direktori orang untuk papan tim. GLOBAL, bukan per project: Task boleh
// tanpa project, jadi direktori orang tak bisa digantung pada project.
//
// ADR-0157 · satu domain capability dengan `/tasks` (`team:read`/`team:write`): kartu tanpa nama
// penanggung jawab hanyalah judul, jadi memberi salah satunya tanpa yang lain menghasilkan agen
// yang membaca `memberId` tapi tak bisa menyebut siapa orangnya. Tetap di luar `clientRouteAllowed`
// — direktori orang bukan permukaan klien.

const view = (m: Member): MemberView => ({
  id: m.id, name: m.name, email: m.email, role: m.role, active: m.active,
  createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  app.get("/members", async (req) => {
    const { active, page, limit } = req.query as Record<string, string | undefined>;
    const rows = await prisma.member.findMany({
      where: active === "true" ? { active: true } : {},
      // Nonaktif TETAP terlihat, cuma di bawah: kartu lama yang ditugaskan padanya harus tetap
      // punya nama, dan menyembunyikannya membuat assignee-nya terbaca sebagai id mentah.
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return paginate(rows.map(view), page, limit);
  });

  app.post("/members", async (req, reply) => {
    const parsed = zCreateMember.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    const id = memberId(p.email);
    if (await prisma.member.findUnique({ where: { id } }))
      return reply.code(409).send({ error: "email sudah terdaftar", id });

    const row = await prisma.member.create({
      data: { id, name: p.name, email: p.email, role: p.role ?? null },
    });
    await notifySynced("member", id);
    return reply.code(201).send(view(row));
  });

  app.patch("/members/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // `email` sengaja DI LUAR skema patch (ADR-0094 keputusan 2): id diturunkan darinya, dan
    // changefeed tak punya operasi rename — id yang berubah meninggalkan baris yatim di setiap
    // mesin lain. Ditolak eksplisit, bukan diabaikan: `.omit()` sendirian membuangnya SENYAP.
    const body = (req.body ?? {}) as Record<string, unknown>;
    if ("email" in body)
      return reply.code(400).send({ error: "email tak bisa diubah — hapus lalu buat baru" });

    const parsed = zPatchMember.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await prisma.member.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "not found" });

    const row = await prisma.member.update({ where: { id }, data: parsed.data });
    await notifySynced("member", id);
    return view(row);
  });

  app.delete("/members/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // `onDelete: SetNull` — task-nya jadi "belum ditugaskan", tidak ikut terhapus. Penerima sync
    // melakukan hal yang sama lewat cascade DB-nya sendiri.
    if (!(await deleteSynced("member", id))) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });
}
