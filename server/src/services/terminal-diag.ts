import { appendFileSync, mkdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

// Sink diagnostik jalur input terminal. Klien mengirim peristiwa mentah papan tombol/IME lewat
// frame WS `diag`; di sini mereka mendarat sebagai JSONL per sesi supaya bisa dibaca dari CLI
// tanpa DevTools di perangkat — satu-satunya cara praktis membaca jalur input tablet.

export type DiagEvent = { t: number; k: string; v: string; n?: number };

/** Plafon per sesi. $HANOMAN_HOME juga rumah `hanoman.db`; memenuhi disknya jauh lebih merugikan
 *  daripada kehilangan diagnostik lama, jadi berkas yang lewat plafon dipangkas, bukan dirotasi. */
export const DIAG_MAX_BYTES = 2 * 1024 * 1024;

const KINDS = new Set(["key", "comp", "data", "ack", "pred"]);
/** Cermin id sesi hanoman (`spec-873`, `d1eefae8`) — dan sekaligus gerbang path traversal. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function diagFile(home: string, sessionId: string): string {
  if (!ID.test(sessionId)) throw new Error(`id sesi tak sah untuk diag: ${sessionId}`);
  return join(home, "diag", `${sessionId}.jsonl`);
}

function usable(ev: unknown): ev is DiagEvent {
  if (!ev || typeof ev !== "object") return false;
  const e = ev as Record<string, unknown>;
  return typeof e.t === "number" && typeof e.k === "string" && KINDS.has(e.k)
    && typeof e.v === "string" && (e.n === undefined || typeof e.n === "number");
}

export function appendDiag(home: string, sessionId: string, events: unknown[]): void {
  const file = diagFile(home, sessionId);
  const rows = events.filter(usable);
  if (!rows.length) return;
  mkdirSync(join(home, "diag"), { recursive: true });
  // Dipangkas SEBELUM menulis: dengan begitu batch terakhir selalu utuh di berkas, dan pemanggil
  // tak pernah menemukan berkas yang plafonnya sudah terlampaui.
  try { if (statSync(file).size > DIAG_MAX_BYTES) rmSync(file); } catch { /* belum ada */ }
  appendFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
