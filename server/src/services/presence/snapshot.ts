import { MAX_PRESENCE_SESSIONS, type LaunchStatus, type PresenceSession } from "@hanoman/shared";
import { listPanesAsync, type Pane } from "../pty";
import { readPhases } from "../session-phases";
import { getScheduler } from "../scheduler/config";
import { currentLaunchStatus } from "../session-launch-gate";
import { observePhases } from "../logs/phase-tap";

/* SPEC-919 · ADR-0148 · proyeksi pane tmux → snapshot presence.
   `cwd` SENGAJA dibuang: itulah bagian yang membuat `SessionHistory` local-only
   (schema.prisma:389) — baris yang menunjuk berkas yang tak ada di mesin penerima. */

const isoFromEpochSeconds = (s: number): string => new Date((s || 0) * 1000).toISOString();

export function paneToPresence(p: Pane, phase?: string): PresenceSession {
  return {
    sessionId: p.id,
    projectId: p.projectId,
    ...(p.specId ? { specId: p.specId } : {}),
    ...(p.flow ? { flow: p.flow } : {}),
    ...(phase ? { phase } : {}),
    agent: p.agent,
    // Presedensi: pane mati sudah berakhir apa pun isi markernya.
    status: p.exited ? "exited" : p.decision ? "waiting" : "working",
    startedAt: isoFromEpochSeconds(p.startedAt),
  };
}

/** Fase `active` sesi ini, atau undefined bila ia tak punya berkas fase (mis. konsol VPS). */
function activePhase(p: Pane): string | undefined {
  if (!p.flow || !p.phaseFile) return undefined;
  return readPhases(p.phaseFile, p.flow).find((f) => f.state === "active")?.name;
}

// SPEC-1215 · presence DAN capacity dibangun per tick 3 dtk dari pane yang sama. Memo 1 dtk supaya
// keduanya berbagi SATU `tmux list-panes` — mesin klien bisa Mac mini 8 GB (ADR-0161).
const PANES_MEMO_MS = 1_000;
let panesMemo: { at: number; value: Promise<Pane[]> } | null = null;

export function listPanesShared(now = Date.now()): Promise<Pane[]> {
  if (panesMemo && now - panesMemo.at < PANES_MEMO_MS) return panesMemo.value;
  const value = listPanesAsync();
  panesMemo = { at: now, value };
  value.catch(() => { if (panesMemo?.value === value) panesMemo = null; });
  return value;
}

/** Test-only. */
export function __resetPanesMemo(): void { panesMemo = null; }

/** Snapshot mesin ini. Dipakai klien (untuk dikirim) DAN hub (untuk dirinya sendiri).
    Dipotong di plafon supaya frame tak pernah menabrak `maxPayload` socket sync. */
export async function buildLocalPresence(): Promise<PresenceSession[]> {
  const panes = await listPanesShared();
  const rows = panes.slice(0, MAX_PRESENCE_SESSIONS).map((p) => paneToPresence(p, activePhase(p)));
  observePhases(rows.map((r) => ({ sessionId: r.sessionId, projectId: r.projectId, specId: r.specId, phase: r.phase })));
  return rows;
}

/** SPEC-1215 · ADR-0165 §9 · angka yang SAMA dengan gerbang peluncuran, bukan metrik baru. */
export async function buildLocalCapacity(): Promise<LaunchStatus> {
  return await currentLaunchStatus(await listPanesShared(), await getScheduler());
}
