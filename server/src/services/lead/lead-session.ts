import type { Agent, LeadSessionView } from "@hanoman/shared";
import { realGit } from "@hanoman/runner";
import { prisma } from "../../db";
import { createSession, getSessionAsync, killSession } from "../pty";
import { resolveRepoDir } from "../local-binding";
import { ensureCodexTrust } from "../codex-trust";
import { getLead, leadActive, leadAgentDefaults, leadProjects } from "./config";
import { leadProjectConfig } from "./project-config";
import { leadSystemPrompt } from "./lead-prompt";
import { setEnsureLeadSession } from "./session-think";
import { humanActiveAt } from "./human-input";

export { noteHumanInput, humanActiveAt } from "./human-input";

// ADR-0228 · SATU pane lead per proyek. Id deterministik (pola `cronSessionId`, ADR-0112): pane
// hidup `lead-<proyek>` adalah satu-satunya bukti yang dibutuhkan dan selamat dari restart.
// `sessionKind` → `lead` → `launchClass: "terminal"`: pane lead bukan pekerjaan backlog dan tak
// boleh memakan slot cap agen. Tak lewat `withSessionAdmission` dengan alasan yang sama — lead yang
// tak bisa lahir karena cap penuh justru tak bisa memutuskan sesi mana yang dilepas.

export const leadSessionId = (projectId: string): string =>
  `lead-${projectId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
export const isLeadSessionId = (id: string): boolean => id.startsWith("lead-");

const BACKOFF_MS = [60_000, 120_000, 300_000];
type State = { failures: number; retryAt: number; delivered: number; restarts: number };
const states = new Map<string, State>();
export function __resetLeadSessions(): void { states.clear(); }
function st(projectId: string): State {
  let s = states.get(projectId);
  if (!s) { s = { failures: 0, retryAt: 0, delivered: 0, restarts: 0 }; states.set(projectId, s); }
  return s;
}

export type LeadSessionDeps = {
  active: (projectId: string) => Promise<boolean>;
  live: (id: string) => Promise<boolean>;
  repoDir: (projectId: string) => Promise<string | null>;
  prepareWorktree: (repoDir: string, id: string, branch: string) => string;
  agent: () => Promise<{ agent: Agent; model: string; effort: string }>;
  create: (id: string, projectId: string, cwd: string, o: { agent: Agent; model: string; effort: string; prompt: string; env: Record<string, string> }) => void;
  kill: (id: string) => boolean;
  project: (projectId: string) => Promise<{ name: string; targetBranch: string } | null>;
  now: () => number;
};

export const prodLeadSessionDeps: LeadSessionDeps = {
  active: async (p) => leadActive(await getLead(), p) && (await leadProjects()).includes(p),
  live: async (id) => { const s = await getSessionAsync(id).catch(() => undefined); return !!s && !s.exited; },
  repoDir: resolveRepoDir,
  // Worktree BACA, dibuat ulang tiap kelahiran supaya lead melihat HEAD target terbaru. CLAUDE.md:
  // tak ada sesi di working tree utama. `addWorktree` merebut kembali path lama sendiri (SPEC-742).
  prepareWorktree: (repoDir, id, branch) => {
    const wt = `${repoDir}/.worktrees/${id}`;
    realGit.addWorktree(repoDir, wt, branch);
    return wt;
  },
  agent: leadAgentDefaults,
  create: (id, projectId, cwd, o) => {
    if (o.agent === "codex") ensureCodexTrust(cwd);
    createSession(projectId, cwd, { id, agent: o.agent, model: o.model, effort: o.effort, prompt: o.prompt, env: o.env });
  },
  kill: (id) => { try { return killSession(id); } catch { return false; } },
  project: async (p) => {
    const row = await prisma.project.findUnique({ where: { id: p }, select: { name: true } });
    return row ? { name: row.name, targetBranch: leadProjectConfig(await getLead(), p).targetBranch } : null;
  },
  now: Date.now,
};

/**
 * Pastikan pane lead proyek hidup. `null` = tak dibuka: lead tak aktif/proyek tak opt-in, proyek
 * belum di-bind, atau masih dalam backoff sesudah gagal lahir. Melempar saat kelahiran gagal
 * (backoff 1/2/5 menit sudah dicatat); engine mem-pause proyek sesudah 3 kegagalan beruntun.
 */
export async function ensureLeadSession(projectId: string, deps: LeadSessionDeps = prodLeadSessionDeps):
  Promise<{ id: string; started: boolean } | null> {
  const id = leadSessionId(projectId);
  if (!(await deps.active(projectId))) return null;
  if (await deps.live(id)) return { id, started: false };
  const s = st(projectId);
  if (deps.now() < s.retryAt) return null;
  const project = await deps.project(projectId);
  const repoDir = await deps.repoDir(projectId);
  if (!project || !repoDir) return null;
  try {
    const cwd = deps.prepareWorktree(repoDir, id, project.targetBranch);
    const { agent, model, effort } = await deps.agent();
    deps.create(id, projectId, cwd, {
      agent, model, effort,
      prompt: leadSystemPrompt({ projectId, projectName: project.name, targetBranch: project.targetBranch }),
      env: {
        HANOMAN_LEAD_URL: `http://127.0.0.1:${Number(process.env.PORT ?? 8787)}/api/lead-pane`,
        HANOMAN_LEAD_PROJECT: projectId,
      },
    });
    s.failures = 0; s.retryAt = 0; s.delivered = 0; s.restarts++;
    return { id, started: true };
  } catch (e) {
    s.retryAt = deps.now() + BACKOFF_MS[Math.min(s.failures, BACKOFF_MS.length - 1)]!;
    s.failures++;
    throw e;
  }
}

/** Kelahiran gagal beruntun — engine mem-pause proyek pada angka 3. */
export function leadSessionFailures(projectId: string): number { return st(projectId).failures; }

/** Hentikan pane lead. Worktree baca dibiarkan; kelahiran berikutnya membuatnya ulang. */
export function stopLeadSession(projectId: string, deps: LeadSessionDeps = prodLeadSessionDeps): boolean {
  return deps.kill(leadSessionId(projectId));
}

/** Rotasi: pane lama dihentikan, yang baru lahir dengan konteks bersih (state ada di DB). */
export async function rotateLeadSession(projectId: string, deps: LeadSessionDeps = prodLeadSessionDeps):
  Promise<{ id: string; started: boolean } | null> {
  deps.kill(leadSessionId(projectId));
  st(projectId).retryAt = 0;
  return ensureLeadSession(projectId, deps);
}

/** Catat jumlah event yang diantar ke pane sejak lahir; mengembalikan totalnya. */
export function noteDelivered(projectId: string, n: number): number {
  const s = st(projectId);
  s.delivered += n;
  return s.delivered;
}

export async function leadSessionStates(idle: (id: string) => boolean, now: number = Date.now()): Promise<LeadSessionView[]> {
  const out: LeadSessionView[] = [];
  for (const p of await leadProjects()) {
    const id = leadSessionId(p);
    const s = await getSessionAsync(id).catch(() => undefined);
    const h = humanActiveAt(id);
    out.push({
      projectId: p, sessionId: id, alive: !!s && !s.exited, idle: idle(id),
      humanActive: h !== null && now - h < 120_000, delivered: st(p).delivered, restarts: st(p).restarts,
    });
  }
  return out;
}

setEnsureLeadSession(async (p) => { await ensureLeadSession(p); });
