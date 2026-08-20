import { execFile } from "node:child_process";
import { zAgentReply, TEKS_TETAP, type PortalChatType } from "@hanoman/shared";
import { prisma } from "../../db";
import { newNonce } from "./guard-input";
import { guardReply } from "./guard-output";
import { renderTurnPrompt, systemPromptFor, type TurnHistory } from "./prompt";
import { buildChatWorkspace } from "./workspace";
import { portalChatProcess } from "./argv";

// SPEC-854 · ADR-0129 · SATU-SATUNYA tempat di seluruh jalur klien yang melahirkan proses agen.
// Titik cekik disengaja: gerbang boleh berlapis, tapi kalau ada dua tempat yang men-spawn maka
// cepat atau lambat keduanya berselisih (kelas bug SPEC-431/448/475).

export type TurnResult = {
  reply: string; blocked: boolean; reasons: string[]; raw: string | null;
  summary: string; prd: string | null; escapeAttempts: number;
};

const gagal = (reasons: string[]): TurnResult => ({
  reply: TEKS_TETAP.gagal, blocked: true, reasons, raw: null,
  summary: "", prd: null, escapeAttempts: 0,
});

/**
 * Sebab gagal hidup di EKOR keluaran, dan agen CLI tak sepakat soal stream-nya — pelajaran
 * SPEC-472, yang di sana menghasilkan 152 baris jejak identik tanpa satu pun petunjuk. `execFile`
 * menyusun `err.message` sebagai `Command failed: <argv…>`, dan argumen terakhir kita adalah
 * PROMPT: memakainya berarti menulis seluruh percakapan klien ke log alih-alih sebabnya.
 */
const EKOR = 500;
const ekor = (v: string) => {
  const t = v.trim();
  return t.length > EKOR ? `…${t.slice(-EKOR)}` : t;
};
export function chatFailureReason(err: {
  message: string; code?: number | string; signal?: NodeJS.Signals | null; killed?: boolean;
}, stdout: string, stderr: string, timeoutMs: number): string {
  if (err.killed) return `chat portal kehabisan waktu ${timeoutMs} ms`;
  const dariErr = err.message.startsWith("Command failed:") ? "" : err.message;
  const detail = [ekor(stderr), ekor(stdout)].filter(Boolean).join(" · ")
    || ekor(dariErr) || "tanpa keluaran";
  const bagaimana = err.signal ? `sinyal ${err.signal}` : `exit ${err.code ?? "?"}`;
  return `chat portal gagal (${bagaimana}): ${detail}`;
}

function runProcess(
  p: { file: string; args: string[]; cwd?: string }, timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(p.file, p.args, {
      cwd: p.cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
      killSignal: "SIGTERM",
    }, (err, stdout, stderr) => (err
      ? reject(new Error(chatFailureReason(
          err as unknown as Parameters<typeof chatFailureReason>[0], stdout, stderr, timeoutMs)))
      : resolve(stdout)));
    // SPEC-448 · tutup stdin: `claude -p` membaca stdin sebagai sumber prompt alternatif dan
    // menunggu 3 detik penuh pada pipa hidup-tapi-bisu sebelum menyerah.
    child.stdin?.end();
  });
}

export async function runTurn(o: {
  projectId: string; type: PortalChatType; history: TurnHistory[]; message: string;
  model: string; effort: string; timeoutSec: number;
}): Promise<TurnResult> {
  const project = await prisma.project.findUnique({
    where: { id: o.projectId }, select: { name: true } });
  if (!project) return gagal(["project-hilang"]);
  const others = await prisma.project.findMany({
    where: { id: { not: o.projectId } }, select: { id: true, name: true } });
  const otherNames = others.flatMap((p) => [p.id, p.name]);

  const nonce = newNonce();
  const ws = await buildChatWorkspace(o.projectId);
  let stdout: string;
  try {
    const proc = portalChatProcess({
      workspace: ws.dir, model: o.model, effort: o.effort,
      systemPrompt: systemPromptFor(o.type, nonce),
      prompt: renderTurnPrompt({ history: o.history, message: o.message, nonce }),
    });
    stdout = await runProcess(proc, o.timeoutSec * 1000);
  } catch (error) {
    // Sebab teknisnya sengaja TIDAK ikut ke klien (huruf E) — ia hidup di log server saja.
    console.warn(`[portal-chat] project ${o.projectId}: `
      + (error instanceof Error ? error.message : String(error)));
    return gagal(["agen-gagal"]);
  } finally {
    ws.cleanup();
  }

  let envelope: { structured_output?: unknown; permission_denials?: unknown[] };
  try { envelope = JSON.parse(stdout); } catch { return gagal(["keluaran-tak-terbaca"]); }
  const parsed = zAgentReply.safeParse(envelope.structured_output);
  if (!parsed.success) return gagal(["keluaran-tak-sesuai-skema"]);
  const reply = parsed.data;
  const escapeAttempts = Array.isArray(envelope.permission_denials)
    ? envelope.permission_denials.length : 0;

  // Keluar topik dijawab kalimat karangan SERVER: kalau teks penolakan boleh datang dari agen,
  // pesan yang disusupi bisa mengarang penolakannya sendiri.
  if (reply.keluar_topik)
    return { reply: TEKS_TETAP.keluarTopik, blocked: false, reasons: ["keluar-topik"],
      raw: reply.balasan, summary: reply.ringkasan, prd: null, escapeAttempts };

  const guard = guardReply(reply.balasan, { projectName: project.name, otherNames });
  // PRD tak melewati gerbang klien — ia dokumen untuk operator dan tak pernah dikirim ke portal.
  const prd = o.type === "brainstorm" && reply.prd_siap ? reply.prd : null;
  return {
    reply: guard.text, blocked: guard.blocked, reasons: guard.reasons,
    raw: guard.blocked ? reply.balasan : null,
    summary: reply.ringkasan, prd, escapeAttempts,
  };
}
