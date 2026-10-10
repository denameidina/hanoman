import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { verifyScopeClause, CODE_STYLE_CLAUSE, realGit, RESUMED_WORKTREE_NOTE } from "@hanoman/runner";
import type { QaReportDetail } from "@hanoman/shared";
import { resolveRepoDir } from "./local-binding";
import { withSessionAdmission } from "./session-launch-gate";
import { createSession } from "./pty";
import { sessionAgentDefaults, getSetting } from "./settings";
import { ensureCodexTrust } from "./codex-trust";
import { readQaAttachmentBytes } from "./qa-attachment-transfer";
import { saveSessionUpload, sessionUploadDir } from "./uploads";

export class QaSessionError extends Error {
  constructor(public code: number, message: string, public needsBind = false) { super(message); }
}

// Hash avoids traversal and collisions from sanitizing arbitrary peer IDs. Session identity is LOCAL.
export const qaSessionId = (findingId: string) => `qa-${createHash("sha256").update(findingId).digest("hex").slice(0, 24)}`;

export async function startQaFindingSession(d: QaReportDetail, fid: string): Promise<{ id: string; reused: boolean }> {
  const f = d.findings.find((x) => x.id === fid);
  if (!f) throw new QaSessionError(404, "temuan tidak ditemukan");
  if (f.status === "wontfix") throw new QaSessionError(409, "Temuan ditandai tidak akan diperbaiki. Buka kembali sebelum dikerjakan.");
  if (f.spec) throw new QaSessionError(409, "Temuan sudah masuk backlog. Mulai sesi dari backlog tersebut.");
  const repoDir = await resolveRepoDir(d.projectId);
  if (!repoDir) throw new QaSessionError(400, "Project belum terikat ke repo lokal", true);
  const id = qaSessionId(fid);
  return withSessionAdmission<{ id: string; reused: boolean }>({ id }, async () => {
    const linkedCase = d.cases.find((c) => c.id === f.caseId);
    const attachments = d.attachments.filter((a) => a.ownerType === "report" ||
      (a.ownerType === "finding" && a.ownerId === fid) || (a.ownerType === "case" && a.ownerId === linkedCase?.id));
    const files: string[] = [];
    for (const a of attachments) {
      const bytes = await readQaAttachmentBytes(a.id);
      if (!bytes) throw new QaSessionError(409, `Lampiran belum tersedia: ${a.filename}. Sinkronkan QA lalu coba lagi.`);
      const saved = await saveSessionUpload(id, bytes, a.mimeType);
      files.push(`${JSON.stringify(a.filename)} (${a.mimeType}): ${saved.path}`);
    }
    const wt = join(repoDir, ".worktrees", id);
    const branch = `qa/${id.slice(3)}`;
    const reused = realGit.worktreeAlive(wt);
    try {
      if (!reused) {
        // Keep the prior branch after closing a session, so a later launch retains committed fixes.
        const base = realGit.revParse(repoDir, branch) ? branch : "HEAD";
        realGit.addWorktree(repoDir, wt, base);
        execFileSync("git", ["checkout", "-B", branch], { cwd: wt, encoding: "utf8" });
      }
    } catch (e) { throw new QaSessionError(422, `Gagal membuat worktree QA: ${(e as Error).message}`); }
    const verifyScope = (await getSetting()).verifyScope;
    const baseSha = realGit.headSha(wt);
    const { agent, model, effort } = await sessionAgentDefaults();
    if (agent === "codex") ensureCodexTrust(repoDir);
    const prompt = [
      `hanoman · perbaiki temuan QA ${f.code}: ${f.title}`,
      `Project ${d.projectId}; laporan ${d.code}: ${d.title}; reportId=${d.id}; findingId=${fid}.`,
      "Baca instruksi project dan docs Source of Truth. Audit penyebab, pilih perbaikan yang sesuai, lakukan dan verifikasi. Untuk temuan kecil langsung execute; bila perlu desain/spec/plan tulis dokumennya di worktree ini. Jangan membuat backlog terlebih dahulu.",
      `Build: ${d.buildVersion}\nLingkungan: ${JSON.stringify(d.environment)}\nCakupan: ${d.scope}\nRingkasan laporan: ${d.summary}`,
      `Dampak: ${f.severity}; prioritas: ${f.priority}; area: ${f.area}\nRepro:\n${f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nExpected:\n${f.expected}\nActual:\n${f.actual}`,
      linkedCase ? `Langkah uji terkait ${linkedCase.code}: ${linkedCase.title}\n${linkedCase.steps}\nExpected: ${linkedCase.expected}\nActual: ${linkedCase.actual}\nStatus: ${linkedCase.status}` : "",
      files.length ? `Lampiran konteks (baca berkas berikut):\n${files.join("\n")}` : "",
      `Kerjakan pada branch ${branch}. Laporkan perubahan, bukti verifikasi dan langkah retest; integrasi diputuskan operator melalui Terminal. Jangan menandai temuan selesai sebelum retest operator.`,
      verifyScopeClause(verifyScope), CODE_STYLE_CLAUSE, reused ? RESUMED_WORKTREE_NOTE : "",
    ].filter(Boolean).join("\n\n");
    const s = createSession(d.projectId, wt, {
      id, branch, agent, model, effort, prompt,
      env: { HANOMAN_BASE_SHA: baseSha, HANOMAN_VERIFY_SCOPE: verifyScope },
      attachmentsDir: files.length ? sessionUploadDir(id) : undefined,
    });
    return { id: s.id, reused: false };
  }, (pane) => ({ id: pane.id, reused: true }));
}
