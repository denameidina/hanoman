import { MAX_PRESENCE_SESSIONS, type PresenceSession } from "@hanoman/shared";
import { listPanesAsync, type Pane } from "../pty";
import { readPhases } from "../session-phases";

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

/** Snapshot mesin ini. Dipakai klien (untuk dikirim) DAN hub (untuk dirinya sendiri).
    Dipotong di plafon supaya frame tak pernah menabrak `maxPayload` socket sync. */
export async function buildLocalPresence(): Promise<PresenceSession[]> {
  const panes = await listPanesAsync();
  return panes.slice(0, MAX_PRESENCE_SESSIONS).map((p) => paneToPresence(p, activePhase(p)));
}
