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

// SPEC-647 · ADR-0107 · satu argumen, dua parameter. `limit` TANPA `page` bukan halaman melainkan
// PLAFON (jebakan terukur SPEC-523), jadi bentuknya sengaja tak bisa dikirim setengah.
export type PortalPage = { page: number; limit: number };
const q = ({ page, limit }: PortalPage) => `?page=${page}&limit=${limit}`;

export const portalApi = {
  // Pemilih project sengaja tanpa halaman — project terpilih tak boleh jatuh dari halaman.
  listProjects: () => get<Paginated<PortalProject>>("/api/portal/projects"),
  listBacklog: (id: string, pg: PortalPage) => get<Paginated<PortalSpec>>(`${p(id)}/backlog${q(pg)}`),
  getSpec: (id: string, specId: string) => get<PortalSpec>(`${p(id)}/backlog/${encodeURIComponent(specId)}`),
  listTickets: (id: string, pg: PortalPage) => get<Paginated<PortalTicket>>(`${p(id)}/tickets${q(pg)}`),
  getTicket: (id: string, ticketId: string) =>
    get<PortalTicketDetail>(`${p(id)}/tickets/${encodeURIComponent(ticketId)}`),
  // SPEC-626 · ADR-0111 · satu-satunya aksi tulis portal. Multipart (lampiran gambar) — sengaja
  // TANPA `content-type` manual: browser yang menyusun boundary-nya.
  createTicket: async (id: string, form: FormData): Promise<PortalTicket> => {
    const url = `${p(id)}/tickets`;
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) throw new ApiError(res.status, `POST ${url} → ${res.status}`);
    return res.json();
  },
  logout: async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) throw new ApiError(res.status, `POST /api/auth/logout → ${res.status}`);
  },
};
