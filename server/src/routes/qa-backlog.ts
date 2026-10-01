import type { FastifyInstance } from "fastify";
import { zPriority, type QaBacklogResult } from "@hanoman/shared";
import { z } from "zod";
import { prisma } from "../db";
import { launchPrincipal } from "../services/launch-authority";
import { reportDetail } from "../services/qa";
import { sendFindingToBacklog } from "../services/qa-backlog";

// Workspace QA · temuan → backlog. Capability `qa:write` dari prefix `/projects/:id/qa` — cermin
// `POST /tasks/:id/escalate` yang tetap `team:write` (ADR-0157): permukaan MASUK memegang capability-nya
// sendiri, sedangkan peluncuran sesi tetap digerbangi `launchPrincipal` (tanpa `sessions:write` pada
// token yang sama, Spec lahir TANPA `launchApprovedAt`).
//
// PENGECUALIAN read-only (keputusan desain 2026-10-01): laporan `closed` TETAP boleh mengirim temuan —
// alurnya submit → putuskan go/no-go → close → kirim; yang berubah hanya tautan (`status`/`backlogId`),
// bukan isi laporan. Sisa tulisan (case, temuan, lampiran, header) tetap 409.
// Path LITERAL di tiap `app.<method>("…")`: gerbang mcp-coverage membaca inventaris route lewat regex.

const zBody = z.object({ priority: zPriority.optional() });
const authorOf = (req: { user?: { email: string } | null; agent?: { id: string } | null }) =>
  req.user?.email ?? (req.agent ? `agent:${req.agent.id}` : "system");

export default async function qaBacklog(app: FastifyInstance) {
  type Ids = { pid: string; rid: string; fid: string };

  app.post("/projects/:pid/qa/reports/:rid/findings/:fid/backlog", async (req, reply) => {
    const { pid, rid, fid } = req.params as Ids;
    const parsed = zBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = await reportDetail(pid, rid);
    if (!d || !d.findings.some((f) => f.id === fid)) return reply.code(404).send({ error: "not found" });

    const r = await sendFindingToBacklog(d, fid, {
      author: authorOf(req), launchApprovedBy: launchPrincipal(req), priority: parsed.data.priority,
    });
    await prisma.qaReport.update({ where: { id: rid }, data: { updatedAt: new Date() } });
    return reply.code(r.created ? 201 : 200).send({ ...r, report: await reportDetail(pid, rid) });
  });

  // Semua temuan `open`: `wontfix` dan yang sudah `sent` dilewati. Satu gagal tak menggagalkan yang lain.
  app.post("/projects/:pid/qa/reports/:rid/backlog", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const parsed = zBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = await reportDetail(pid, rid);
    if (!d) return reply.code(404).send({ error: "not found" });

    const results: QaBacklogResult[] = [];
    for (const f of d.findings.filter((x) => x.status === "open")) {
      try {
        results.push(await sendFindingToBacklog(d, f.id, {
          author: authorOf(req), launchApprovedBy: launchPrincipal(req), priority: parsed.data.priority,
        }));
      } catch (e) {
        req.log.warn({ findingId: f.id, err: e }, "qa → backlog gagal");
        results.push({ findingId: f.id, code: f.code, created: false, spec: null, attachments: { saved: 0, rejected: [] }, error: (e as Error).message });
      }
    }
    if (results.length) await prisma.qaReport.update({ where: { id: rid }, data: { updatedAt: new Date() } });
    return { results, sent: results.filter((r) => r.created).length, report: await reportDetail(pid, rid) };
  });
}
