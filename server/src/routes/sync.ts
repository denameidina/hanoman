import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { PRESENCE_MAX_FRAMES_PER_MIN, zPresenceFrame } from "@hanoman/shared";
import { prisma } from "../db";
import { requireDeviceToken } from "../services/device-auth";
import { verifyDeviceToken } from "../services/device-token";
import { attachSync, detachSync } from "../services/sync-hub";
import { recordPresence, dropPresence } from "../services/presence/registry";
import type { Client } from "../services/pty";
import { applyPush, pull, bootstrapSnapshot, isEntity, type Entity } from "../services/sync";
import { syncNow, fetchTransport } from "../services/sync-client";
import { listPendingDeletes } from "../services/sync-delete";
import { listConflicts, resolveConflict } from "../services/conflicts";
import { readUpload } from "../services/uploads";
import { effectiveStr } from "../config";
import { bearerToken, openWsConnection, revalidateWsPrincipal, WsMessageGuard } from "../services/ws-admission";

// SPEC-213 · ADR-0045/0046 · surface sync mesin-ke-mesin (device-token). Isi file dokumen
// TIDAK lewat sini — hanya record (project/spec/vps/sessionResult).
const zPush = z.object({
  records: z.array(z.object({
    entity: z.string(), id: z.string(), baseVersion: z.number().int().nonnegative(),
    data: z.record(z.unknown()),
    // SPEC-799 · ADR-0119 · absen = "upsert" (client versi lama). Hub versi lama membuang field ini
    // dan sekadar memperlakukan push delete sebagai update — status quo, bukan galat.
    op: z.enum(["upsert", "delete"]).optional(),
  })),
});

// Entitas ber-`author`: bila klien tak mengirim author, atribusikan ke user pemilik token (AC-4).
const AUTHORED: Entity[] = ["spec", "sessionResult"];

// SPEC-885 · ADR-0138 · gzip DUA endpoint sync saja, bukan plugin lifecycle global.
//
// `@fastify/compress` sengaja tidak dipakai: ia belum jadi dependency, menambahkannya menyentuh
// daftar `--external` di skrip build esbuild, dan ia memasang hook di seluruh lifecycle. Yang
// dibutuhkan hanya dua endpoint mesin-ke-mesin yang payload-nya sudah dibatasi ≤1 MB oleh
// anggaran byte dan sudah utuh di memori — `gzipSync` atasnya ~10 ms. Plugin sebesar itu untuk
// permukaan sekecil itu adalah dependency yang harus dibayar tiap rilis tanpa alasan.
function maybeGzip(req: FastifyRequest, reply: FastifyReply, payload: unknown): unknown {
  // `vary` disetel TANPA syarat: ia menerangkan bahwa balasan berbeda menurut accept-encoding,
  // dan itu benar juga bagi balasan yang kebetulan tidak dimampatkan. Menyetelnya hanya di
  // cabang gzip adalah cara klasik meracuni cache perantara.
  reply.header("vary", "accept-encoding");
  if (!/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) return payload;
  reply.header("content-type", "application/json; charset=utf-8");
  reply.header("content-encoding", "gzip");
  return gzipSync(Buffer.from(JSON.stringify(payload)));
}

export default async function (app: FastifyInstance) {
  app.get("/sync/pull", { preHandler: requireDeviceToken }, async (req, reply) => {
    const since = (req.query as { since?: string }).since ?? "0";
    return maybeGzip(req, reply, await pull(since));
  });

  // SPEC-885 · ADR-0138 · keadaan sekarang dalam urutan dependensi, untuk client yang kursornya
  // masih 0. Tak ada gerbang tambahan di `app.ts`: path ini di bawah `/api/sync` dan bukan salah
  // satu pengecualian cookie-only, jadi ia otomatis ikut jalur device-token seperti `/sync/pull`.
  app.get("/sync/bootstrap", { preHandler: requireDeviceToken }, async (req, reply) => {
    const after = (req.query as { after?: string }).after ?? null;
    return maybeGzip(req, reply, await bootstrapSnapshot(after));
  });

  // SPEC-272 · ADR-0068 · byte lampiran untuk fetch-through client (device-token, bukan cookie).
  // Divalidasi milik TicketAttachment → cegah baca file arbitrer di upload dir.
  app.get("/sync/attachments/:storageKey", { preHandler: requireDeviceToken }, async (req, reply) => {
    const { storageKey } = req.params as { storageKey: string };
    const a = await prisma.ticketAttachment.findFirst({ where: { storageKey } });
    if (!a) return reply.code(404).send({ error: "not found" });
    const buf = await readUpload(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", a.mimeType);
    return reply.send(buf);
  });

  app.post("/sync/push", { preHandler: requireDeviceToken }, async (req, reply) => {
    const p = zPush.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const user = await prisma.user.findUnique({ where: { id: req.device!.userId } });
    const results = [];
    for (const rec of p.data.records) {
      if (!isEntity(rec.entity)) { results.push({ id: rec.id, ok: false, error: "unknown entity" }); continue; }
      const data = { ...rec.data };
      if (AUTHORED.includes(rec.entity) && !data.author && user) data.author = user.email;
      // SPEC-880 · kegagalan SATU record (umumnya field dari instance yang lebih baru — validateSyncData
      // melempar) dulu keluar dari loop dan menjadikan SELURUH batch 500, sehingga client membaca
      // seluruh push-nya gagal dan mengulanginya tanpa ujung. Per-record: bentuk yang sama dengan
      // "unknown entity" di atas. Ini TIDAK membuat hub versi lama menerima field baru — urutan
      // rilis hub-dulu yang menutup jendela itu (ADR-0135); ini menutup kelasnya ke depan.
      try {
        const r = await applyPush(rec.entity, rec.id, rec.baseVersion, data, req.device!.id, rec.op ?? "upsert");
        results.push({ id: rec.id, ...r });
      } catch (e) {
        req.log.warn({ entity: rec.entity, recordId: rec.id, err: e }, "sync push record ditolak");
        results.push({ id: rec.id, ok: false, error: (e as Error).message });
      }
    }
    return { results };
  });

  // SPEC-268 · ADR-0066 · pemicu sync manual (tombol UI). Cookie-authed lewat gate global (path ini
  // DIKECUALIKAN dari bypass /api/sync di app.ts); agent token → 403 (sync cookie-only). Bukan
  // client (hub) → not-configured. Menjalankan satu siklus syncOnce (pull-before-push).
  // SPEC-382 · body opsional `{ full: true }` → tarik ulang feed dari kursor 0 (pemulihan baris
  // yang terlanjur dilompati). Absen/false = perilaku lama, satu siklus.
  app.post("/sync/now", async (req) => {
    const full = (req.body as { full?: boolean } | undefined)?.full === true;
    const stats = await syncNow({ full });
    if (!stats) return { ok: false as const, reason: "not-configured" as const };
    return { ok: true as const, full, ...stats };
  });

  // SPEC-270 · ADR-0067 · antrean konflik rekonsil (cookie-authed; dikecualikan dari gate agent-token).
  app.get("/sync/conflicts", async () => ({ conflicts: await listConflicts() }));

  // SPEC-799 · ADR-0119 · penghapusan yang belum sempat menyeberang (client offline). Cookie-authed
  // seperti /sync/now & /sync/conflicts — ini permukaan UI, bukan kanal mesin-ke-mesin.
  app.get("/sync/pending", async () => {
    const deletes = await listPendingDeletes();
    return { deletes, total: deletes.length };
  });

  const zResolve = z.object({ choice: z.enum(["local", "server"]) });
  app.post("/sync/conflicts/:entity/:recordId/resolve", async (req, reply) => {
    const { entity, recordId } = req.params as { entity: string; recordId: string };
    const p = zResolve.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ ok: false, reason: "bad-choice" });
    const base = effectiveStr("SYNC_SERVER_URL"); const token = effectiveStr("SYNC_DEVICE_TOKEN");
    const push = async (records: unknown[]) => {
      if (!base || !token) return { results: [{ ok: false as const }] };
      const res = await fetchTransport(base, token)("POST", "/api/sync/push", { records });
      // `server` (snapshot terkini hub saat menolak) ikut diteruskan apa adanya — itulah yang
      // dipakai resolveConflict untuk mencoba ulang dengan baseVersion yang tidak basi.
      return res.body as { results: { ok?: boolean; version?: number; conflict?: boolean; server?: { version: number } }[] };
    };
    return resolveConflict(entity, recordId, p.data.choice, push);
  });

  // Kanal server-to-server memakai Authorization header. Credential query sengaja ditolak agar
  // token tidak masuk access log, history, atau telemetry proxy.
  app.get("/sync/ws", {
    websocket: true,
    preValidation: async (req, reply) => {
      if ((req.query as { token?: string }).token) return reply.code(401).send({ error: "query token rejected" });
      const token = bearerToken(req);
      const dev = token ? await verifyDeviceToken(token) : null;
      if (!dev) return reply.code(401).send({ error: "unauthorized" });
      req.wsPrincipal = { kind: "device", id: dev.id };
    },
  }, async (socket, req) => {
    const principal = req.wsPrincipal!;
    let release: () => void;
    try { release = openWsConnection(principal); }
    catch { socket.close(1008, "connection limit"); return; }
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    attachSync(client);

    /* SPEC-919 · ADR-0147 · arah naik kanal ini. Sebelumnya `/sync/ws` tak pernah memasang
       `socket.on("message")` sama sekali — dan justru itulah yang membuat hub versi LAMA
       mengabaikan frame presence tanpa satu pun error, sehingga klien baru tetap sync normal.

       Semua kegagalan di sini DIBUANG, tak pernah menutup socket: kanal yang sama mengangkut
       changefeed sync, dan kegagalan status tak boleh menjatuhkannya. Itu sebabnya verdict
       `WsMessageGuard` di sini diabaikan alih-alih diterjemahkan jadi close 1008/1009 seperti
       di `/events/ws`, yang socket-nya milik dashboard. */
    const guard = new WsMessageGuard({ perWindow: PRESENCE_MAX_FRAMES_PER_MIN });
    socket.on("message", (raw: Buffer) => {
      try {
        if (!guard.accept(raw).ok) return;
        const parsed = zPresenceFrame.safeParse(JSON.parse(raw.toString("utf8")));
        if (!parsed.success) return;
        // deviceId SELALU dari token terverifikasi — payload tak pernah boleh menamai dirinya.
        recordPresence("spoofed-from-payload", parsed.data.sessions);
      } catch { /* frame rusak — dibuang */ }
    });

    const revalidate = setInterval(() => {
      void revalidateWsPrincipal(req, principal).then((ok) => { if (!ok) socket.close(1008, "token revoked"); });
    }, 60_000);
    revalidate.unref?.();
    socket.on("close", () => { clearInterval(revalidate); release(); detachSync(client); dropPresence(principal.id); });
  });
}
