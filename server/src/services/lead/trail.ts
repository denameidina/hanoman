import { prisma } from "../../db";
import type { LeadDecision } from "@prisma/client";
import type {
  LeadAction, LeadChoice, LeadConfidence, LeadGate, LeadKind, LeadStatus, LeadDecisionView,
} from "@hanoman/shared";
import { resolveChoices } from "@hanoman/shared";
import { leadWindow } from "./page";

// SPEC-409 · ADR-0091 · jejak keputusan (AC-23/24). Append-mostly: baris hanya berubah status
// (berlaku → ditimpa/dibatalkan). TIDAK ADA fungsi hapus di modul ini, dan tak ada endpoint yang
// memanggilnya — AC-32 melarang lead menghapus barisnya sendiri, dan cara paling murah
// menegakkannya adalah tidak pernah menulis kodenya (OQ-6: pemangkasan, bila kelak ada, jadi
// wewenang manusia lewat jalur terpisah).

export type TrailInput = {
  projectId: string;
  specId?: string | null;
  sessionId?: string | null;
  gate: LeadGate;
  kind: LeadKind;
  question: string;
  answer: string;
  reason: string;
  refs: string[];
  confidence: LeadConfidence;
  action: LeadAction;
  /** SPEC-480 · pilihan yang terselesaikan terhadap `options`; null bila tak ada / ditolak. */
  choice?: string | null;
  choiceIndex?: number | null;
  /** Daftar opsi yang dikirim peminta — disimpan supaya jejak bisa dibaca ulang tanpa peminta. */
  options?: string[] | null;
  /** Apa yang kurang bila lead menyatakan konteksnya tak cukup untuk memutuskan. */
  missing?: string[] | null;
  /**
   * SPEC-485 · ADR-0102 · bentuk penyimpanan yang BERLAKU: selalu daftar. `choice`/`choiceIndex`
   * di atas tinggal turunan `choices[0]`, dipertahankan demi pembaca lama & baris pra-migrasi.
   */
  choices?: LeadChoice[] | null;
  select?: { mode: string; min: number; max: number } | null;
  /** Rantai tempat langkah ini duduk, dan urutannya (1-basis). */
  flowId?: string | null;
  step?: number | null;
  status?: LeadStatus;
  weighty?: boolean;
  actor?: "lead" | "operator";
};

export async function recordDecision(i: TrailInput): Promise<LeadDecision> {
  return prisma.leadDecision.create({
    data: {
      projectId: i.projectId, specId: i.specId ?? null, sessionId: i.sessionId ?? null,
      gate: i.gate, kind: i.kind, question: i.question, answer: i.answer, reason: i.reason,
      refs: i.refs, confidence: i.confidence, action: i.action,
      // SPEC-480 · daftar kosong disimpan sebagai NULL: "peminta tak menyodorkan menu" dan
      // "menunya kosong" adalah keadaan yang sama, dan kolom nullable menyatakannya sekali.
      choice: i.choice ?? null,
      choiceIndex: i.choiceIndex ?? null,
      // `undefined` (bukan `null`) untuk kolom Json nullable: Prisma menuntut `DbNull` untuk
      // null eksplisit, sementara "tak disebut" pada create sudah berarti NULL di baris barunya.
      options: i.options?.length ? i.options : undefined,
      missing: i.missing?.length ? i.missing : undefined,
      // SPEC-485 · daftar kosong disimpan NULL dengan alasan yang sama seperti `options` di atas.
      choices: i.choices?.length ? i.choices : undefined,
      select: i.select ?? undefined,
      flowId: i.flowId ?? null, step: i.step ?? null,
      status: i.status ?? "berlaku", weighty: i.weighty ?? false, actor: i.actor ?? "lead",
    },
  });
}

export type TrailFilter = {
  projectId?: string; specId?: string; sessionId?: string; flowId?: string;
  // SPEC-523 · `page`/`limit` aditif; `take`/`skip` tetap diterima demi pemanggil lama.
  status?: string; take?: number; skip?: number; page?: number; limit?: number;
};

/** AC-24 · urut waktu (terbaru dulu), disaring per project & per backlog.
 *  SPEC-523 · mengembalikan amplop: `total` adalah hitungan SELURUH baris tersaring, bukan halaman. */
export async function listDecisions(f: TrailFilter = {}):
  Promise<{ rows: LeadDecision[]; total: number; page: number; pageSize: number }> {
  const where = {
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.specId ? { specId: f.specId } : {}),
    ...(f.sessionId ? { sessionId: f.sessionId } : {}),
    ...(f.flowId ? { flowId: f.flowId } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
  const w = leadWindow(f);
  const total = await prisma.leadDecision.count({ where });
  const rows = await prisma.leadDecision.findMany({
    where,
    // SPEC-485 · satu RANTAI dibaca dari awal: urutan pertanyaannya adalah isi jejaknya. Daftar
    // umum tetap terbaru-dulu (AC-24) — dua pertanyaan yang berbeda, dua urutan yang berbeda.
    orderBy: { createdAt: f.flowId ? "asc" : "desc" },
    take: w.take, skip: w.skip,
  });
  return { rows, total, page: w.page, pageSize: w.pageSize };
}

/**
 * AC-28 · operator menimpa. Keputusan lama ditandai `ditimpa` (BUKAN dihapus — jejaknya justru
 * intinya), jawaban operator disimpan sebagai baris BARU yang berlaku, dan keduanya saling
 * menunjuk. Pemanggil (route) yang menyampaikan jawaban baru ke sesi bila panenya masih hidup.
 *
 * Menimpa baris yang sudah ditimpa/dibatalkan ditolak: rantai override berantai membuat
 * "mana yang berlaku" jadi tebakan.
 */
export async function overrideDecision(
  id: string, answer: string, reason: string, rawChoices: string[] = [],
): Promise<{ old: LeadDecision; next: LeadDecision } | null> {
  const old = await prisma.leadDecision.findUnique({ where: { id } });
  if (!old || old.status !== "berlaku") return null;
  // SPEC-485 · centang operator dipetakan terhadap MENU BARIS YANG DITIMPA — bukan terhadap apa pun
  // yang dikirim klien — supaya jawaban manusia tersimpan dalam bentuk yang sama dengan jawaban
  // lead, dan bisa diketikkan ke pane sebagai centang, bukan sebagai prosa.
  const options = Array.isArray(old.options) ? (old.options as unknown[]).map(String) : [];
  const { choices } = resolveChoices(rawChoices, options);
  const next = await recordDecision({
    projectId: old.projectId, specId: old.specId, sessionId: old.sessionId,
    gate: old.gate as LeadGate, kind: old.kind as LeadKind,
    question: old.question, answer, reason: reason || "ditimpa operator",
    refs: [], confidence: "tinggi", action: "none", actor: "operator",
    choices, choice: choices[0]?.option ?? null, choiceIndex: choices[0]?.index ?? null,
    options, select: old.select as TrailInput["select"],
    flowId: old.flowId, step: old.step,
  });
  const updated = await prisma.leadDecision.update({
    where: { id }, data: { status: "ditimpa", supersededById: next.id },
  });
  return { old: updated, next };
}

/** US-3 · batalkan keputusan tanpa menggantinya. Baris tetap ada, statusnya saja yang berubah. */
export async function cancelDecision(id: string): Promise<LeadDecision | null> {
  const row = await prisma.leadDecision.findUnique({ where: { id } });
  if (!row || row.status !== "berlaku") return null;
  return prisma.leadDecision.update({ where: { id }, data: { status: "dibatalkan" } });
}

/** Baris Prisma → wire DTO. `refs` disimpan sebagai Json; bentuk tak terduga jatuh ke []. */
export function toDecisionView(r: LeadDecision): LeadDecisionView {
  return {
    id: r.id, projectId: r.projectId, specId: r.specId, sessionId: r.sessionId,
    gate: r.gate as LeadDecisionView["gate"], kind: r.kind as LeadDecisionView["kind"],
    question: r.question, answer: r.answer, reason: r.reason,
    refs: Array.isArray(r.refs) ? (r.refs as unknown[]).map(String) : [],
    confidence: r.confidence as LeadDecisionView["confidence"],
    action: r.action as LeadDecisionView["action"],
    // SPEC-480 · bentuk tak terduga jatuh ke [] / null, pola `refs` di atas.
    choice: r.choice, choiceIndex: r.choiceIndex,
    options: Array.isArray(r.options) ? (r.options as unknown[]).map(String) : [],
    missing: Array.isArray(r.missing) ? (r.missing as unknown[]).map(String) : [],
    // SPEC-485 · ADR-0102 · jawaban SELALU daftar di permukaan baca. Baris pra-migrasi tak punya
    // kolomnya, jadi ia DITURUNKAN dari pasangan skalar lama — itulah yang membuat riwayat lama
    // tetap terbaca sesudah perubahan skema, tanpa satu pun backfill.
    choices: Array.isArray(r.choices)
      ? (r.choices as { index?: unknown; option?: unknown }[])
          .map((c) => ({ index: Number(c?.index ?? 0) || 1, option: String(c?.option ?? "") }))
          .filter((c) => c.option !== "")
      : (r.choice ? [{ index: r.choiceIndex ?? 1, option: r.choice }] : []),
    select: (r.select as LeadDecisionView["select"]) ?? null,
    flowId: r.flowId, step: r.step,
    status: r.status as LeadDecisionView["status"],
    weighty: r.weighty, supersededById: r.supersededById,
    createdAt: r.createdAt.toISOString(),
  };
}
