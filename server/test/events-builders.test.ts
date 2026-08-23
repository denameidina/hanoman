import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db";
import { createTicket } from "../src/services/ticket";
import { buildTicketsPage } from "../src/services/tickets-list";
import { buildQueuePage } from "../src/services/scheduler/queue";

// SPEC-908 · builder yang dipakai BERSAMA route HTTP dan hub siar. Kalau hub menyalin serializer
// route, frame dan respons jadi dua bentuk yang bisa berselisih diam-diam (kelas SPEC-431/448/475).

const clean = async () => {
  await prisma.ticketAttachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => {
  await clean();
  await prisma.project.create({ data: { id: "bld-proj", name: "Bld", desc: "", kind: "existing", helpEnabled: true } });
  await prisma.project.create({ data: { id: "bld-other", name: "Other", desc: "", kind: "existing", helpEnabled: true } });
  for (let i = 0; i < 25; i++) {
    const { ticket } = await createTicket({
      projectId: "bld-proj", category: "bug",
      title: i === 0 ? "Terminal lemot" : `Tiket ${i}`,
      detail: "d", reporterEmail: i === 1 ? "zebra@e.co" : "r@e.co",
    });
    if (i >= 7) await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "accepted" } });
  }
  await createTicket({ projectId: "bld-other", category: "fitur", title: "lain", detail: "d", reporterEmail: "o@e.co" });
  await prisma.schedulerQueueItem.create({
    data: { specId: "SPEC-BLD-1", projectId: "bld-proj", source: "backlog", priority: "sedang", status: "queued" },
  });
});
afterAll(async () => { await clean(); });

describe("SPEC-908 · buildTicketsPage", () => {
  it("menghormati halaman dan menghitung `unreviewed` atas SET PENUH", async () => {
    const p1 = await buildTicketsPage({ project: "bld-proj", page: 1, limit: 20 });
    expect(p1.items).toHaveLength(20);
    expect(p1.total).toBe(25);
    expect(p1.unreviewed).toBe(7);

    const p2 = await buildTicketsPage({ project: "bld-proj", page: 2, limit: 20 });
    expect(p2.items).toHaveLength(5);
    // Lencana "belum ditinjau" tak boleh mengecil saat operator pindah halaman (SPEC-523).
    expect(p2.unreviewed).toBe(7);
  });

  it("menyaring `q` atas judul DAN email pelapor", async () => {
    const byTitle = await buildTicketsPage({ project: "bld-proj", page: 1, limit: 20, q: "terminal" });
    expect(byTitle.items.map((t) => t.title)).toEqual(["Terminal lemot"]);
    expect(byTitle.total).toBe(1);

    const byEmail = await buildTicketsPage({ project: "bld-proj", page: 1, limit: 20, q: "zebra@" });
    expect(byEmail.total).toBe(1);
  });

  it("menyaring project dan status", async () => {
    expect((await buildTicketsPage({ project: "bld-other", page: 1, limit: 20 })).total).toBe(1);
    expect((await buildTicketsPage({ project: "bld-proj", status: "new", page: 1, limit: 20 })).total).toBe(7);
  });

  it("`limit` tak sah MENJEPIT ke satu baris — bukan berarti seluruh tabel", async () => {
    // Route menyerahkan `Number(limit)`: `limit=abc` jadi NaN dan `limit=0` jadi 0, dan keduanya
    // falsy. Membacanya sebagai "tanpa limit" mengubah GET /tickets jadi dump tabel penuh ber-200,
    // melanggar ADR-0107 tanpa satu pun sinyal. MCP, agent token, dan portal memakai endpoint ini.
    expect((await buildTicketsPage({ project: "bld-proj", page: 1, limit: Number("abc") })).items).toHaveLength(1);
    expect((await buildTicketsPage({ project: "bld-proj", page: 1, limit: 0 })).items).toHaveLength(1);
    // Tanpa `limit` sama sekali tetap berarti seluruh set (pola `paginate` sejak SPEC-198).
    expect((await buildTicketsPage({ project: "bld-proj" })).items).toHaveLength(25);
  });

  it("memancarkan createdAt sebagai string ISO, bukan Date", async () => {
    const r = await buildTicketsPage({ project: "bld-proj", page: 1, limit: 1 });
    expect(typeof r.items[0]!.createdAt).toBe("string");
  });
});

describe("SPEC-908 · buildQueuePage", () => {
  it("mengembalikan amplop Paginated dengan tanggal sudah ISO", async () => {
    const r = await buildQueuePage({ status: "queued", page: 1, limit: 10 });
    expect(r.total).toBe(1);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(10);
    expect(typeof r.items[0]!.enqueuedAt).toBe("string");
    expect(r.items[0]!.launchedAt).toBeNull();
  });

  it("menyaring per status", async () => {
    expect((await buildQueuePage({ status: "failed", page: 1, limit: 10 })).total).toBe(0);
  });

  it("`limit` tak sah MENJEPIT ke satu baris — cermin buildTicketsPage", async () => {
    expect((await buildQueuePage({ status: "queued", page: 1, limit: Number("abc") })).pageSize).toBe(1);
    expect((await buildQueuePage({ status: "queued", page: 1, limit: 0 })).pageSize).toBe(1);
  });
});
