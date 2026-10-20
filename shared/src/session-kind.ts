import { z } from "zod";

// SPEC-362 · ADR-0079 · jenis sesi terminal, diturunkan saat sesi LAHIR (pty.sessionKind) dan
// disimpan di SessionHistory.kind. Label ikut di sini, bukan di UI: SPEC-262/264 sudah membuktikan
// grid yang merender slug mentah membuat fiturnya tak ketemu saat dicari manusia.
export const SESSION_KINDS = [
  "spec", "reverse", "prd", "scaffold", "breakdown", "vps", "shell", "worktree", "terminal", "telegram",
  // ADR-0228 · pane hanoman-lead per proyek (`lead-<proyek>`). Tak restartable: ia dilahirkan
  // ulang oleh server sendiri, bukan oleh tombol "Mulai lagi".
  "lead",
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
export const zSessionKind = z.enum(SESSION_KINDS);

export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  spec: "Backlog",
  reverse: "Reverse docs",
  prd: "PRD",
  scaffold: "Scaffold",
  breakdown: "Breakdown PRD",
  vps: "VPS",
  shell: "Terminal biasa",
  worktree: "Worktree (konflik)",
  terminal: "Sesi agen",
  telegram: "Operator Telegram",
  lead: "Lead",
};

// "Mulai lagi" tak pernah menghidupkan proses lama (tmux sudah membunuhnya) — ia men-spawn sesi
// baru dengan konteks sama. Hanya sah bila konteks itu bisa dibangun ulang dari baris riwayat:
// prd/breakdown butuh brief/prdPath yang tak tersimpan, vps & worktree konflik tak punya artinya.
const RESTARTABLE: ReadonlySet<string> = new Set<SessionKind>([
  "spec", "terminal", "shell", "reverse", "scaffold",
]);
export const restartableKind = (kind: string): boolean => RESTARTABLE.has(kind);
