// Rail sesi & mode tampilan Terminal (Audit UI/UX 2026-10 · Fase 3E). Modul murni: tanpa React,
// tanpa xterm — urutan, status, fallback fokus, dan navigasi keyboard diuji langsung di sini.
import type { TerminalSession } from "../api/client";
import { oneOf } from "../ui-state";

// Default = "focus": satu pane fokus + rail. "grid" = workspace multi-pane kanonik (ADR-0118),
// dipilih lewat toggle dan disimpan sebagai preferensi tampilan (ADR-0115).
export type TerminalView = "focus" | "grid";
export const isTerminalView = oneOf<TerminalView>("focus", "grid");

// Keadaan yang dipakai rail. Urutan tampil: butuh keputusan → berjalan → gagal → selesai.
export type RailTone = "attention" | "running" | "failed" | "done";
export type RailStatus = { tone: RailTone; label: string };

export const RAIL_RANK: Record<RailTone, number> = { attention: 0, running: 1, failed: 2, done: 3 };

// Sumber kebenaran status = bit yang sama dengan Cell grid: `exited`/`exitCode` (SPEC-402),
// `decision`/`deciding` (ADR-0143 · keadaan turunan server), dan `finished` (verdict plan dari pane).
// `finished` hanya diketahui untuk sesi yang pernah dibuka; sesi lain dianggap berjalan.
export function railStatus(s: TerminalSession, finished: boolean): RailStatus {
  if (s.exited) {
    // `!!exitCode` sengaja: 0 dan undefined tetap "Selesai" (sama dengan Cell).
    return s.exitCode
      ? { tone: "failed", label: `Gagal · exit ${s.exitCode}` }
      : { tone: "done", label: "Selesai" };
  }
  if (s.deciding) return { tone: "attention", label: "Lead memutuskan" };
  if (s.decision) return { tone: "attention", label: "Menunggu keputusan" };
  if (finished) return { tone: "done", label: "Selesai" };
  return { tone: "running", label: "Berjalan" };
}

// Waktu mulai sesi (ms epoch). Server mengirim `startedAt` dalam detik epoch dari tmux
// (server/src/services/pty.ts) dan 0 bila tak diketahui; tipe klien belum memuat field ini.
export function railStartedMs(s: TerminalSession): number | null {
  const raw = (s as { startedAt?: unknown }).startedAt;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw * 1000 : null;
}

// Urutan rail: dikelompokkan menurut RAIL_RANK; di dalam grup "butuh keputusan" yang paling lama
// menunggu tampil lebih dulu (decisionAt naik, tanpa stempel di bawah). Grup lain mempertahankan
// urutan masuk, supaya baris tak melompat tiap WS frame.
export function sortRail(sessions: readonly TerminalSession[], finishedIds: ReadonlySet<string>): TerminalSession[] {
  const ranked = sessions.map((session, index) => ({
    session, index, rank: RAIL_RANK[railStatus(session, finishedIds.has(session.id)).tone],
  }));
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank === RAIL_RANK.attention) {
      const ta = a.session.decisionAt ? Date.parse(a.session.decisionAt) : Number.NaN;
      const tb = b.session.decisionAt ? Date.parse(b.session.decisionAt) : Number.NaN;
      const ka = Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
      const kb = Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
      if (ka !== kb) return ka < kb ? -1 : 1;
    }
    return a.index - b.index;
  });
  return ranked.map((r) => r.session);
}

// Sesi yang tampil di pane fokus: `focusId` bila masih hidup, selain itu baris pertama rail.
// Kosong bila tak ada sesi sama sekali.
export function resolveFocus(ordered: readonly TerminalSession[], focusId: string | null): TerminalSession | null {
  if (focusId) {
    const hit = ordered.find((s) => s.id === focusId);
    if (hit) return hit;
  }
  return ordered[0] ?? null;
}

// Navigasi keyboard rail (ARIA listbox-style): ↑/↓ berpindah baris tanpa berputar, Home/End ke
// ujung. Mengembalikan indeks tujuan, atau null bila tombolnya bukan tombol navigasi.
export function railTarget(current: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  const at = current < 0 ? 0 : current;
  switch (key) {
    case "ArrowDown": return Math.min(at + 1, length - 1);
    case "ArrowUp": return Math.max(at - 1, 0);
    case "Home": return 0;
    case "End": return length - 1;
    default: return null;
  }
}
