// Workspace QA · bagian 2 · temuan → backlog item (source `qa`). Cermin services/task-escalate.ts
// (ADR-0152): idempoten lewat back-pointer (`QaFinding.backlogId`), tautan putus dibuat ulang, retry
// P2002 di sekitar nextSpecId (TOCTOU), `launchApprovedAt` hanya bila principal-nya berwenang.
import type { Spec } from "@prisma/client";
import {
  qaPriorityToSpec, qaSeverityToSpec,
  type Priority, type QaBacklogResult, type QaFindingView, type QaReportDetail,
} from "@hanoman/shared";
import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";
import { copyUpload, deleteUpload } from "./uploads";
import { SPEC_ATTACHMENT_LIMITS } from "./spec-attachment";
import { syncSpecAttachmentsDir } from "./spec-attachment-dir";

const mirror = (s: { id: string; stage: string; priority: string }) => ({ id: s.id, stage: s.stage, priority: s.priority });

/** Payload `qa`: severity/prioritas QA asli ikut ditulis di `actual` karena pemetaannya lossy. */
function payloadOf(d: QaReportDetail, f: QaFindingView) {
  const origin = [
    `Dari temuan ${f.code} · laporan QA ${d.code} "${d.title}"${d.buildVersion ? ` (build ${d.buildVersion})` : ""}.`,
    `Severity QA: ${f.severity} · prioritas QA: ${f.priority}${f.area ? ` · area: ${f.area}` : ""}${f.caseCode ? ` · test case: ${f.caseCode}` : ""}.`,
  ].join("\n");
  const env = [d.buildVersion ? `build ${d.buildVersion}` : "", ...Object.entries(d.environment).map(([k, v]) => `${k}=${v}`)]
    .filter(Boolean).join("\n");
  return {
    severity: qaSeverityToSpec(f.severity),
    steps: f.steps.map((t, i) => `${i + 1}. ${t}`).join("\n"),
    expected: f.expected,
    actual: [f.actual.trim(), origin].filter(Boolean).join("\n\n"),
    env, constraints: "",   // `priority` bukan field zQaPayload: ia ditulis ke kolom Spec.priority
  };
}

export async function sendFindingToBacklog(
  d: QaReportDetail, findingId: string,
  opts: { author: string; launchApprovedBy: string | null; priority?: Priority },
): Promise<QaBacklogResult> {
  const f = d.findings.find((x) => x.id === findingId);
  if (!f) throw new Error(`temuan ${findingId} tak ada di laporan ${d.id}`);

  if (f.backlogId) {
    const existing = await prisma.spec.findUnique({ where: { id: f.backlogId }, select: { id: true, stage: true, priority: true } });
    // backlogId terisi TANPA Spec = tautan putus → jatuh ke pembuatan baru (cermin escalateTask).
    if (existing) return { findingId, code: f.code, created: false, spec: mirror(existing), attachments: { saved: 0, rejected: [] } };
  }

  const priority = opts.priority ?? qaPriorityToSpec(f.priority);
  const payload = payloadOf(d, f);
  const repoDir = await resolveRepoDir(d.projectId);
  const backlink = `Dari temuan ${f.code} laporan QA ${d.code} (temuan ${f.id}).`;

  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({ data: {
        id: sid, projectId: d.projectId, title: f.title, source: "qa", stage: "brainstorming", priority,
        author: `QA · ${opts.author}`, objective: `${f.title}. ${backlink}`, payload,
        launchApprovedAt: opts.launchApprovedBy ? new Date() : null, launchApprovedBy: opts.launchApprovedBy,
      } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  await prisma.qaFinding.update({ where: { id: f.id }, data: { status: "sent", backlogId: spec!.id } });
  await notifySynced("spec", spec!.id);

  const attachments = await copyAttachments(d, f, spec!);
  if (attachments.saved) await syncSpecAttachmentsDir(spec!.id, d.projectId);
  return { findingId, code: f.code, created: true, spec: mirror(spec!), attachments };
}

/**
 * Lampiran TEMUAN (bukan milik laporan/test case) disalin jadi lampiran backlog. Byte disalin ke key baru;
 * yang ditolak (batas jumlah/kuota backlog, byte hilang) dilaporkan per berkas dan TAK menggagalkan backlog.
 */
async function copyAttachments(d: QaReportDetail, f: QaFindingView, spec: Spec): Promise<QaBacklogResult["attachments"]> {
  const rows = await prisma.qaAttachment.findMany({
    where: { reportId: d.id, ownerType: "finding", ownerId: f.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let count = 0;
  let bytes = 0;
  let saved = 0;
  const rejected: { filename: string; reason: string }[] = [];
  for (const a of rows) {
    if (count >= SPEC_ATTACHMENT_LIMITS.perSpec) { rejected.push({ filename: a.filename, reason: "count" }); continue; }
    if (bytes + a.size > SPEC_ATTACHMENT_LIMITS.specBytes) { rejected.push({ filename: a.filename, reason: "quota" }); continue; }
    let key: string;
    try { key = await copyUpload(a.storageKey); }
    catch { rejected.push({ filename: a.filename, reason: "missing" }); continue; }   // byte tak ada di mesin ini
    try {
      await prisma.specAttachment.create({ data: {
        specId: spec.id, projectId: d.projectId, filename: a.filename, mimeType: a.mimeType, size: a.size, storageKey: key,
      } });
    } catch (e) { await deleteUpload(key); throw e; }
    count += 1; bytes += a.size; saved += 1;
  }
  return { saved, rejected };
}
