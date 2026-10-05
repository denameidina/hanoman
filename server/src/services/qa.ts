import type { Prisma, QaAttachment, QaCase, QaFinding, QaReport } from "@prisma/client";
import {
  assignCodes, qaCodeKey, qaStats,
  type QaAttachmentView, type QaCaseStatus, type QaCaseView, type QaFindingSpecMirror, type QaFindingStatus, type QaFindingView,
  type QaOwnerType, type QaPriority, type QaReportDetail, type QaReportStatus, type QaReportView,
  type QaSeverity, type QaVerdict,
} from "@hanoman/shared";
import { effectiveStr } from "../config";
import { prisma } from "../db";

// Workspace QA · domain laporan. Route tinggal tipis. Kolom status/severity adalah TEXT yang kelak
// menyeberang sync dari mesin yang boleh lebih baru, jadi cast di bawah hanya untuk dirender.

const iso = (d: Date): string => d.toISOString();

export const envOf = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Record<string, string>;
};
export const stepsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
export const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/** Nomor tampil QA-001… per project, dari urutan createdAt. */
export async function reportCodes(projectId: string): Promise<Map<string, string>> {
  const rows = await prisma.qaReport.findMany({ where: { projectId }, select: { id: true, createdAt: true } });
  return new Map(assignCodes(rows, "QA-", 3).map((r) => [r.id, r.code]));
}

const reportView = (
  r: QaReport, code: string,
  cases: readonly { status: string }[], findings: readonly { severity: string; status: string }[],
): QaReportView => ({
  id: r.id, projectId: r.projectId, code, title: r.title, buildVersion: r.buildVersion,
  environment: envOf(r.environment), scope: r.scope, tester: r.tester, summary: r.summary,
  status: r.status as QaReportStatus, verdict: (r.verdict ?? null) as QaVerdict | null,
  createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), stats: qaStats(cases, findings),
});

export const attachmentView = (a: QaAttachment): QaAttachmentView => ({
  id: a.id, reportId: a.reportId, ownerType: a.ownerType as QaOwnerType, ownerId: a.ownerId,
  filename: a.filename, mimeType: a.mimeType, size: a.size, sha256: a.sha256,
  // Hub/standalone (tanpa SYNC_SERVER_URL) tak punya atasan tempat byte diunggah: "local-only" di sana (baris lama
  // dari bagian 1) berarti sama dengan "available".
  syncState: (a.syncState === "local-only" && !effectiveStr("SYNC_SERVER_URL") ? "available" : a.syncState) as QaAttachmentView["syncState"],
  createdAt: iso(a.createdAt),
});

/** Kunci semua kode bebas (test case + temuan) satu laporan: nomor otomatis melewatinya (ADR-0176). */
export const takenCodes = (...lists: readonly { code: string | null }[][]): Set<string> =>
  new Set(lists.flat().filter((r) => r.code).map((r) => qaCodeKey(r.code!)));

/** Ditampilkan menurut `order`; nomor TC-nn tetap menurut createdAt. */
export function caseViews(rows: QaCase[], taken: ReadonlySet<string> = new Set()): QaCaseView[] {
  return assignCodes(rows, "TC-", 2, taken)
    .map((r) => ({
      id: r.id, reportId: r.reportId, code: r.code, title: r.title, steps: r.steps, expected: r.expected,
      actual: r.actual, status: r.status as QaCaseStatus, order: r.order,
      createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
    }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

/** `rows` WAJIB terurut [createdAt asc, id asc] — urutan itu juga urutan tampil. */
export function findingViews(
  rows: QaFinding[], cases: QaCaseView[], specs: Map<string, QaFindingSpecMirror> = new Map(),
  taken: ReadonlySet<string> = new Set(),
): QaFindingView[] {
  const caseCode = new Map(cases.map((c) => [c.id, c.code]));
  return assignCodes(rows, "F-", 2, taken).map((r) => ({
    id: r.id, reportId: r.reportId, code: r.code, caseId: r.caseId,
    caseCode: r.caseId ? (caseCode.get(r.caseId) ?? null) : null,
    title: r.title, severity: r.severity as QaSeverity, priority: r.priority as QaPriority, area: r.area,
    steps: stepsOf(r.steps), expected: r.expected, actual: r.actual, status: r.status as QaFindingStatus,
    backlogId: r.backlogId, spec: r.backlogId ? (specs.get(r.backlogId) ?? null) : null,
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  }));
}

export async function listReports(projectId: string): Promise<QaReportView[]> {
  const rows = await prisma.qaReport.findMany({
    where: { projectId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { cases: { select: { status: true } }, findings: { select: { severity: true, status: true } } },
  });
  const codes = await reportCodes(projectId);
  return rows.map((r) => reportView(r, codes.get(r.id)!, r.cases, r.findings));
}

export async function reportDetail(projectId: string, reportId: string): Promise<QaReportDetail | null> {
  const row = await prisma.qaReport.findFirst({
    where: { id: reportId, projectId },
    include: {
      cases: true,
      findings: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!row) return null;
  const code = (await reportCodes(projectId)).get(row.id)!;
  const taken = takenCodes(row.cases, row.findings);
  const cases = caseViews(row.cases, taken);
  // Cermin backlog dihitung saat BACA (cermin TaskView.spec) — tak pernah ditulis balik ke temuan.
  const specIds = [...new Set(row.findings.map((f) => f.backlogId).filter((x): x is string => !!x))];
  const specs = new Map(
    (await prisma.spec.findMany({ where: { id: { in: specIds } }, select: { id: true, stage: true, priority: true } }))
      .map((x) => [x.id, x] as const),
  );
  return {
    ...reportView(row, code, row.cases, row.findings),
    cases, findings: findingViews(row.findings, cases, specs, taken), attachments: row.attachments.map(attachmentView),
  };
}

/**
 * Kode bebas harus unik di satu laporan (test case + temuan, tak peka huruf besar/kecil) — Lampiran dan
 * rujukan "Test case" pada temuan menemukan baris lewat kode. Mengembalikan pesan galat, atau null bila aman.
 * Nomor otomatis tak perlu dicek: ia selalu melewati kode bebas (`assignCodes`).
 */
export async function qaCodeProblem(reportId: string, code: string | null | undefined, exceptId?: string): Promise<{ error: string; code: string } | null> {
  if (!code) return null;
  const [cases, findings] = await Promise.all([
    prisma.qaCase.findMany({ where: { reportId, code: { not: null } }, select: { id: true, code: true } }),
    prisma.qaFinding.findMany({ where: { reportId, code: { not: null } }, select: { id: true, code: true } }),
  ]);
  const key = qaCodeKey(code);
  return [...cases, ...findings].some((r) => r.id !== exceptId && qaCodeKey(r.code!) === key)
    ? { error: "kode sudah dipakai di laporan ini; kode test case dan temuan harus unik", code } : null;
}
