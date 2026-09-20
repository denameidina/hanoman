import type { Phase } from "./session-phases";
import { readPhasesAsync } from "./session-phases";
import { listPanesShared } from "./presence/snapshot";

export type LivePhases = Map<string, { phases: Phase[]; cwd: string }>;

// SPEC-1267 · padanan asinkron `sessionPhasesBySpec` (dulu di pty.ts) untuk jalur periodik: `list-panes`
// lewat `listPanesShared` (memo 1 dtk, dibagi dengan presence) dan berkas fase lewat cache mtime,
// jadi tak ada `execFileSync`/`readFileSync` yang menahan event loop yang sama dengan frame PTY.
// Lunak seperti aslinya: tmux tak terbaca → peta kosong (overlay hanya maju, tak ada yang mundur).
export async function sessionPhasesBySpecAsync(): Promise<LivePhases> {
  const out: LivePhases = new Map();
  let panes: Awaited<ReturnType<typeof listPanesShared>>;
  try { panes = await listPanesShared(); } catch { return out; }
  await Promise.all(panes.map(async (p) => {
    if (!p.specId || !p.flow || !p.phaseFile) return;
    out.set(p.specId, { phases: await readPhasesAsync(p.phaseFile, p.flow), cwd: p.cwd });
  }));
  return out;
}
