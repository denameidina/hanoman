import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { pull } from "../src/services/sync";
import { syncOnce, syncNow, setCursor, getCursor, applyFeedFrame, type Transport } from "../src/services/sync-client";
import { issueDeviceToken } from "../src/services/device-token";
import { acceptTicket } from "../src/services/ticket-accept";
import { setConfig, clearConfig } from "../src/config";
import { __resetHelpBuckets } from "../src/services/help-ratelimit";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// SPEC-382 · lampiran triase tak terbawa sync hub → local. Akar: feed hub memancarkan record ANAK
// (`ticketAttachment`) SEBELUM induknya (`ticket`), sehingga di client `upsertLocal` melanggar FK
// TicketAttachment.ticketId → Ticket.id. Di jalur WS kegagalan itu ditelan diam-diam lalu frame
// berikutnya memajukan kursor melewati baris lampiran → hilang selamanya.

const app = buildApp({ requireAuth: false });

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncState.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.ticketAttachment.deleteMany(); await prisma.ticket.deleteMany();
  await prisma.notification.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.runtimeConfig.deleteMany();
  for (const k of ["SYNC_SERVER_URL", "SYNC_DEVICE_TOKEN", "HANOMAN_UPLOAD_DIR"]) await clearConfig(k);
};
beforeEach(clean);
afterAll(async () => { await clean(); await app.close(); });

// `syncNow` memakai transport HTTP nyata → app harus benar-benar mendengarkan (sekali saja).
let listening = false;
const ensureListening = async () => {
  if (listening) return;
  await app.listen({ port: 0, host: "127.0.0.1" });
  listening = true;
};

// Transport stub yang membaca feed langsung dari SyncLog (hub & client berbagi satu DB di test).
const feedTransport: Transport = async (method, path) => {
  if (method === "GET") {
    const since = new URL(`http://x${path}`).searchParams.get("since") ?? "0";
    return { status: 200, body: await pull(since) };
  }
  return { status: 200, body: { results: [] } };
};

function formFiles(fields: Record<string, string>, files: { name: string; filename: string; mime: string; data: Buffer }[]) {
  const boundary = "----sp382";
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

const ticketFeedData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", number: 1, category: "bug", title: "Tak bisa login", detail: "d",
  reporterEmail: "r@e.co", status: "new", accessKeyHash: "hash-1", specId: null,
  createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z", ...over,
});
const attFeedData = (over: Record<string, unknown> = {}) => ({
  ticketId: "TCK-1", projectId: "p1", filename: "shot.png", mimeType: "image/png", size: 42,
  storageKey: "uuid-abc.png", createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z", ...over,
});

describe("SPEC-382 · lampiran tiket menyeberang sync", () => {
  it("hub memancarkan tiket SEBELUM lampirannya ke feed (induk dulu, baru anak)", async () => {
    __resetHelpBuckets();
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing", helpEnabled: true } });
    const res = await app.inject({
      method: "POST", url: "/api/help/p1/tickets",
      ...formFiles({ category: "bug", title: "Tak bisa login", detail: "Error 500", email: "a@b.c" },
        [{ name: "files", filename: "shot.png", mime: "image/png", data: PNG }]),
    });
    expect(res.statusCode).toBe(201);

    const rows = await prisma.syncLog.findMany({ orderBy: { seq: "asc" } });
    const tSeq = rows.findIndex((r) => r.entity === "ticket");
    const aSeq = rows.findIndex((r) => r.entity === "ticketAttachment");
    expect(tSeq).toBeGreaterThanOrEqual(0);
    expect(aSeq).toBeGreaterThanOrEqual(0);
    expect(tSeq).toBeLessThan(aSeq); // induk sebelum anak — else client menabrak FK
  });

  it("client menerapkan lampiran walau feed memancarkannya sebelum tiket (tak hilang, tak melempar)", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    // feed hub berurutan salah: ANAK dulu (seq kecil), lalu INDUK.
    await prisma.syncLog.create({ data: { entity: "ticketAttachment", recordId: "ATT-1", version: 1, data: attFeedData() } });
    await prisma.syncLog.create({ data: { entity: "ticket", recordId: "TCK-1", version: 1, data: ticketFeedData() } });
    await setCursor("0");

    const stats = await syncOnce(feedTransport);

    expect(await prisma.ticket.findUnique({ where: { id: "TCK-1" } })).not.toBeNull();
    const att = await prisma.ticketAttachment.findUnique({ where: { id: "ATT-1" } });
    expect(att).toMatchObject({ ticketId: "TCK-1", filename: "shot.png", storageKey: "uuid-abc.png" });
    expect(stats.pulled).toBe(2);
  });

  it("record yatim tak menghentikan siklus: sisanya tetap diterapkan & kursor tetap maju", async () => {
    // Lampiran yatim (induknya sudah dihapus di hub — feed append-only tanpa tombstone, ADR-0068).
    // Dulu: exception merambat keluar syncOnce, kursor mandek selamanya → SEMUA sync berhenti.
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    await prisma.syncLog.create({
      data: { entity: "ticketAttachment", recordId: "ATT-YATIM", version: 1, data: attFeedData({ ticketId: "TCK-HILANG" }) },
    });
    const last = await prisma.syncLog.create({ data: { entity: "ticket", recordId: "TCK-1", version: 1, data: ticketFeedData() } });
    await setCursor("0");

    await syncOnce(feedTransport); // tak boleh melempar
    expect(await prisma.ticket.findUnique({ where: { id: "TCK-1" } })).not.toBeNull();
    expect(await getCursor()).toBe(String(last.seq)); // maju — tak ada livelock
  });

  it("frame WS yang gagal diterapkan menahan kursor (record tak dilompati & hilang)", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    await setCursor("0");
    // frame 1: lampiran — gagal (induk belum ada lokal). frame 2: tiket — berhasil.
    const gagal = await applyFeedFrame({ entity: "ticketAttachment", recordId: "ATT-1", version: 1, data: attFeedData(), seq: "10" });
    expect(gagal).toBe(false);
    const ok = await applyFeedFrame({ entity: "ticket", recordId: "TCK-1", version: 1, data: ticketFeedData(), seq: "11" });
    expect(ok).toBe(true);
    // kursor TIDAK boleh melewati seq 10 — else baris lampiran hilang selamanya dari feed.
    expect(await getCursor()).toBe("0");

    // pull berikutnya menambal lubang lalu kursor boleh maju lagi.
    await prisma.syncLog.create({ data: { entity: "ticketAttachment", recordId: "ATT-1", version: 1, data: attFeedData() } });
    await syncOnce(feedTransport);
    expect(await prisma.ticketAttachment.findUnique({ where: { id: "ATT-1" } })).not.toBeNull();
    expect(await applyFeedFrame({ entity: "ticket", recordId: "TCK-1", version: 2, data: ticketFeedData({ status: "accepted" }), seq: "99" })).toBe(true);
    expect(await getCursor()).toBe("99");
  });
});

// SPEC-382 · pemulihan data lama: baris feed yang terlanjur dilompati kursor (jalur WS) ada di
// BELAKANG kursor dan takkan pernah tertarik lagi oleh siklus normal. Satu-satunya jalan pulang
// adalah menarik ulang feed dari awal — pull server-authoritative & idempoten, jadi aman diulang.
describe("SPEC-382 · tarik ulang penuh memulihkan baris yang terlewat", () => {
  it("syncNow({ full: true }) mengulang feed dari kursor 0 dan mengembalikan lampiran yang hilang", async () => {
    await ensureListening();
    const u = await prisma.user.create({ data: { email: "d382@x.co", passwordHash: "x:y" } });
    const tok = await issueDeviceToken(u.id, "laptop");
    await setConfig("SYNC_SERVER_URL", `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`);
    await setConfig("SYNC_DEVICE_TOKEN", tok.token);

    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    await prisma.syncLog.create({ data: { entity: "ticket", recordId: "TCK-1", version: 1, data: ticketFeedData() } });
    const attLog = await prisma.syncLog.create({ data: { entity: "ticketAttachment", recordId: "ATT-1", version: 1, data: attFeedData() } });
    // kondisi rusak yang ditinggalkan bug lama: tiket sudah lokal, lampiran dilompati, kursor lewat.
    await prisma.ticket.create({ data: { id: "TCK-1", projectId: "p1", number: 1, category: "bug",
      title: "Tak bisa login", detail: "d", reporterEmail: "r@e.co", accessKeyHash: "hash-1" } });
    await setCursor(String(attLog.seq));
    expect(await prisma.ticketAttachment.count()).toBe(0);

    expect(await syncNow()).toMatchObject({ pulled: 0 }); // siklus normal tak bisa memulihkannya
    const stats = await syncNow({ full: true });

    expect(stats!.pulled).toBeGreaterThanOrEqual(2);
    expect(await prisma.ticketAttachment.findUnique({ where: { id: "ATT-1" } }))
      .toMatchObject({ ticketId: "TCK-1", filename: "shot.png" });
    expect(await getCursor()).toBe(String(attLog.seq));
  });

  it("POST /api/sync/now { full: true } meneruskan mode tarik ulang ke mesin sync", async () => {
    await ensureListening();
    const u = await prisma.user.create({ data: { email: "r382@x.co", passwordHash: "x:y" } });
    const tok = await issueDeviceToken(u.id, "laptop");
    await setConfig("SYNC_SERVER_URL", `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`);
    await setConfig("SYNC_DEVICE_TOKEN", tok.token);
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    await prisma.syncLog.create({ data: { entity: "ticket", recordId: "TCK-1", version: 1, data: ticketFeedData() } });
    const attLog = await prisma.syncLog.create({ data: { entity: "ticketAttachment", recordId: "ATT-1", version: 1, data: attFeedData() } });
    await prisma.ticket.create({ data: { id: "TCK-1", projectId: "p1", number: 1, category: "bug",
      title: "Tak bisa login", detail: "d", reporterEmail: "r@e.co", accessKeyHash: "hash-1" } });
    await setCursor(String(attLog.seq));

    const res = await app.inject({ method: "POST", url: "/api/sync/now", payload: { full: true } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, full: true });
    expect(await prisma.ticketAttachment.count()).toBe(1);
  });
});

// SPEC-382 · separuh kedua keluhan: "ketika di eskalasi ke backlog attachment harus di cek supaya
// context nya jelas". Direktif SPEC-286 sudah ada, tapi di instance CLIENT byte lampiran baru
// mendarat di disk saat seseorang membukanya di UI triase (fetch-through ADR-0068) — eskalasi
// tanpa membuka gambar (termasuk auto-accept scheduler SPEC-297) menyuruh agen membaca path kosong.
describe("SPEC-761 · eskalasi menjaga lampiran publik sebagai data", () => {
  let hub: Server | undefined;
  afterAll(() => { hub?.close(); });

  it("accept tidak menarik byte ke path agen; payload hanya membawa endpoint ber-auth", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hnm382-client-"));
    await setConfig("HANOMAN_UPLOAD_DIR", dir);
    // hub palsu: melayani byte lampiran (GET /api/sync/attachments/:storageKey, device-token).
    const served: string[] = [];
    hub = createServer((req, res) => {
      served.push(req.url ?? "");
      if (req.url?.startsWith("/api/sync/attachments/")) {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG);
      } else { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((r) => hub!.listen(0, "127.0.0.1", () => r()));
    await setConfig("SYNC_SERVER_URL", `http://127.0.0.1:${(hub.address() as AddressInfo).port}`);
    await setConfig("SYNC_DEVICE_TOKEN", "dev-token");

    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    await prisma.ticket.create({ data: { id: "TCK-1", projectId: "p1", number: 1, category: "bug",
      title: "Tombol simpan mati", detail: "klik tak ada reaksi", reporterEmail: "r@e.co", accessKeyHash: "h382" } });
    await prisma.ticketAttachment.create({ data: { id: "ATT-1", ticketId: "TCK-1", projectId: "p1",
      filename: "shot.png", mimeType: "image/png", size: PNG.length, storageKey: "uuid-abc.png" } });
    const t = await prisma.ticket.findUnique({ where: { id: "TCK-1" }, include: { attachments: true } });

    const { spec } = await acceptTicket(t!, { author: "op@x.co", priority: "tinggi" });

    expect(served).toEqual([]);
    expect(existsSync(join(dir, "uuid-abc.png"))).toBe(false);
    const detail = (spec.payload as { actual?: string }).actual ?? ""; // kategori bug → source qa
    expect(detail).toContain("data tidak tepercaya");
    expect(detail).toContain("GET /api/tickets/TCK-1/attachments/ATT-1");
    expect(detail).not.toContain(dir);
  });
});
