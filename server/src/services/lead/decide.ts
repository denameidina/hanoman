import type { LeadDecision } from "@prisma/client";
import {
  isWeightyDecision, leadActionAllowed, leadRefusalReason,
  resolveChoices, normalizeSelect, checkChoiceCount,
  clampProse, optionActionHint, LEAD_DECISION_MAX, LEAD_REASON_MAX,
  type LeadAction, type LeadDelivery, type LeadGate, type LeadKind,
  type LeadSelect,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { resolveRepoDir } from "../local-binding";
import { listSessions } from "../pty";
import { recordLeadDecision } from "../notifications";
import { getLead, leadActive } from "./config";
import { leadPrompt, type LeadContext } from "./prompt";
import { parseLeadVerdict, keepExistingRefs } from "./verdict";
import { recordDecision } from "./trail";
import { thinkViaSession, thinkTimeoutMs, type ThinkCtx } from "./session-think";
import { markDeciding, clearDeciding } from "./deciding";
import { openFlow, joinFlow, markFlowStep, closeFlow } from "./flow";

// SPEC-409 · ADR-0091 · SATU otak, dua pintu (G6). Baik kontrak eksplisit (pintu #1) maupun deteksi
// otomatis (pintu #2) maupun denyut proaktif (pintu #3) lewat `decide()` — jadi hanya ada satu
// tempat yang tahu urutan wajib: bukti → putusan → saring rujukan → gerbang tindakan → TULIS JEJAK
// → notifikasi. AC-2 menuntut jejak ditulis SEBELUM jawaban sampai ke peminta, dan satu-satunya
// cara memastikannya adalah tak punya jalur kedua.

export type DecideRequest = {
  projectId: string;
  specId?: string | null;
  sessionId?: string | null;
  gate: LeadGate;
  kind: LeadKind;
  question: string;
  options?: string[];
  /** Konteks tambahan dari peminta (mis. isi layar pane, daftar berkas bertabrakan). */
  notes?: string[];
  /** SPEC-485 · bentuk pilihan yang diminta peminta. Tak ada = single (perilaku sebelum ADR-0102). */
  select?: LeadSelect;
  /** `true` = peminta akan bertanya lagi; alurnya dibiarkan terbuka sampai di-submit. */
  chain?: boolean;
  /** Lanjutkan rantai. Tertutup/tak ada → `LeadFlowClosedError` (route menerjemahkannya jadi 409). */
  flowId?: string | null;
};

export type DecideDeps = {
  /** ADR-0228 · otak lead = pane sesi lead (`thinkViaSession`); disuntik supaya teruji tanpa tmux. */
  think: (prompt: string, o: ThinkCtx) => Promise<string>;
  repoDir: (projectId: string) => Promise<string | null>;
  liveSessions: () => { id: string; projectId: string; specId?: string; flow?: string; branch?: string; exited: boolean }[];
  notify: (decisionId: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
};

export const prodDecideDeps: DecideDeps = {
  think: (prompt, o) => thinkViaSession(prompt, o),
  repoDir: resolveRepoDir,
  liveSessions: () => {
    // SPEC-402 · bacaan tmux yang gagal MELEMPAR. Konteks "sesi tetangga" itu pelengkap, bukan
    // syarat memutuskan — kegagalannya tak boleh menggagalkan keputusan.
    try { return listSessions(); } catch { return []; }
  },
  notify: recordLeadDecision,
};

/** Judul notifikasi yang terbaca sekilas di panel — pertanyaan dipangkas, keputusan dipertahankan. */
const notifTitle = (kind: LeadKind, question: string, answer: string, confidence: string): string => {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 70);
  const a = answer.replace(/\s+/g, " ").trim().slice(0, 90);
  const tag = confidence === "ragu" ? "Lead (ragu)" : "Lead";
  return `${tag} · ${kind}: ${q ? `"${q}" → ` : ""}${a}`;
};

/**
 * Susun satu keputusan. Mengembalikan baris jejak — SELALU, termasuk saat lead gagal (status
 * `gagal`, AC-4) — atau `null` bila lead memang tak aktif untuk project itu (AC-15/30). `null`
 * berarti "tak ada yang terjadi", dan pemanggil harus memperlakukan sesi seperti sebelum PRD ini:
 * menunggu manusia.
 */
export async function decide(req: DecideRequest, deps: DecideDeps = prodDecideDeps): Promise<LeadDecision | null> {
  const p = await prepareDecision(req, deps);
  if (!p) return null;

  // ADR-0228 · tak ada lagi gerbang konkurensi: proses mahal kini satu pane per proyek yang hidup
  // terus, dan antreannya adalah inbox (DB), bukan slot in-memory. `markDeciding` tetap dipasang
  // supaya route terminal tahu sesi pekerja sedang ditunggu jawabannya.
  let eventId: string | null = null;
  if (req.sessionId) markDeciding(req.sessionId);
  let raw: string;
  try {
    raw = await deps.think(p.prompt, {
      projectId: req.projectId, gate: req.gate, kind: req.kind, question: req.question,
      options: p.options, select: req.select ?? null, sessionId: req.sessionId ?? null,
      specId: req.specId ?? null, timeoutMs: p.timeoutMs, onEvent: (id) => { eventId = id; },
    });
  } catch (e) {
    const row = await fail(req, deps, `lead tak menghasilkan keputusan: ${(e as Error).message}`, p.flowId, p.step, eventId);
    return closeAfter(row, p.flowId, req.chain);
  } finally {
    if (req.sessionId) clearDeciding(req.sessionId);
  }
  return finalizeDecision(p, raw, deps, eventId);
}

/**
 * ADR-0228 · separuh PERTAMA `decide()`: semua yang terjadi sebelum otak dipanggil — gerbang aktif,
 * alur, bukti, prompt. Dipakai juga `post.ts` untuk event denyut yang tak ditunggu siapa pun.
 * `null` = lead tak aktif untuk project itu.
 */
export type PreparedDecision = {
  req: DecideRequest; flowId: string; step: number; prompt: string; repoDir: string | null;
  options: string[]; bounds: ReturnType<typeof normalizeSelect>; timeoutMs: number;
};

export async function prepareDecision(req: DecideRequest, deps: DecideDeps = prodDecideDeps): Promise<PreparedDecision | null> {
  const cfg = await getLead();
  if (!leadActive(cfg, req.projectId)) return null;

  // SPEC-485 · ADR-0102 · alur dipasang di sini karena `decide()` adalah choke point tunggal ketiga
  // pintu (ADR-0091 G6) — tempat yang sama yang sudah memegang gerbang konkurensi SPEC-479.
  // Gerbang "alur tertutup" duduk SEBELUM panggilan agen: menolaknya sesudah berarti membakar satu
  // proses `claude -p` untuk permintaan yang memang tak boleh masuk.
  const flow = req.flowId ? await joinFlow(req.flowId) : await openFlow({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    gate: req.gate, title: req.question, ttlMin: cfg.flowTtlMin,
  });
  const step = flow.steps + 1;

  const project = await prisma.project.findUnique({ where: { id: req.projectId }, select: { name: true } });
  const spec = req.specId
    ? await prisma.spec.findUnique({
        where: { id: req.specId },
        select: { id: true, title: true, objective: true, stage: true, priority: true },
      })
    : null;
  const repoDir = await deps.repoDir(req.projectId).catch(() => null);
  const prior = await prisma.leadDecision.findMany({
    where: { projectId: req.projectId, status: "berlaku" },
    orderBy: { createdAt: "desc" }, take: 10,
  });
  // SPEC-485 · langkah rantai ini sendiri — dibaca hanya saat memang melanjutkan, supaya alur
  // tunggal tak membayar satu query untuk daftar yang pasti kosong.
  const chainRows = req.flowId
    ? await prisma.leadDecision.findMany({ where: { flowId: flow.id }, orderBy: { createdAt: "asc" }, take: 10 })
    : [];

  const options = req.options ?? [];
  const bounds = normalizeSelect(req.select ?? { mode: "single", min: 0, max: null }, options.length);
  const timeoutMs = await thinkTimeoutMs(req.projectId, req.gate, req.kind);

  const ctx: LeadContext = {
    projectId: req.projectId,
    projectName: project?.name ?? req.projectId,
    repoDir,
    // SPEC-432 · anggaran yang disebut prompt WAJIB angka yang sama dengan tenggat sebenarnya.
    // ADR-0228 · tenggat itu kini milik inbox (`answerSlaSec` / `deliverTimeoutSec`), bukan proses.
    timeoutSec: Math.round(timeoutMs / 1000),
    spec,
    liveSessions: deps.liveSessions()
      .filter((s) => !s.exited && s.projectId === req.projectId && s.id !== req.sessionId)
      .map((s) => ({ id: s.id, specId: s.specId, flow: s.flow, branch: s.branch })),
    priorDecisions: prior.map((d) => ({
      question: d.question, answer: d.answer, reason: d.reason, createdAt: d.createdAt.toISOString(),
    })),
    notes: req.notes,
    select: bounds,
    chainSteps: chainRows.map((d) => ({
      question: d.question,
      options: Array.isArray(d.options) ? (d.options as unknown[]).map(String) : [],
      picked: Array.isArray(d.choices)
        ? (d.choices as { option?: unknown }[]).map((c) => String(c?.option ?? "")).filter(Boolean)
        : (d.choice ? [d.choice] : []),
    })),
  };

  const prompt = leadPrompt({ kind: req.kind, question: req.question, options: req.options }, ctx);
  return { req, flowId: flow.id, step, prompt, repoDir, options, bounds, timeoutMs };
}

/**
 * ADR-0228 · separuh KEDUA `decide()`: dari keluaran otak sampai baris jejak + notifikasi. Dipakai
 * juga `post.ts` saat event denyut dijawab pane atau izinnya disetujui manusia.
 */
export async function finalizeDecision(
  p: PreparedDecision, raw: string, deps: DecideDeps = prodDecideDeps, eventId: string | null = null,
): Promise<LeadDecision> {
  const { req, repoDir, options, bounds, step } = p;
  const flow = { id: p.flowId };
  const verdict = parseLeadVerdict(raw);
  // AC-22 melarang keraguan berakhir tanpa keputusan; ini kasus LAIN — agen tak mengembalikan
  // bentuk yang bisa dibaca sama sekali. Menebak isinya lebih berbahaya daripada jatuh ke manusia.
  if (!verdict) return closeAfter(await fail(req, deps, "keluaran lead tak memuat blok json keputusan yang sah", flow.id, step, eventId), flow.id, req.chain);

  const refs = keepExistingRefs(verdict.refs, repoDir);
  const allowed = leadActionAllowed(verdict.action);
  const kind: LeadKind = allowed ? req.kind : "refusal";

  // SPEC-480 · pilihan sebagai DATA. `options` kosong = peminta memang tak menyodorkan menu; di
  // situ `choice` tak punya arti dan tak pernah ditolak.
  //
  // SPEC-485 · dan pilihannya SELALU daftar. `choices` kosong + `choice` terisi dibaca sebagai satu
  // pilihan: keluaran agen berbentuk ADR-0098 harus tetap terpakai, dan menuntut field baru berarti
  // setiap agen lama mendadak "tak memilih apa pun".
  const rawChoices = verdict.choices.length ? verdict.choices
    : (verdict.choice.trim() ? [verdict.choice] : []);
  const resolved = resolveChoices(rawChoices, options);
  const countProblem = options.length && resolved.choices.length
    ? checkChoiceCount(resolved.choices.length, bounds) : null;
  // Jumlah di luar batas MEMBATALKAN seluruh pilihan, bukan memangkasnya: memilih 3 dari maksimum 2
  // adalah pertanda lead salah membaca soal, dan mengambil dua di antaranya secara sewenang-wenang
  // persis tebakan yang ADR-0098 ada untuk menghapusnya.
  const choices = countProblem ? [] : resolved.choices;
  const choice = choices[0] ?? null;
  const choiceRejected = options.length > 0 && rawChoices.length > 0
    && (resolved.rejected.length > 0 || !!countProblem);
  const missing = verdict.missing.map((m) => m.trim()).filter(Boolean);

  // SPEC-480 · tindakan boleh DITURUNKAN dari opsi terpilih, tapi hanya saat lead diam. Label opsi
  // dirakit PEMINTA ("integrate-main — …"), jadi hint-nya bukan tebakan atas maksud agen; yang tak
  // pernah ditebak adalah pertentangan — di sana tindakan dibatalkan dan operator diberi tahu.
  let action: LeadAction = allowed ? (verdict.action as LeadAction) : "none";
  let actionNote = "";
  let conflict = false;
  // SPEC-485 · hint hanya berlaku saat pilihannya TEPAT SATU. Menurunkan satu tindakan dari
  // gabungan beberapa opsi adalah tebakan, dan tebakan yang kelihatan benar sudah pernah membuat
  // lead memutuskan Node 22 lalu memilih Node 20 (SPEC-452).
  if (allowed && choices.length === 1 && choice) {
    const hint = optionActionHint(choice.option);
    if (hint && action === "none" && hint !== "none") {
      action = hint;
      actionNote = `Tindakan diturunkan dari opsi terpilih ("${hint}") karena lead tak menyebutnya sendiri (SPEC-480).`;
    } else if (hint && action !== "none" && action !== hint) {
      conflict = true;
      actionNote = `KONFLIK: lead memilih opsi "${choice.option}" tetapi menyetel action "${action}" — tindakan dibatalkan (SPEC-480).`;
      action = "none";
    }
  }

  // `missing` terisi ⇒ ragu, apa pun yang ditulis lead. Menyatakan konteksnya kurang DAN mengaku
  // yakin adalah dua hal yang tak bisa benar bersamaan.
  const confidence = missing.length ? "ragu" : verdict.confidence;

  const notes: string[] = [];
  if (!allowed) notes.push(`DITOLAK: ${leadRefusalReason(verdict.action)} berada di luar permukaan tindakan lead (ADR-0091 · AC-31/32).`);
  // `options` kosong = peminta memang tak menyodorkan menu; di situ pilihan tak punya arti dan tak
  // pernah ditolak (SPEC-480). `resolveChoices` tetap memulangkannya sebagai `rejected` — gerbangnya
  // di sini, bukan di helper murni itu.
  if (options.length && resolved.rejected.length)
    notes.push(`DITOLAK: pilihan ${resolved.rejected.map((r) => `"${r.slice(0, 120)}"`).join(", ")} tidak ada di daftar opsi yang dikirim peminta (SPEC-480 · ADR-0098).`);
  if (countProblem)
    notes.push(`DITOLAK: ${countProblem} (SPEC-485 · ADR-0102) — seluruh pilihan dibatalkan, bukan dipangkas.`);
  if (actionNote) notes.push(actionNote);
  if (missing.length) notes.push(`KONTEKS KURANG: ${missing.join("; ")}`);
  const tail = notes.length ? `\n\n${notes.join("\n\n")}` : "";

  const weighty = isWeightyDecision({ kind, action, confidence }) || choiceRejected || conflict;

  const row = await recordDecision({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    // Jejak menyimpan prosa lead UTUH: yang dipangkas hanya yang DIKIRIM (SPEC-480). Jejak adalah
    // tempat orang mencari kenapa sebuah putusan diambil; memangkasnya di sini menukar putusan
    // yang bertele-tele dengan putusan yang tak bisa diaudit.
    gate: req.gate, kind, question: req.question, answer: verdict.decision,
    reason: `${verdict.reason}${tail}`,
    refs, confidence, action, weighty,
    choice: choice?.option ?? null, choiceIndex: choice?.index ?? null,
    choices, select: bounds, flowId: flow.id, step,
    options, missing, eventId,
  });
  // SPEC-485 · alur diurus SESUDAH barisnya ditulis, di satu tempat untuk jalur sukses maupun
  // gagal (`closeAfter`). Alur tunggal ditutup apa pun status barisnya: baris `gagal` di dalam alur
  // `selesai` adalah jejak yang jujur, sementara menandainya `dibatalkan` akan mencampur "operator
  // membatalkan" dengan "lead tak sanggup" (ADR-0102 gotcha 7).
  await closeAfter(row, flow.id, req.chain);
  if (weighty) {
    await deps.notify(row.id, notifTitle(kind, req.question, verdict.decision, confidence),
      req.projectId, req.specId ?? null, req.sessionId ?? null);
  }
  // Putusan "sebagaimana dikirim": terpangkas di batas kalimat, catatan penolakan ditempelkan
  // SESUDAH pemangkasan supaya justru bagian yang paling perlu dibaca tak ikut terpotong.
  lastDelivery.set(row.id, {
    decision: clampProse(verdict.decision, LEAD_DECISION_MAX),
    reason: `${clampProse(verdict.reason, LEAD_REASON_MAX)}${tail}`,
    reply: verdict.reply,
    choices, choice, missing,
  });
  return row;
}

/**
 * SPEC-485 · satu tempat yang tahu bahwa alur harus dimajukan dan — bila ia tak berantai — ditutup,
 * bahkan ketika langkahnya gagal. Dipakai jalur sukses maupun kedua jalur `fail()`; dua salinan
 * yang tak sepakat adalah kelas bug SPEC-431/448/475 pada bentuknya yang paling licin (efek samping).
 */
async function closeAfter(row: LeadDecision, flowId: string, chain: boolean | undefined): Promise<LeadDecision> {
  await markFlowStep(flowId, row.status === "berlaku");
  if (!chain) await closeFlow(flowId, "tunggal");
  return row;
}

// Putusan sebagaimana DIKIRIM, berumur pendek: dipakai route (pintu #1) & detect.ts (pintu #2)
// sesaat setelah decide() kembali. Map (bukan kolom DB) karena isinya turunan dari baris yang
// sudah tersimpan dan tak punya nilai historis — yang bertahan adalah jejaknya, yang utuh.
const lastDelivery = new Map<string, LeadDelivery>();
export function takeDelivery(decisionId: string): LeadDelivery | null {
  const v = lastDelivery.get(decisionId) ?? null;
  lastDelivery.delete(decisionId);
  return v;
}

/**
 * AC-4 · permintaan yang tak terjawab dalam batas waktu (atau keluarannya tak terbaca) dicatat
 * sebagai baris `gagal` + notifikasi, dan peminta kembali ke perilaku hari ini: menunggu manusia.
 *
 * SPEC-432 · barisnya SELALU ditulis — "tak ada baris" tak bisa dibedakan dari "tak pernah
 * diminta", dan itulah seluruh alasan status `gagal` ada. Yang dijaga adalah notifikasinya:
 * kegagalan yang beruntun di pintu & jenis yang sama bukan kabar baru, ia hanya mengubur
 * notifikasi lain. Di panel operator, KETUJUH notifikasi lead yang pernah terbit berbunyi
 * "Lead gagal memutuskan" — satu keadaan rusak dilaporkan tujuh kali. Begitu satu keputusan
 * berhasil di antaranya, lead terbukti pulih dan kegagalan berikutnya jadi kabar lagi.
 */
async function fail(
  req: DecideRequest, deps: DecideDeps, reason: string,
  flowId: string | null = null, step: number | null = null, eventId: string | null = null,
): Promise<LeadDecision> {
  const prev = await prisma.leadDecision.findFirst({
    where: { projectId: req.projectId, gate: req.gate, kind: req.kind },
    orderBy: { createdAt: "desc" }, select: { status: true },
  });
  const row = await recordDecision({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    gate: req.gate, kind: req.kind, question: req.question,
    answer: "", reason, refs: [], confidence: "ragu", action: "none",
    // SPEC-485 · langkah yang gagal tetap duduk di alurnya: alur yang seluruh langkahnya gagal
    // harus tetap terbaca sebagai satu urusan, bukan sebagai baris yatim.
    flowId, step, eventId,
    status: "gagal", weighty: true,
  });
  if (prev?.status !== "gagal") {
    await deps.notify(row.id, `Lead gagal memutuskan: ${req.question.replace(/\s+/g, " ").slice(0, 90)}`,
      req.projectId, req.specId ?? null, req.sessionId ?? null);
  }
  return row;
}
