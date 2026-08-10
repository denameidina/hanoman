import type { Paginated, PortalProject, PortalSpec, PortalTicket, PortalTicketDetail } from "@hanoman/shared";
import { ApiError } from "./client";

// SPEC-617 · ADR-0110 · permukaan klien punya berkasnya sendiri, terpisah dari api/client.ts:
// dengan begitu tak ada endpoint operator yang tak sengaja terjangkau dari layar portal.
async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `GET ${url} → ${res.status}`);
  return res.json();
}

const p = (id: string) => `/api/portal/projects/${encodeURIComponent(id)}`;

export const portalApi = {
  listProjects: () => get<{ items: PortalProject[] }>("/api/portal/projects"),
  listBacklog: (id: string) => get<Paginated<PortalSpec>>(`${p(id)}/backlog`),
  getSpec: (id: string, specId: string) => get<PortalSpec>(`${p(id)}/backlog/${encodeURIComponent(specId)}`),
  listTickets: (id: string) => get<Paginated<PortalTicket>>(`${p(id)}/tickets`),
  getTicket: (id: string, ticketId: string) =>
    get<PortalTicketDetail>(`${p(id)}/tickets/${encodeURIComponent(ticketId)}`),
  logout: async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) throw new ApiError(res.status, `POST /api/auth/logout → ${res.status}`);
  },
};
