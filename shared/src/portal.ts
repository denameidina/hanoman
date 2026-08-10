import { publicStatus } from "./ticket-status";

// SPEC-617 · ADR-0110 · proyeksi baris DB → apa yang boleh dibaca akun klien.
// Allowlist field EKSPLISIT, bukan `Omit<>`: kolom yang bertambah di Prisma nanti tak akan
// diam-diam ikut terkirim, dan test mengadu kunci hasilnya ke daftar ini.

export const PORTAL_PROJECT_KEYS = ["id", "name"] as const;
export const PORTAL_SPEC_KEYS =
  ["id", "title", "priority", "stage", "objective", "createdAt", "startedAt", "doneAt"] as const;
export const PORTAL_TICKET_KEYS =
  ["id", "number", "category", "title", "status", "createdAt"] as const;

export type PortalProject = { id: string; name: string };
export type PortalSpec = {
  id: string; title: string; priority: string; stage: string; objective: string;
  createdAt: string; startedAt: string | null; doneAt: string | null;
};
export type PortalTicket = {
  id: string; number: number; category: string; title: string; status: string; createdAt: string;
};
export type PortalTicketDetail = PortalTicket & { detail: string };

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : (typeof d === "string" ? d : d.toISOString());

export function toPortalProject(p: { id: string; name: string }): PortalProject {
  return { id: p.id, name: p.name };
}

export function toPortalSpec(s: {
  id: string; title: string; priority: string; stage: string; objective: string;
  createdAt: Date | string; startedAt: Date | string | null; doneAt: Date | string | null;
}): PortalSpec {
  return {
    id: s.id, title: s.title, priority: s.priority, stage: s.stage, objective: s.objective,
    createdAt: iso(s.createdAt)!, startedAt: iso(s.startedAt), doneAt: iso(s.doneAt),
  };
}

/** `specStage` = stage Spec tertaut (null bila tiket belum jadi backlog). */
export function toPortalTicket(t: {
  id: string; number: number; category: string; title: string; status: string;
  createdAt: Date | string;
}, specStage: string | null): PortalTicket {
  return {
    id: t.id, number: t.number, category: t.category, title: t.title,
    status: publicStatus(t.status, specStage), createdAt: iso(t.createdAt)!,
  };
}

export function toPortalTicketDetail(
  t: Parameters<typeof toPortalTicket>[0] & { detail: string },
  specStage: string | null,
): PortalTicketDetail {
  return { ...toPortalTicket(t, specStage), detail: t.detail };
}
