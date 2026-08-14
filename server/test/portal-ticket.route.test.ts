/* SPEC-626 · ADR-0111 · jalur TULIS pertama di permukaan klien. Yang dipagari di sini: tiket
   dari portal identik di mata operator dengan tiket dari halaman publik, scope project ditegakkan,
   dan route ini tak bocor ke akun klien tanpa akses. */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";
import { __resetHelpBuckets } from "../src/services/help-ratelimit";
import { PORTAL_TICKET_KEYS } from "@hanoman/shared";

const app = buildApp();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.ticketAttachment.deleteMany(); await prisma.ticket.deleteMany();
  await prisma.notification.deleteMany(); await prisma.syncLog.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => { await clean(); __resetHelpBuckets(); });
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];

async function seed(opts: { helpEnabled?: boolean } = {}) {
  await prisma.project.create({ data: {
    id: "p1", name: "P1", desc: "", kind: "existing", helpEnabled: opts.helpEnabled ?? true } });
  await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
  const c = await prisma.user.create({ data: {
    email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: c.id, projectId: "p1" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { email: "klien@x.co", password: "password2" } });
  return { cookie: cookieOf(login), userId: c.id };
}

/** Body multipart field + (opsional) lampiran — idiom yang sama dengan `help.test.ts`,
    tanpa dependency baru. */
function body(fields: Record<string, string>, files: { name: string; mime: string; buf: Buffer }[] = []) {
  const boundary = "----spec626";
  const CRLF = "\r\n";
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields))
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`));
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="files"; filename="${f.name}"${CRLF}Content-Type: ${f.mime}${CRLF}${CRLF}`));
    chunks.push(f.buf);
    chunks.push(Buffer.from(CRLF));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const OK = { category: "bug", title: "Tombol bayar mati", detail: "Klik bayar tak terjadi apa-apa" };

describe("POST /api/portal/projects/:id/tickets (SPEC-626)", () => {
  it("membuat tiket yang identik dengan jalur publik di mata operator", async () => {
    const { cookie } = await seed();
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(201);
    expect(Object.keys(r.json()).sort()).toEqual([...PORTAL_TICKET_KEYS].sort());

    const t = await prisma.ticket.findFirst({ where: { projectId: "p1" } });
    expect(t).toBeTruthy();
    expect(t!.status).toBe("new");
    expect(t!.number).toBe(1);
    // Email pelapor datang dari AKUN, tak pernah diketik ulang.
    expect(t!.reporterEmail).toBe("klien@x.co");
    // …dan tiketnya tetap punya kunci akses seperti tiket publik.
    expect(t!.accessKeyHash).toBeTruthy();

    // Notifikasi operator + feed sync yang sama.
    expect(await prisma.notification.count({ where: { type: "ticket" } })).toBe(1);
    expect(await prisma.syncLog.count({ where: { entity: "ticket", recordId: t!.id } })).toBe(1);
  });

  it("langsung tampil di daftar tiket portal klien itu", async () => {
    const { cookie } = await seed();
    const b = body(OK);
    await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    const list = await app.inject({ method: "GET", url: "/api/portal/projects/p1/tickets", headers: { cookie } });
    expect(list.json().total).toBe(1);
    expect(list.json().items[0].title).toBe("Tombol bayar mati");
    expect(list.json().items[0].status).toBe("Sedang ditinjau");
  });

  // Scope project: penolakannya 404 GENERIK, bukan 403 — portal tak boleh jadi alat enumerasi.
  it("project bukan haknya → 404 generik dan nol tiket tercipta", async () => {
    const { cookie } = await seed();
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p2/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "not found" });
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("project yang tak ada dijawab sama persis", async () => {
    const { cookie } = await seed();
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/tak-ada/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "not found" });
  });

  it("klien tanpa akses ke project mana pun tak bisa menulis", async () => {
    await seed();
    await prisma.user.create({ data: {
      email: "lain@x.co", passwordHash: await hashPassword("password3"), role: "client" } });
    const login = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "lain@x.co", password: "password3" } });
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie: cookieOf(login) }, payload: b.payload });
    expect(r.statusCode).toBe(404);
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("tanpa sesi sama sekali → tak bisa menulis", async () => {
    await seed();
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: b.headers, payload: b.payload });
    expect(r.statusCode).toBe(401);
    expect(await prisma.ticket.count()).toBe(0);
  });

  // Keputusan eksplisit ADR-0111: portal punya otentikasinya sendiri + baris akses per project,
  // jadi ia tak disandera knob permukaan ANONIM.
  it("tidak bergantung helpEnabled — jalur publik tetap bergantung", async () => {
    const { cookie } = await seed({ helpEnabled: false });
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(201);

    const pub = body({ ...OK, email: "orang@luar.co", hc_trap: "" });
    const r2 = await app.inject({ method: "POST", url: "/api/help/p1/tickets",
      headers: pub.headers, payload: pub.payload });
    expect(r2.statusCode).toBe(404);
  });

  it("field wajib tak lengkap → 400, nol tiket", async () => {
    const { cookie } = await seed();
    const b = body({ category: "bug", title: "", detail: "" });
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(400);
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("kategori di luar katalog ditolak", async () => {
    const { cookie } = await seed();
    const b = body({ ...OK, category: "apa-saja" });
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(400);
  });

  it("lampiran gambar tersimpan; berkas bertipe salah di-SKIP tanpa membatalkan submit", async () => {
    const { cookie } = await seed();
    const b = body(OK, [
      { name: "bukti.png", mime: "image/png", buf: PNG },
      { name: "virus.exe", mime: "application/octet-stream", buf: Buffer.from("nope") },
    ]);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(201);
    const atts = await prisma.ticketAttachment.findMany();
    expect(atts.length).toBe(1);
    expect(atts[0]!.mimeType).toBe("image/png");
  });

  it("rate-limit per akun membalas 429, bukan membuat tiket", async () => {
    const { cookie } = await seed();
    for (let i = 0; i < 5; i++) {
      const b = body({ ...OK, title: `Keluhan ${i}` });
      const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
        headers: { ...b.headers, cookie }, payload: b.payload });
      expect(r.statusCode, `ke-${i}`).toBe(201);
    }
    const b = body({ ...OK, title: "Kelebihan" });
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(429);
    expect(await prisma.ticket.count()).toBe(5);
  });

  // Permukaan tulis tetap SATU pintu — bukan pelonggaran pola. Diuji terhadap TABEL ROUTE, bukan
  // lewat inject: request ke path tanpa route dijawab not-found handler yang berada DI LUAR scope
  // hook `onRequest`, jadi 404-nya tak membuktikan apa pun (ADR-0110 gotcha 7). Lapis keduanya —
  // "allowlist menolaknya seandainya route itu ada" — ada di client-route-allowed.test.ts.
  it("nol route tulis portal lain yang lahir bersama ini", async () => {
    await app.ready();
    for (const url of ["/api/portal/projects", "/api/portal/projects/:id/backlog",
      "/api/portal/projects/:id/backlog/:specId", "/api/portal/projects/:id/tickets/:ticketId"])
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const)
        expect(app.hasRoute({ method, url }), `${method} ${url}`).toBe(false);
    for (const method of ["PUT", "PATCH", "DELETE"] as const)
      expect(app.hasRoute({ method, url: "/api/portal/projects/:id/tickets" }), method).toBe(false);
  });
});
