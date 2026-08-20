import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { paginate } from "../services/paginate";
import { getSetting } from "../services/settings";
import { quotaView } from "../services/portal-chat/quota";
import { resolveRepoDir } from "../services/local-binding";
import { writeDocFile } from "../services/scan";

// SPEC-854 · ADR-0129 · permukaan OPERATOR untuk obrolan portal: membaca percakapan, membaca PRD
// draft, memateralisasinya jadi dokumen, dan menarik transkrip untuk training.
//
// Tak satu pun route di sini terdaftar di `clientRouteAllowed`, jadi gerbang `app.ts` yang sudah
// ada membalas 403 untuk akun klien — tak ada gerbang kedua yang perlu dirawat di berkas ini.

// Slug PRD divalidasi sebagai BENTUK, bukan sekadar "tanpa `..`": nama berkas ini masuk ke
// `docs/prd/` yang dibaca pemilih PRD dan `prdStatusOf` (ADR-0041), jadi ia harus terlihat seperti
// slug yang sama dengan yang ditulis sesi PRD. `writeDocFile` tetap titik cekik terakhirnya.
const zPrd = z.object({ slug: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,60}[a-z0-9])?$/) });
const zQuery = z.object({ project: z.string().min(1) });

const sessionRow = (s: {
  id: string; projectId: string; type: string; summary: string; periodKey: string;
  prdReadyAt: Date | null; prdDocPath: string | null; createdAt: Date; updatedAt: Date;
  user: { email: string };
}) => ({
  id: s.id, projectId: s.projectId, type: s.type, summary: s.summary, periodKey: s.periodKey,
  prdSiap: !!s.prdReadyAt, prdDocPath: s.prdDocPath,
  prdReadyAt: s.prdReadyAt?.toISOString() ?? null,
  clientEmail: s.user.email,
  createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
});

const messageRow = (m: {
  id: string; seq: number; role: string; text: string; rawText: string | null;
  blocked: boolean; blockReasons: unknown; createdAt: Date;
}) => ({
  id: m.id, seq: m.seq, role: m.role, text: m.text,
  // Operator melihat teks MENTAH agen untuk baris yang tertolak gerbang — itu satu-satunya cara
  // menilai apakah penjagaannya bekerja atau kelewat lapar.
  rawText: m.rawText, blocked: m.blocked, blockReasons: m.blockReasons,
  createdAt: m.createdAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  app.get("/portal-chat/sessions", async (req, reply) => {
    const parsed = zQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "project wajib" });
    const { page, limit } = req.query as { page?: string; limit?: string };
    const rows = await prisma.portalChatSession.findMany({
      where: { projectId: parsed.data.project }, orderBy: { updatedAt: "desc" },
      include: { user: { select: { email: true } } } });
    const cfg = (await getSetting()).portalChat;
    // Angka jatah operator datang dari `quotaView` yang SAMA dengan yang dibaca klien — bukan
    // hitungan kedua yang bisa menyimpang.
    return { ...paginate(rows.map(sessionRow), page, limit),
      kuota: await quotaView(parsed.data.project, cfg) };
  });

  app.get("/portal-chat/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await prisma.portalChatSession.findUnique({
      where: { id }, include: { user: { select: { email: true } } } });
    if (!s) return reply.code(404).send({ error: "not found" });
    const messages = await prisma.portalChatMessage.findMany({
      where: { sessionId: id }, orderBy: { seq: "asc" } });
    return { ...sessionRow(s), prdMarkdown: s.prdMarkdown, messages: messages.map(messageRow) };
  });

  app.post("/portal-chat/sessions/:id/prd", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPrd.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "slug tak valid" });
    const s = await prisma.portalChatSession.findUnique({ where: { id } });
    if (!s) return reply.code(404).send({ error: "not found" });
    if (!s.prdMarkdown)
      return reply.code(409).send({ error: "sesi ini belum menghasilkan PRD draft" });
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir)
      return reply.code(409).send({ error: "project ini belum punya checkout di mesin ini" });

    const path = `docs/prd/${parsed.data.slug}.md`;
    writeDocFile(repoDir, path, s.prdMarkdown);
    await prisma.portalChatSession.update({ where: { id }, data: { prdDocPath: path } });
    // SENGAJA tak menyentuh `prisma.spec`: PRD ini TIDAK otomatis jadi backlog dan tidak memicu
    // pekerjaan apa pun. Eskalasi adalah keputusan manusia pemilik project (SPEC-854 huruf B),
    // dan pintunya tetap alur "take PRD → backlog" yang sudah ada.
    return reply.code(201).send({ path });
  });

  app.get("/portal-chat/export", async (req, reply) => {
    const parsed = zQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "project wajib" });
    const { from, to } = req.query as { from?: string; to?: string };
    const rows = await prisma.portalChatSession.findMany({
      where: {
        projectId: parsed.data.project,
        ...(from || to ? { createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { email: true } },
        messages: { orderBy: { seq: "asc" } } },
    });
    // NDJSON: satu sesi per baris, siap dialirkan ke pipeline training tanpa memuat seluruh
    // korpus ke memori pembacanya.
    const body = rows.map((s) => JSON.stringify({
      ...sessionRow(s), prdMarkdown: s.prdMarkdown,
      messages: s.messages.map(messageRow),
    })).join("\n");
    return reply.type("application/x-ndjson").send(body ? `${body}\n` : "");
  });
}
