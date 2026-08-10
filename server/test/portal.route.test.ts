import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";
import { PORTAL_SPEC_KEYS, PORTAL_TICKET_KEYS } from "@hanoman/shared";

const app = buildApp();
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.ticket.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
const login = async (email: string, password: string) =>
  cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } }));

async function seed() {
  for (const id of ["p1", "p2"])
    await prisma.project.create({ data: { id, name: id.toUpperCase(), desc: "", kind: "existing" } });
  await prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "Punya klien", source: "brief", stage: "executing",
    priority: "tinggi", author: "op@internal.co", objective: "hasil",
    payload: { context: "rahasia internal" }, baseSha: "abc", headSha: "def", branchFrom: "main" } });
  await prisma.spec.create({ data: {
    id: "SPEC-2", projectId: "p2", title: "Bukan punya klien", source: "brief", stage: "done",
    priority: "rendah", author: "op@internal.co", objective: "x" } });
  // SPEC-647 · baris tambahan supaya paginasi benar-benar punya sesuatu untuk dipenggal.
  for (const n of [3, 4, 5])
    await prisma.spec.create({ data: {
      id: `SPEC-${n}`, projectId: "p1", title: `Punya klien ${n}`, source: "brief", stage: "planned",
      priority: "sedang", author: "op@internal.co", objective: "hasil" } });
  await prisma.ticket.create({ data: {
    id: "t1", projectId: "p1", number: 1, category: "bug", title: "Tombol mati",
    detail: "repro", reporterEmail: "pelapor@luar.co", status: "accepted",
    accessKeyHash: "h1", specId: "SPEC-1" } });
  await prisma.ticket.create({ data: {
    id: "t2", projectId: "p2", number: 1, category: "bug", title: "Tiket project lain",
    detail: "repro", reporterEmail: "pelapor@luar.co", status: "new", accessKeyHash: "h2" } });
  for (const n of [2, 3])
    await prisma.ticket.create({ data: {
      id: `t1${n}`, projectId: "p1", number: n + 1, category: "bug", title: `Tombol mati ${n}`,
      detail: "repro", reporterEmail: "pelapor@luar.co", status: "new", accessKeyHash: `h1${n}` } });

  await prisma.user.create({ data: { email: "admin@x.co", passwordHash: await hashPassword("password1") } });
  const c = await prisma.user.create({ data: {
    email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: c.id, projectId: "p1" } });
  return { cookie: await login("klien@x.co", "password2"), adminCookie: await login("admin@x.co", "password1") };
}

describe("GET /api/portal (SPEC-617)", () => {
  it("daftar project hanya yang ditugaskan", async () => {
    const { cookie } = await seed();
    const r = await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ items: [{ id: "p1", name: "P1" }], total: 1 });
  });

  // SPEC-647 · ADR-0107 · satu amplop untuk SELURUH daftar portal. Pemilih project di UI sengaja
  // tetap meminta daftar penuh (project terpilih tak boleh jatuh dari halaman), tapi kontraknya
  // memakai pola paginate() yang sama — bukan pola sendiri.
  it("daftar project beramplop Paginated dan menghormati page/limit", async () => {
    const { cookie } = await seed();
    await prisma.project.create({ data: { id: "p3", name: "P3", desc: "", kind: "existing" } });
    const u = await prisma.user.findFirstOrThrow({ where: { email: "klien@x.co" } });
    await prisma.clientProjectAccess.create({ data: { userId: u.id, projectId: "p3" } });

    const full = await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } });
    expect(full.json()).toMatchObject({ total: 2, page: 1, pageSize: 2 });
    expect(full.json().items.map((p: { id: string }) => p.id)).toEqual(["p1", "p3"]);

    const page2 = await app.inject({ method: "GET", url: "/api/portal/projects?page=2&limit=1", headers: { cookie } });
    expect(page2.json()).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page2.json().items.map((p: { id: string }) => p.id)).toEqual(["p3"]);
  });

  it("backlog project sendiri: hanya field yang diizinkan", async () => {
    const { cookie } = await seed();
    const r = await app.inject({ method: "GET", url: "/api/portal/projects/p1/backlog", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.total).toBe(4);
    expect(Object.keys(body.items[0]).sort()).toEqual([...PORTAL_SPEC_KEYS].sort());
    expect(JSON.stringify(body)).not.toContain("rahasia internal");
    expect(JSON.stringify(body)).not.toContain("op@internal.co");
  });

  it("tiket project sendiri: tanpa email pelapor, status kosakata publik", async () => {
    const { cookie } = await seed();
    const r = await app.inject({ method: "GET", url: "/api/portal/projects/p1/tickets", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.total).toBe(3);
    expect(Object.keys(body.items[0]).sort()).toEqual([...PORTAL_TICKET_KEYS].sort());
    // Dicari by-id: `createdAt` ketiga tiket seed jatuh di milidetik yang sama, jadi `orderBy
    // createdAt desc` tak menjamin siapa yang di baris pertama.
    expect(body.items.find((t: { id: string }) => t.id === "t1").status).toBe("Sedang dikerjakan");
    expect(JSON.stringify(body)).not.toContain("pelapor@luar.co");
  });

  // SPEC-647 · ADR-0107 · yang diuji adalah PEMENGGALANNYA, bukan kehadiran parameter: satu
  // halaman berisi `limit` baris, `total` tetap seluruh baris, halaman terakhir tak penuh, dan
  // halaman di luar batas kosong TANPA galat (halaman kosong bukan 404).
  it("backlog portal dipenggal per halaman, total tetap seluruh baris", async () => {
    const { cookie } = await seed();
    const at = async (qs: string) => (await app.inject({
      method: "GET", url: `/api/portal/projects/p1/backlog${qs}`, headers: { cookie } })).json();

    const p1 = await at("?page=1&limit=2");
    expect(p1).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(p1.items).toHaveLength(2);

    const p2 = await at("?page=2&limit=2");
    expect(p2.items).toHaveLength(2);
    // Halaman 2 bukan ulangan halaman 1 — inilah yang membuktikan `page` dipakai.
    expect(p2.items.map((s: { id: string }) => s.id)).not.toEqual(p1.items.map((s: { id: string }) => s.id));

    const akhir = await at("?page=2&limit=3");
    expect(akhir.items).toHaveLength(1);       // 4 baris ÷ 3 → halaman terakhir tak penuh

    const jauh = await at("?page=9&limit=2");
    expect(jauh.items).toEqual([]);
    expect(jauh.total).toBe(4);
  });

  it("tiket portal dipenggal per halaman", async () => {
    const { cookie } = await seed();
    const at = async (qs: string) => (await app.inject({
      method: "GET", url: `/api/portal/projects/p1/tickets${qs}`, headers: { cookie } })).json();

    const p1 = await at("?page=1&limit=2");
    expect(p1).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(p1.items).toHaveLength(2);

    const p2 = await at("?page=2&limit=2");
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0].id).not.toBe(p1.items[0].id);

    expect((await at("?page=9&limit=2")).items).toEqual([]);
  });

  it("detail backlog & tiket bisa dibuka baca-saja", async () => {
    const { cookie } = await seed();
    const s = await app.inject({ method: "GET", url: "/api/portal/projects/p1/backlog/SPEC-1", headers: { cookie } });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ id: "SPEC-1", title: "Punya klien", objective: "hasil" });
    const t = await app.inject({ method: "GET", url: "/api/portal/projects/p1/tickets/t1", headers: { cookie } });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ id: "t1", detail: "repro" });
    expect(t.json()).not.toHaveProperty("reporterEmail");
  });

  // Project yang ada tapi bukan miliknya dan project yang tak ada TAK BOLEH terbedakan —
  // preseden Help Center (404 generik, tak membocorkan project).
  it("project yang bukan miliknya → 404, tak terbedakan dari yang tak ada", async () => {
    const { cookie } = await seed();
    for (const url of [
      "/api/portal/projects/p2/backlog", "/api/portal/projects/hantu/backlog",
      "/api/portal/projects/p2/tickets", "/api/portal/projects/hantu/tickets",
      "/api/portal/projects/p2/backlog/SPEC-2", "/api/portal/projects/p2/tickets/t2",
    ]) {
      const r = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(r.statusCode, url).toBe(404);
    }
  });

  it("item project lain tak bisa ditarik lewat id di project sendiri", async () => {
    const { cookie } = await seed();
    expect((await app.inject({ method: "GET", url: "/api/portal/projects/p1/backlog/SPEC-2", headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/portal/projects/p1/tickets/t2", headers: { cookie } })).statusCode).toBe(404);
  });

  it("klien tanpa keterikatan tak melihat apa pun", async () => {
    await seed();
    await prisma.user.create({ data: { email: "sepi@x.co", passwordHash: await hashPassword("password3"), role: "client" } });
    const cookie = await login("sepi@x.co", "password3");
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).json())
      .toMatchObject({ items: [], total: 0 });
    expect((await app.inject({ method: "GET", url: "/api/portal/projects/p1/backlog", headers: { cookie } })).statusCode).toBe(404);
  });

  it("tanpa sesi → 401", async () => {
    await seed();
    expect((await app.inject({ method: "GET", url: "/api/portal/projects" })).statusCode).toBe(401);
  });

  // Sesi klien yang dinonaktifkan mati SEKARANG — dibuktikan di route portal yang memang ada
  // (path karangan tak pernah menyentuh hook onRequest ber-scope milik Fastify).
  it("sesi klien nonaktif → 401 di portal", async () => {
    const { cookie } = await seed();
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).statusCode).toBe(200);
    await prisma.user.updateMany({ where: { email: "klien@x.co" }, data: { disabled: true } });
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).statusCode).toBe(401);
  });

  // Baca-saja portal punya DUA lapis, dan keduanya perlu dinyatakan terpisah:
  // (1) tak ada satu pun route tulis yang lahir di namespace ini — diuji di sini terhadap tabel
  //     route Fastify, bukan lewat inject: request ke path tanpa route dijawab not-found handler
  //     yang berada DI LUAR scope hook `onRequest`, jadi 404-nya tak membuktikan apa pun;
  // (2) allowlist menolak method tulis seandainya route seperti itu suatu hari ditambahkan —
  //     diuji sebagai fungsi murni di client-route-allowed.test.ts.
  // SPEC-626 · ADR-0111 menambah TEPAT SATU route tulis (kirim tiket). Daftar di bawah karena itu
  // jadi pernyataan lengkap: satu POST yang disengaja, nol yang lain.
  it("hanya satu route tulis di namespace portal", async () => {
    await app.ready();
    const urls = ["/api/portal/projects", "/api/portal/projects/:id/backlog",
      "/api/portal/projects/:id/backlog/:specId", "/api/portal/projects/:id/tickets",
      "/api/portal/projects/:id/tickets/:ticketId"];
    const WRITE_OK = new Set(["POST /api/portal/projects/:id/tickets"]);
    for (const url of urls) {
      expect(app.hasRoute({ method: "GET", url }), `GET ${url}`).toBe(true);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const)
        expect(app.hasRoute({ method, url }), `${method} ${url}`).toBe(WRITE_OK.has(`${method} ${url}`));
    }
  });

  // Admin memang punya cookie penuh; portal bukan permukaan rahasia, tapi scope-nya tetap
  // ditegakkan lewat ClientProjectAccess-nya sendiri (admin tak punya baris akses → kosong).
  it("admin memakai portal → daftar mengikuti akses miliknya sendiri (kosong)", async () => {
    const { adminCookie: cookie } = await seed();
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).json())
      .toMatchObject({ items: [], total: 0 });
  });

  it("portal tak bisa disentuh agent token (cookie-only)", async () => {
    const { capabilityForRoute } = await import("../src/services/agent-capabilities");
    expect(capabilityForRoute("GET", "/api/portal/projects")).toBe("COOKIE_ONLY");
  });
});
