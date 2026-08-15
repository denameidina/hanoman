import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireDeviceToken } from "../services/device-auth";
import { verifyDeviceToken } from "../services/device-token";
import { attachSync, detachSync } from "../services/sync-hub";
import type { Client } from "../services/pty";
import { applyPush, pull, isEntity, type Entity } from "../services/sync";
import { syncNow, fetchTransport } from "../services/sync-client";
import { listPendingDeletes } from "../services/sync-delete";
import { listConflicts, resolveConflict } from "../services/conflicts";
import { readUpload } from "../services/uploads";
import { effectiveStr } from "../config";
import { bearerToken, openWsConnection, revalidateWsPrincipal } from "../services/ws-admission";

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

export default async function (app: FastifyInstance) {
  app.get("/sync/pull", { preHandler: requireDeviceToken }, async (req) => {
    const since = (req.query as { since?: string }).since ?? "0";
    return pull(since);
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
      const r = await applyPush(rec.entity, rec.id, rec.baseVersion, data, req.device!.id, rec.op ?? "upsert");
      results.push({ id: rec.id, ...r });
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
    const revalidate = setInterval(() => {
      void revalidateWsPrincipal(req, principal).then((ok) => { if (!ok) socket.close(1008, "token revoked"); });
    }, 60_000);
    revalidate.unref?.();
    socket.on("close", () => { clearInterval(revalidate); release(); detachSync(client); });
  });
}
