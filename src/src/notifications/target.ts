import type { Notification } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";

// SPEC-184 · ke mana aksi notifikasi mengarahkan. decision → terminal (fokus sesi yang menunggu).
// done → terminal bila sesinya masih hidup, kalau tidak Backlog item-nya.
export function notifTarget(n: Notification, sessions: TerminalSession[]): { section: string; projectFilter?: string; focus?: string } {
  // SPEC-253 · notif tiket keluhan baru → antrean Triase project terkait.
  if (n.type === "ticket") return { section: "triage", projectFilter: n.projectId ?? undefined };
  // ADR-0181 · memori yang butuh review → halaman Memori project-nya.
  if (n.type === "memory") return { section: "memory", projectFilter: n.projectId ?? undefined };
  const live = n.sessionId ? sessions.find((s) => s.id === n.sessionId && !s.exited) : undefined;
  if (n.type === "decision" || live)
    return { section: "terminal", projectFilter: n.projectId ?? undefined, focus: n.sessionId ?? undefined };
  return { section: "backlog", projectFilter: n.projectId ?? undefined };
}
