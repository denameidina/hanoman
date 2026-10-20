import {
  isSensitiveText, leadActionAllowed,
  type Lead, type LeadAction, type LeadEventKind, type LeadRefusalCode,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { getLead } from "./config";
import { authorityFor, leadProjectConfig } from "./project-config";
import { launchBudget, type Budget } from "./budget";
import { blockersForSpec } from "../spec-deps";
import { resolveRepoDir } from "../local-binding";
import { assertLaunchApproved } from "../launch-authority";
import { sessionIdForSpec } from "../session-id";
import { getSessionAsync } from "../pty";
import { liveAsks } from "./ask";

// ADR-0228 · GERBANG TINDAKAN LEAD. Deterministik, di server, tak bisa dilewati pane lead: lead
// boleh salah menilai, ia tak boleh salah BERTINDAK. Urutan: event masih terbuka → allowlist →
// aturan objektif tindakan → mode wewenang. Aturan objektif dinilai lebih dulu supaya manusia tak
// pernah dimintai izin untuk tindakan yang mustahil lolos.

export type GuardSpec = {
  id: string; projectId: string; stage: string; baseSha: string | null; objective: string;
  launchApprovedAt: Date | null; dependsOn: unknown; branchFrom: string | null;
};
export type GuardInput = {
  projectId: string; eventKind: LeadEventKind; eventOpen: boolean; action: string;
  specId: string | null; sessionId: string | null; decision: string; choices: string[];
  reason: string; evidence: string[];
};
export type GuardResult = { outcome: "lolos" | "butuh-izin" | "ditolak"; code?: LeadRefusalCode; report: string[] };
export type GuardDeps = {
  cfg: () => Promise<Lead>;
  budget: (projectId: string) => Promise<Budget>;
  spec: (id: string) => Promise<GuardSpec | null>;
  blockers: (spec: GuardSpec) => Promise<string[]>;
  sessionLive: (id: string) => Promise<boolean>;
  sessionWaiting: (id: string) => boolean;
  approved: (spec: GuardSpec) => boolean;
};

export const prodGuardDeps: GuardDeps = {
  cfg: getLead,
  budget: (p) => launchBudget(p),
  spec: (id) => prisma.spec.findUnique({ where: { id }, select: {
    id: true, projectId: true, stage: true, baseSha: true, objective: true,
    launchApprovedAt: true, dependsOn: true, branchFrom: true,
  } }),
  blockers: async (s) => (await blockersForSpec(s, await resolveRepoDir(s.projectId))).map((b) => `${b.id} (${b.reason})`),
  sessionLive: async (id) => { const s = await getSessionAsync(id).catch(() => undefined); return !!s && !s.exited; },
  sessionWaiting: (id) => liveAsks().some((a) => a.sessionId === id),
  approved: (s) => { try { assertLaunchApproved(s); return true; } catch { return false; } },
};

const no = (code: LeadRefusalCode, ...report: string[]): GuardResult => ({ outcome: "ditolak", code, report });

export async function checkAct(i: GuardInput, deps: GuardDeps = prodGuardDeps): Promise<GuardResult> {
  if (!i.eventOpen) return no("event-closed", "event sudah ditutup (dijawab manusia atau lewat tenggat)");
  if (!leadActionAllowed(i.action)) return no("action-locked", `tindakan "${i.action}" di luar permukaan tindakan lead`);
  const action = i.action as LeadAction;
  const cfg = await deps.cfg();
  const mode = authorityFor(cfg, i.projectId, action);
  if (mode === "off") return no("authority-off", `wewenang "${action}" dimatikan untuk proyek ini`);
  const report: string[] = [];
  let mustAsk = mode === "ask";
  if (mustAsk) report.push(`wewenang "${action}" = minta izin`);

  switch (action) {
    case "start-session": {
      if (!i.reason.trim()) return no("no-reason", "alasan kosong");
      if (!i.specId) return no("spec-empty", "tak menunjuk backlog");
      const specId = i.specId;
      if (!i.evidence.some((e) => e.toLowerCase().includes(specId.toLowerCase())))
        return no("no-evidence", `bukti tak merujuk ${specId} — baca spec/plan-nya dulu`);
      const s = await deps.spec(specId);
      if (!s || s.projectId !== i.projectId) return no("spec-empty", `backlog ${specId} tak ada di proyek ini`);
      if (s.stage === "done") return no("spec-done", `${s.id} sudah selesai`);
      if (!s.objective.trim()) return no("spec-empty", `${s.id} belum punya objective`);
      if (!deps.approved(s)) return no("spec-not-approved", `${s.id} belum disetujui untuk diluncurkan`);
      const blocked = await deps.blockers(s);
      if (blocked.length) return no("blocked", `${s.id} menunggu ${blocked.join(", ")}`);
      if (await deps.sessionLive(sessionIdForSpec(s.id))) return no("session-live", `${s.id} sudah punya sesi hidup`);
      const b = await deps.budget(i.projectId);
      if (b.n < 1) return no("budget-zero", ...(b.reasons.length ? b.reasons : ["jatah peluncuran 0"]));
      report.push(`jatah tersisa ${b.n}`);
      break;
    }
    case "answer-session": {
      if (!i.sessionId) return no("no-session", "tak menunjuk sesi");
      if (!deps.sessionWaiting(i.sessionId)) return no("not-waiting", `sesi ${i.sessionId} tak lagi menunggu jawaban`);
      break;
    }
    case "integrate-main": {
      if (!i.sessionId && !i.specId) return no("no-session", "tak menunjuk sesi/backlog");
      if (!leadProjectConfig(cfg, i.projectId).verifyCommand.trim()) {
        mustAsk = true; report.push("tak ada perintah verifikasi — test tak bisa dibuktikan server");
      }
      break;
    }
    case "stop-session": case "resume-session": case "restart-session": {
      if (!i.sessionId && !i.specId) return no("no-session", "tak menunjuk sesi/backlog");
      break;
    }
    default: break;
  }
  // Jawaban atas PERTANYAAN (pintu deteksi maupun kontrak) dijalankan oleh peminta, apa pun
  // `action`-nya — jawaban kontrak ber-`none` tetap bisa berbunyi "deploy sekarang". Karena itu
  // daftar sensitif menilai teks jawabannya untuk SETIAP event `ask`, bukan hanya `answer-session`
  // (celah yang ditemukan uji nyata ADR-0228).
  if (i.eventKind === "ask" && isSensitiveText([i.decision, ...i.choices].join("\n"))) {
    mustAsk = true; report.push("jawaban menyentuh daftar sensitif (produksi/kredensial/akun/data/deploy)");
  }
  return { outcome: mustAsk ? "butuh-izin" : "lolos", report };
}
