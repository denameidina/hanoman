import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodError } from "zod";
import {
  zCreateQaCase, zCreateQaFinding, zCreateQaReport, zPatchQaCase, zPatchQaFinding, zPatchQaReport,
} from "@hanoman/shared";
import { prisma } from "../db";
import { asJson, listReports, reportDetail } from "../services/qa";
import { removeQaAttachments } from "../services/qa-attachment";

// Workspace QA · CRUD laporan/test case/temuan. LOCAL-only di bagian 1: sengaja TANPA
// `notifySynced` (entitas belum masuk FIELDS sync). Capability `qa:*` dipetakan menurut METHOD di
// `capabilityForRoute`. Setiap mutasi anak menjawab `QaReportDetail` terbaru — klien tak perlu
// menghitung ulang nomor tampil atau statistik.

const bad = (reply: FastifyReply, err: ZodError) => reply.code(400).send({ error: err.flatten() });
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "not found" });
const locked = (reply: FastifyReply) =>
  reply.code(409).send({ error: "laporan sudah closed — buka kembali (status=draft) sebelum mengubahnya" });

const findReport = (pid: string, rid: string) => prisma.qaReport.findFirst({ where: { id: rid, projectId: pid } });
const touch = (rid: string) => prisma.qaReport.update({ where: { id: rid }, data: { updatedAt: new Date() } });

// Path ditulis LITERAL di tiap `app.<method>("…")`: `server/test/mcp-coverage.test.ts` membaca inventaris route
// dengan regex dari sumber, dan path berbentuk variabel/template tak pernah terhitung (gerbang hijau palsu).
export default async function qa(app: FastifyInstance) {
  type Ids = { pid: string; rid: string; cid: string; fid: string };

  app.get("/projects/:pid/qa/reports", async (req, reply) => {
    const { pid } = req.params as Ids;
    if (!(await prisma.project.findUnique({ where: { id: pid }, select: { id: true } }))) return notFound(reply);
    const items = await listReports(pid);
    return { items, total: items.length };
  });

  app.post("/projects/:pid/qa/reports", async (req, reply) => {
    const { pid } = req.params as Ids;
    if (!(await prisma.project.findUnique({ where: { id: pid }, select: { id: true } }))) return notFound(reply);
    const parsed = zCreateQaReport.safeParse(req.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;
    const row = await prisma.qaReport.create({ data: {
      projectId: pid, title: p.title, buildVersion: p.buildVersion, environment: asJson(p.environment),
      scope: p.scope, tester: p.tester, summary: p.summary, verdict: p.verdict,
    } });
    return reply.code(201).send(await reportDetail(pid, row.id));
  });

  app.get("/projects/:pid/qa/reports/:rid", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    return (await reportDetail(pid, rid)) ?? notFound(reply);
  });

  app.patch("/projects/:pid/qa/reports/:rid", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const existing = await findReport(pid, rid);
    if (!existing) return notFound(reply);
    const parsed = zPatchQaReport.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;

    // closed hanya boleh dibuka kembali: satu-satunya ubahan yang lolos adalah PATCH {status≠closed}.
    if (existing.status === "closed") {
      const keys = Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined);
      if (!(keys.length === 1 && keys[0] === "status" && p.status !== "closed")) return locked(reply);
    }
    const nextStatus = p.status ?? existing.status;
    const nextVerdict = p.verdict === undefined ? existing.verdict : p.verdict;
    if ((nextStatus === "submitted" || nextStatus === "closed") && !nextVerdict)
      return reply.code(400).send({ error: "verdict wajib diisi sebelum laporan di-submit atau di-close" });

    await prisma.qaReport.update({ where: { id: rid }, data: {
      title: p.title, buildVersion: p.buildVersion, scope: p.scope, tester: p.tester, summary: p.summary,
      verdict: p.verdict, status: p.status,
      environment: p.environment === undefined ? undefined : asJson(p.environment),
    } });
    return reportDetail(pid, rid);
  });

  app.delete("/projects/:pid/qa/reports/:rid", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const existing = await findReport(pid, rid);
    if (!existing) return notFound(reply);
    if (existing.status === "closed") return locked(reply);
    // Cascade DB tak menyentuh disk: bayt lampiran dibuang SEBELUM barisnya.
    await removeQaAttachments({ reportId: rid });
    await prisma.qaReport.delete({ where: { id: rid } });
    return { ok: true };
  });

  // ── test case ────────────────────────────────────────────────────────────
  app.post("/projects/:pid/qa/reports/:rid/cases", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r) return notFound(reply);
    if (r.status === "closed") return locked(reply);
    const parsed = zCreateQaCase.safeParse(req.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;
    const last = await prisma.qaCase.findFirst({ where: { reportId: rid }, orderBy: { order: "desc" }, select: { order: true } });
    await prisma.qaCase.create({ data: {
      reportId: rid, title: p.title, steps: p.steps, expected: p.expected, actual: p.actual,
      status: p.status, order: p.order ?? (last ? last.order + 1 : 1),
    } });
    await touch(rid);
    return reply.code(201).send(await reportDetail(pid, rid));
  });

  app.patch("/projects/:pid/qa/reports/:rid/cases/:cid", async (req, reply) => {
    const { pid, rid, cid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r || !(await prisma.qaCase.findFirst({ where: { id: cid, reportId: rid }, select: { id: true } })))
      return notFound(reply);
    if (r.status === "closed") return locked(reply);
    const parsed = zPatchQaCase.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, parsed.error);
    await prisma.qaCase.update({ where: { id: cid }, data: parsed.data });
    await touch(rid);
    return reportDetail(pid, rid);
  });

  app.delete("/projects/:pid/qa/reports/:rid/cases/:cid", async (req, reply) => {
    const { pid, rid, cid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r || !(await prisma.qaCase.findFirst({ where: { id: cid, reportId: rid }, select: { id: true } })))
      return notFound(reply);
    if (r.status === "closed") return locked(reply);
    await removeQaAttachments({ reportId: rid, ownerType: "case", ownerId: cid });
    await prisma.$transaction([
      prisma.qaFinding.updateMany({ where: { reportId: rid, caseId: cid }, data: { caseId: null } }),
      prisma.qaCase.delete({ where: { id: cid } }),
    ]);
    await touch(rid);
    return reportDetail(pid, rid);
  });

  // ── temuan ───────────────────────────────────────────────────────────────
  // `caseId` soft-link tanpa FK: rujukan yang salah tak ditolak DB, jadi digerbang di sini dan
  // pesannya menyebut NILAI yang salah.
  const caseProblem = async (rid: string, caseId: string | null | undefined) =>
    caseId && !(await prisma.qaCase.findFirst({ where: { id: caseId, reportId: rid }, select: { id: true } }))
      ? { error: "test case tak ditemukan di laporan ini", caseId } : null;

  app.post("/projects/:pid/qa/reports/:rid/findings", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r) return notFound(reply);
    if (r.status === "closed") return locked(reply);
    const parsed = zCreateQaFinding.safeParse(req.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;
    const problem = await caseProblem(rid, p.caseId);
    if (problem) return reply.code(400).send(problem);
    await prisma.qaFinding.create({ data: {
      reportId: rid, caseId: p.caseId, title: p.title, severity: p.severity, priority: p.priority,
      area: p.area, steps: asJson(p.steps), expected: p.expected, actual: p.actual, status: p.status,
    } });
    await touch(rid);
    return reply.code(201).send(await reportDetail(pid, rid));
  });

  app.patch("/projects/:pid/qa/reports/:rid/findings/:fid", async (req, reply) => {
    const { pid, rid, fid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r || !(await prisma.qaFinding.findFirst({ where: { id: fid, reportId: rid }, select: { id: true } })))
      return notFound(reply);
    if (r.status === "closed") return locked(reply);
    const parsed = zPatchQaFinding.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;
    const problem = await caseProblem(rid, p.caseId);
    if (problem) return reply.code(400).send(problem);
    await prisma.qaFinding.update({ where: { id: fid }, data: {
      caseId: p.caseId, title: p.title, severity: p.severity, priority: p.priority, area: p.area,
      steps: p.steps === undefined ? undefined : asJson(p.steps), expected: p.expected, actual: p.actual,
      status: p.status,
    } });
    await touch(rid);
    return reportDetail(pid, rid);
  });

  app.delete("/projects/:pid/qa/reports/:rid/findings/:fid", async (req, reply) => {
    const { pid, rid, fid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r || !(await prisma.qaFinding.findFirst({ where: { id: fid, reportId: rid }, select: { id: true } })))
      return notFound(reply);
    if (r.status === "closed") return locked(reply);
    await removeQaAttachments({ reportId: rid, ownerType: "finding", ownerId: fid });
    await prisma.qaFinding.delete({ where: { id: fid } });
    await touch(rid);
    return reportDetail(pid, rid);
  });
}
