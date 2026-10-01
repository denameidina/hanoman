import { z } from "zod";
import type { Priority, Severity } from "./spec-source";

// Workspace QA · bagian 1 · kontrak murni. Nol I/O: dipakai server (validasi + serialisasi), tool
// MCP, dan UI dari satu sumber.
//
// Nomor tampil (QA-007 / F-01 / TC-03) TIDAK disimpan: `assignCodes` menghitungnya saat render dari
// urutan `createdAt`. Id acak tak pernah bentrok antar perangkat sesudah sync (bagian 3); harganya,
// nomor bisa bergeser bila baris yang lebih tua dari perangkat lain masuk — ekspor Markdown
// membekukan nomor pada saat ekspor dan menyertakan `id` untuk impor.

export const QA_REPORT_STATUSES = ["draft", "submitted", "closed"] as const;
export type QaReportStatus = (typeof QA_REPORT_STATUSES)[number];
export const QA_VERDICTS = ["go", "no-go", "conditional"] as const;
export type QaVerdict = (typeof QA_VERDICTS)[number];
export const QA_CASE_STATUSES = ["todo", "pass", "fail", "blocked", "skipped"] as const;
export type QaCaseStatus = (typeof QA_CASE_STATUSES)[number];
export const QA_SEVERITIES = ["blocker", "critical", "major", "minor", "trivial"] as const;
export type QaSeverity = (typeof QA_SEVERITIES)[number];
export const QA_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type QaPriority = (typeof QA_PRIORITIES)[number];
/** `sent` (sudah jadi backlog) hanya ditulis server di bagian 2 — bukan input operator. */
export const QA_FINDING_STATUSES = ["open", "sent", "wontfix"] as const;
export type QaFindingStatus = (typeof QA_FINDING_STATUSES)[number];
export const QA_OWNER_TYPES = ["report", "case", "finding"] as const;
export type QaOwnerType = (typeof QA_OWNER_TYPES)[number];

export const zQaEnvironment = z
  .record(z.string().trim().min(1).max(60), z.string().max(500))
  .refine((e) => Object.keys(e).length <= 20, "maksimal 20 entri environment");

const zSteps = z.array(z.string().trim().min(1).max(2_000)).max(50);

export const zCreateQaReport = z.object({
  title: z.string().trim().min(1).max(300),
  buildVersion: z.string().trim().max(120).default(""),
  environment: zQaEnvironment.default({}),
  scope: z.string().max(5_000).default(""),
  tester: z.string().trim().max(200).default(""),
  summary: z.string().max(20_000).default(""),
  verdict: z.enum(QA_VERDICTS).nullable().default(null),
});
export type CreateQaReport = z.input<typeof zCreateQaReport>;

// `.partial()` mematikan default — PATCH yang tak menyebut field harus membiarkannya utuh.
export const zPatchQaReport = zCreateQaReport.partial().extend({ status: z.enum(QA_REPORT_STATUSES).optional() });
export type PatchQaReport = z.input<typeof zPatchQaReport>;

export const zCreateQaCase = z.object({
  title: z.string().trim().min(1).max(300),
  steps: z.string().max(10_000).default(""),
  expected: z.string().max(10_000).default(""),
  actual: z.string().max(10_000).default(""),
  status: z.enum(QA_CASE_STATUSES).default("todo"),
  order: z.number().finite().optional(),
});
export type CreateQaCase = z.input<typeof zCreateQaCase>;
export const zPatchQaCase = zCreateQaCase.partial();
export type PatchQaCase = z.input<typeof zPatchQaCase>;

export const zCreateQaFinding = z.object({
  title: z.string().trim().min(1).max(300),
  caseId: z.string().max(120).nullable().default(null),
  severity: z.enum(QA_SEVERITIES).default("major"),
  priority: z.enum(QA_PRIORITIES).default("P2"),
  area: z.string().trim().max(120).default(""),
  steps: zSteps.default([]),
  expected: z.string().max(10_000).default(""),
  actual: z.string().max(10_000).default(""),
  status: z.enum(["open", "wontfix"]).default("open"),
});
export type CreateQaFinding = z.input<typeof zCreateQaFinding>;
export const zPatchQaFinding = zCreateQaFinding.partial();
export type PatchQaFinding = z.input<typeof zPatchQaFinding>;

/** Nomor tampil: urut `createdAt` (seri → `id`) per himpunan baris; urutan array input dipertahankan. */
export function assignCodes<T extends { id: string; createdAt: Date | string }>(
  rows: readonly T[], prefix: string, pad: number,
): (T & { code: string })[] {
  const ts = (r: T) => new Date(r.createdAt).getTime();
  const rank = new Map(
    [...rows]
      .sort((a, b) => ts(a) - ts(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r, i) => [r.id, i + 1] as const),
  );
  return rows.map((r) => ({ ...r, code: `${prefix}${String(rank.get(r.id)).padStart(pad, "0")}` }));
}

export type QaStats = {
  cases: Record<QaCaseStatus, number> & { total: number };
  /** pass / (pass+fail+blocked); null bila belum ada yang dieksekusi. */
  passRate: number | null;
  findings: Record<QaSeverity, number> & { total: number; open: number };
};

export function qaStats(
  cases: readonly { status: string }[], findings: readonly { severity: string; status: string }[],
): QaStats {
  const c = { total: cases.length, todo: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 };
  for (const x of cases) if ((QA_CASE_STATUSES as readonly string[]).includes(x.status)) c[x.status as QaCaseStatus] += 1;
  const f = { total: findings.length, open: 0, blocker: 0, critical: 0, major: 0, minor: 0, trivial: 0 };
  for (const x of findings) {
    if ((QA_SEVERITIES as readonly string[]).includes(x.severity)) f[x.severity as QaSeverity] += 1;
    if (x.status === "open") f.open += 1;
  }
  const executed = c.pass + c.fail + c.blocked;
  return { cases: c, passRate: executed ? c.pass / executed : null, findings: f };
}

/** Per MESIN (kolom LOCAL): local-only = byte hanya di sini, belum diunggah ke hub · remote = metadata ada, byte
 * belum diunduh · available = byte ada di sini (di client: dan terkonfirmasi di hub) · failed = hub menolak byte-nya. */
export type QaAttachmentSyncState = "local-only" | "remote" | "available" | "failed";
export type QaAttachmentView = {
  id: string; reportId: string; ownerType: QaOwnerType; ownerId: string;
  filename: string; mimeType: string; size: number; sha256: string;
  syncState: QaAttachmentSyncState; createdAt: string;
};
export type QaCaseView = {
  id: string; reportId: string; code: string; title: string; steps: string; expected: string;
  actual: string; status: QaCaseStatus; order: number; createdAt: string; updatedAt: string;
};
/** Cermin backlog hasil "kirim ke backlog", dihitung saat BACA (cermin TaskView.spec) — tak pernah disimpan. */
export type QaFindingSpecMirror = { id: string; stage: string; priority: string };
export type QaFindingView = {
  id: string; reportId: string; code: string; caseId: string | null; caseCode: string | null;
  title: string; severity: QaSeverity; priority: QaPriority; area: string; steps: string[];
  expected: string; actual: string; status: QaFindingStatus; backlogId: string | null;
  /** `backlogId` terisi dengan `spec` null = tautan PUTUS (backlognya sudah dihapus). */
  spec: QaFindingSpecMirror | null;
  createdAt: string; updatedAt: string;
};
export type QaReportView = {
  id: string; projectId: string; code: string; title: string; buildVersion: string;
  environment: Record<string, string>; scope: string; tester: string; summary: string;
  status: QaReportStatus; verdict: QaVerdict | null; createdAt: string; updatedAt: string;
  stats: QaStats;
};
export type QaReportDetail = QaReportView & {
  cases: QaCaseView[]; findings: QaFindingView[]; attachments: QaAttachmentView[];
};

export type QaImportResult = {
  reportId: string; created: boolean; cases: number; findings: number;
  attachments: { saved: number; rejected: { filename: string; reason: string }[] };
};

// ── pemetaan ke backlog (bagian 2) ────────────────────────────────────────
// SENGAJA lossy dan dinyatakan: payload backlog `qa` hanya punya critical|major|minor dan prioritas
// tiga nilai. Severity & prioritas QA asli ikut ditulis ke teks backlog supaya tak hilang.
export function qaSeverityToSpec(s: QaSeverity): Severity {
  return s === "blocker" || s === "critical" ? "critical" : s === "major" ? "major" : "minor";
}
export function qaPriorityToSpec(p: QaPriority): Priority {
  return p === "P0" || p === "P1" ? "tinggi" : p === "P2" ? "sedang" : "rendah";
}

export type QaBacklogResult = {
  findingId: string; code: string; created: boolean;
  spec: QaFindingSpecMirror | null;
  attachments: { saved: number; rejected: { filename: string; reason: string }[] };
  error?: string;
};

/** Hasil impor matriks test case (XLSX/CSV). `unchanged` = baris ber-Ref yang isinya sama persis. */
export type QaCasesImportResult = { updated: number; created: number; unchanged: number };
export const QA_EXPORT_FORMATS = ["zip", "md", "docx", "pdf", "xlsx", "csv"] as const;
export type QaExportFormat = (typeof QA_EXPORT_FORMATS)[number];

