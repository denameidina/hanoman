import type { Notification } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";

// SPEC-184 · ke mana aksi notifikasi mengarahkan. decision → terminal (fokus sesi yang menunggu).
// done → terminal bila sesinya masih hidup, kalau tidak Backlog item-nya.
// Sesi decision yang sudah berakhir TETAP dibawa sebagai `focus`: daftar `sessions` di sini bisa tertinggal,
// jadi keputusan "hidup atau tidak" milik layar Terminal (daftar WS-nya sendiri), yang lalu menjelaskan
// keadaannya alih-alih memfokus sesi lain (TerminalScreen, efek focusSession).
export function notifTarget(n: Notification, sessions: TerminalSession[]): { section: string; projectFilter?: string; focus?: string } {
  // SPEC-253 · notif tiket keluhan baru → antrean Triase project terkait.
  if (n.type === "ticket") return { section: "triage", projectFilter: n.projectId ?? undefined };
  // ADR-0181 · memori yang butuh review → halaman Memori project-nya.
  const live = n.sessionId ? sessions.find((s) => s.id === n.sessionId && !s.exited) : undefined;
  if (n.type === "decision" || live)
    return { section: "terminal", projectFilter: n.projectId ?? undefined, focus: n.sessionId ?? undefined };
  return { section: "backlog", projectFilter: n.projectId ?? undefined };
}
