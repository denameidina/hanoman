import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { __resetHelpBuckets } from "../src/services/help-ratelimit";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const clean = async () => {
  await prisma.ticketAttachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => {
  await app.ready();
  await clean();
  await prisma.project.create({ data: { id: "hc-proj", name: "HC Proj", desc: "", kind: "existing", helpEnabled: true } });
  await prisma.project.create({ data: { id: "hc-off", name: "Off", desc: "", kind: "existing", helpEnabled: false } });
});
afterAll(async () => { await clean(); await app.close(); });

// Bangun body multipart/form-data field-only.
function form(fields: Record<string, string>) {
  const boundary = "----hc253";
  const CRLF = "\r\n";
  let body = "";
  for (const [k, v] of Object.entries(fields)) {
    body += `--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`;
  }
  body += `--${boundary}--${CRLF}`;
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

// Body multipart dengan field + berkas (buffer). files: [{name, filename, mime, data}]
function formFiles(fields: Record<string, string>, files: { name: string; filename: string; mime: string; data: Buffer }[]) {
  const boundary = "----hc253f";
  const CRLF = "\r\n";
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`));
  }
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"${CRLF}Content-Type: ${f.mime}${CRLF}${CRLF}`));
    chunks.push(f.data);
    chunks.push(Buffer.from(CRLF));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("SPEC-253 · Help Center publik", () => {
  it("GET info hanya untuk helpEnabled; nonaktif → 404", async () => {
    expect((await app.inject({ method: "GET", url: "/api/help/hc-proj" })).statusCode).toBe(200);
    const info = (await app.inject({ method: "GET", url: "/api/help/hc-proj" })).json();
    expect(info.projectName).toBe("HC Proj");
    expect(info.categories).toContain("bug");
    expect((await app.inject({ method: "GET", url: "/api/help/hc-off" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/help/tak-ada" })).statusCode).toBe(404);
  });

  it("submit valid → 201 + number/key/statusPath, lalu status Sedang ditinjau", async () => {
    __resetHelpBuckets();
    const res = await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...form({ category: "bug", title: "Tak bisa login", detail: "Error 500", email: "a@b.c" }) });
    expect(res.statusCode).toBe(201);
    const { number, key, statusPath } = res.json();
    expect(number).toBe(1);
    expect(statusPath).toContain(key);
    const st = await app.inject({ method: "GET", url: `/api/help/hc-proj/tickets/${key}` });
    expect(st.statusCode).toBe(200);
    expect(st.json().status).toBe("Sedang ditinjau");
    // notifikasi tiket baru dibuat
    expect(await prisma.notification.count({ where: { type: "ticket" } })).toBeGreaterThan(0);
  });

  it("submit ke project nonaktif → 404, tak buat tiket", async () => {
    __resetHelpBuckets();
    const res = await app.inject({ method: "POST", url: "/api/help/hc-off/tickets", ...form({ category: "bug", title: "x", detail: "y", email: "a@b.c" }) });
    expect(res.statusCode).toBe(404);
  });

  it("field wajib kosong / kategori invalid → 400, tak buat tiket", async () => {
    __resetHelpBuckets();
    const before = await prisma.ticket.count({ where: { projectId: "hc-proj" } });
    expect((await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...form({ category: "bug", title: "", detail: "x", email: "a@b.c" }) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...form({ category: "spam", title: "t", detail: "x", email: "a@b.c" }) })).statusCode).toBe(400);
    expect(await prisma.ticket.count({ where: { projectId: "hc-proj" } })).toBe(before);
  });

  it("honeypot → 200 tanpa tiket", async () => {
    __resetHelpBuckets();
    const before = await prisma.ticket.count({ where: { projectId: "hc-proj" } });
    const res = await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...form({ category: "bug", title: "spam", detail: "spam", email: "x@y.z", hc_trap: "iambot" }) });
    expect(res.statusCode).toBe(200);
    expect(await prisma.ticket.count({ where: { projectId: "hc-proj" } })).toBe(before);
  });

  // SPEC-352 · `hp` (nama honeypot lama) berarti "handphone" dalam bahasa Indonesia, jadi autofill
  // browser mengisinya untuk pelapor sungguhan → submit tertelan diam-diam. Field itu kini field
  // biasa yang diabaikan: bundle basi di tab lama tetap menghasilkan tiket, bukan sukses palsu.
  it("field lama `hp` terisi autofill → tetap 201 dan tiket sungguh dibuat (SPEC-352)", async () => {
    __resetHelpBuckets();
    const before = await prisma.ticket.count({ where: { projectId: "hc-proj" } });
    const res = await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...form({ category: "bug", title: "Diisi autofill", detail: "d", email: "a@b.c", hp: "0812-3456-7890" }) });
    expect(res.statusCode).toBe(201);
    expect(res.json().statusPath).toContain(res.json().key);
    expect(await prisma.ticket.count({ where: { projectId: "hc-proj" } })).toBe(before + 1);
  });

  // SPEC-352 · honeypot yang menjawab 200 tanpa jejak apa pun membuat false positive mustahil
  // didiagnosis (lima hari senyap di produksi tanpa satu baris bukti).
  it("honeypot meninggalkan jejak di log supaya false positive teramati (SPEC-352)", async () => {
    __resetHelpBuckets();
    const seen: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => { seen.push(a.join(" ")); };
    try {
      await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...form({ category: "bug", title: "spam", detail: "spam", email: "x@y.z", hc_trap: "iambot" }) });
    } finally { console.warn = orig; }
    expect(seen.join("\n")).toMatch(/honeypot.*hc-proj/i);
  });

  it("kunci salah / slug salah → 404 (tak membocorkan)", async () => {
    expect((await app.inject({ method: "GET", url: "/api/help/hc-proj/tickets/hnm_tkt_bogus" })).statusCode).toBe(404);
  });

  it("status publik menerima shareToken operator, bukan cuma kunci pelapor (SPEC-293)", async () => {
    __resetHelpBuckets();
    const res = await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", ...form({ category: "bug", title: "share me", detail: "d", email: "s@e.co" }) });
    const { key } = res.json();
    const { hashAccessKey } = await import("../src/services/ticket");
    const t = await prisma.ticket.findUnique({ where: { accessKeyHash: hashAccessKey(key) } });
    expect(t?.shareToken).toMatch(/^hnm_shr_/);
    // shareToken juga membuka halaman status
    const viaShare = await app.inject({ method: "GET", url: `/api/help/hc-proj/tickets/${t!.shareToken}` });
    expect(viaShare.statusCode).toBe(200);
    expect(viaShare.json().title).toBe("share me");
    // kunci pelapor asli tetap valid
    expect((await app.inject({ method: "GET", url: `/api/help/hc-proj/tickets/${key}` })).statusCode).toBe(200);
    // shareToken milik project lain tak bocor via slug ini
    expect((await app.inject({ method: "GET", url: `/api/help/hc-off/tickets/${t!.shareToken}` })).statusCode).toBe(404);
    // token asing → 404
    expect((await app.inject({ method: "GET", url: "/api/help/hc-proj/tickets/hnm_shr_bogus" })).statusCode).toBe(404);
  });

  it("lampiran: gambar valid disimpan, mime invalid di-skip (submit tetap jadi)", async () => {
    __resetHelpBuckets();
    const png = PNG;
    const res = await app.inject({
      method: "POST", url: "/api/help/hc-proj/tickets",
      ...formFiles(
        { category: "bug", title: "Dengan lampiran", detail: "d", email: "a@b.c" },
        [
          { name: "files", filename: "shot.png", mime: "image/png", data: png },
          { name: "files", filename: "note.txt", mime: "text/plain", data: Buffer.from("bukan gambar") },
        ],
      ),
    });
    expect(res.statusCode).toBe(201);
    const { key } = res.json();
    const t = await prisma.ticket.findUnique({ where: { accessKeyHash: (await import("../src/services/ticket")).hashAccessKey(key) }, include: { attachments: true } });
    expect(t?.attachments.length).toBe(1); // hanya png; txt di-skip
    expect(t?.attachments[0]?.mimeType).toBe("image/png");
  });

  it("rate-limit per IP → 429 setelah kuota", async () => {
    __resetHelpBuckets();
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const r = await app.inject({ method: "POST", url: "/api/help/hc-proj/tickets", remoteAddress: "5.5.5.5", ...form({ category: "bug", title: `t${i}`, detail: "d", email: "a@b.c" }) });
      if (r.statusCode === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });
});
