import type { Ticket } from "@prisma/client";
import type { Paginated, TicketView, TopicParams } from "@hanoman/shared";
import { prisma } from "../db";
import { paginate } from "./paginate";

// SPEC-908 · satu definisi untuk GET /tickets dan topik siar `tickets`. Sebelumnya inline di
// routes/tickets.ts; menyalinnya ke hub berarti dua serializer yang bisa berselisih diam-diam.
const view = (t: Ticket & { _count?: { attachments: number } }): TicketView => ({
  id: t.id, projectId: t.projectId, number: t.number, category: t.category, title: t.title,
  reporterEmail: t.reporterEmail, status: t.status, specId: t.specId,
  attachmentCount: t._count?.attachments ?? 0, createdAt: t.createdAt.toISOString(),
});

export async function buildTicketsPage(
  f: Partial<TopicParams["tickets"]>,
): Promise<Paginated<TicketView> & { unreviewed: number }> {
  const where: { projectId?: string; status?: string } = {};
  if (f.project) where.projectId = f.project;
  if (f.status) where.status = f.status;
  let rows = await prisma.ticket.findMany({
    where, orderBy: { createdAt: "desc" }, include: { _count: { select: { attachments: true } } },
  });
  if (f.q) {
    const n = f.q.toLowerCase();
    rows = rows.filter((t) => `${t.title} ${t.reporterEmail}`.toLowerCase().includes(n));
  }
  // Dihitung atas SET PENUH, bukan per halaman: lencana "belum ditinjau" tak boleh mengecil saat
  // operator pindah halaman (SPEC-523).
  const unreviewed = rows.filter((t) => t.status === "new").length;
  return {
    ...paginate(rows.map(view), f.page ? String(f.page) : undefined, f.limit ? String(f.limit) : undefined),
    unreviewed,
  };
}
