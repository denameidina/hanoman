import type { FastifyInstance } from "fastify";
import {
  webhookEventTypes, zCreateWebhookEndpoint, zUpdateWebhookEndpoint,
  WEBHOOK_MAX_ATTEMPTS, WEBHOOK_PING_TYPE, WEBHOOK_SPEC_VERSION,
  type WebhookDeliveryView, type WebhookTestResult,
} from "@hanoman/shared";
import { prisma } from "../db";
import {
  encryptEndpointSecret, endpointView, newSecret, normalize, refreshWebhookCache,
  secretOf, type EndpointRow,
} from "../services/webhooks/endpoints";
import { checkUrlShape } from "../services/webhooks/ssrf";
import { sendOnce } from "../services/webhooks/sender";

// SPEC-481 · ADR-0100 · pengelolaan endpoint webhook. ADR-0194 membukanya untuk agent token lewat
// `webhooks:read|write` (ditegakkan `capabilityForRoute`). Yang TIDAK bisa dinyatakan di peta itu
// ada di sini: `allowPrivate` mematikan pagar SSRF (alamat loopback/internal), dan itu tetap
// keputusan MANUSIA — agent token tak boleh menyalakannya maupun memindahkan endpoint yang sudah
// ber-`allowPrivate` ke tujuan lain.

const KNOWN = new Set(webhookEventTypes());
const FAMILIES = new Set([...KNOWN].map((t) => `${t.split(".")[0]}.*`));

/** `*` dan `<keluarga>.*` sah; sisanya harus ada di katalog — salah ketik tak boleh diam. */
function unknownEvents(events: string[]): string[] {
  return events.filter((e) => e !== "*" && !FAMILIES.has(e) && !KNOWN.has(e));
}

/** `null` = lolos. Hanya bentuk + IP literal; resolusi DNS dilakukan tiap percobaan kirim. */
function checkUrl(url: string, allowPrivate: boolean): string | null {
  const r = checkUrlShape(url, allowPrivate);
  return r.ok ? null : r.error;
}

const AGENT_PRIVATE_DENIED = {
  error: "agent token tidak boleh menyalakan allowPrivate atau mengubah tujuan endpoint ber-allowPrivate — keputusan manusia (ADR-0194)",
};

const pendingOf = (endpointId: string) => prisma.webhookDelivery.count({
  where: { endpointId, status: { in: ["pending", "sending"] } },
});

const deliveryView = (d: {
  id: string; endpointId: string; eventId: string; eventType: string; projectId: string | null;
  status: string; attempt: number; maxAttempts: number; httpStatus: number | null;
  durationMs: number | null; error: string | null; nextAttemptAt: Date | null;
  createdAt: Date; sentAt: Date | null; payload: unknown;
}): WebhookDeliveryView => ({
  id: d.id, endpointId: d.endpointId, eventId: d.eventId, eventType: d.eventType,
  projectId: d.projectId, status: d.status as WebhookDeliveryView["status"],
  attempt: d.attempt, maxAttempts: d.maxAttempts, httpStatus: d.httpStatus,
  durationMs: d.durationMs, error: d.error,
  nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(), sentAt: d.sentAt?.toISOString() ?? null,
  payload: d.payload,
});

export default async function (app: FastifyInstance) {
  app.get("/webhooks", async () => {
    const rows = await prisma.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } }) as unknown as EndpointRow[];
    const endpoints = [];
    for (const r of rows) endpoints.push(endpointView(r, await pendingOf(r.id)));
    return { endpoints, eventTypes: [...KNOWN] };
  });

  app.post("/webhooks", async (req, reply) => {
    const parsed = zCreateWebhookEndpoint.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    // Sebelum validasi lain: agen tak boleh memakai respons 400 untuk meraba pagar SSRF.
    if (req.agent && p.allowPrivate === true) return reply.code(403).send(AGENT_PRIVATE_DENIED);

    const unknown = unknownEvents(p.events);
    if (unknown.length) return reply.code(400).send({ error: "jenis peristiwa tak dikenal", unknown });
    const urlErr = checkUrl(p.url, p.allowPrivate ?? false);
    if (urlErr) return reply.code(400).send({ error: urlErr });

    const secret = p.secret ?? newSecret();
    const row = await prisma.webhookEndpoint.create({
      data: {
        name: p.name, url: p.url.trim(), secret: encryptEndpointSecret(secret),
        events: p.events as never, projectIds: (p.projectIds ?? null) as never,
        enabled: p.enabled ?? true, allowPrivate: p.allowPrivate ?? false,
        ...(p.maxPerMinute !== undefined ? { maxPerMinute: p.maxPerMinute } : {}),
      },
    }) as unknown as EndpointRow;
    // Cache WAJIB disegarkan tiap mutasi — itulah "berlaku tanpa restart".
    await refreshWebhookCache();
    // Secret plaintext SEKALI seumur hidup (pola AgentToken).
    return reply.code(201).send(endpointView(row, 0, secret));
  });

  app.patch("/webhooks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zUpdateWebhookEndpoint.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;

    const existing = await prisma.webhookEndpoint.findUnique({ where: { id } }) as unknown as EndpointRow | null;
    if (!existing) return reply.code(404).send({ error: "not found" });
    // Dua jalan menuju SSRF internal oleh agen: menyalakan flag-nya, atau mengganti URL endpoint
    // yang flag-nya SUDAH menyala (pagar IP literal tak diperiksa ulang untuk itu).
    if (req.agent && (p.allowPrivate === true || (existing.allowPrivate && p.url !== undefined)))
      return reply.code(403).send(AGENT_PRIVATE_DENIED);

    if (p.events) {
      const unknown = unknownEvents(p.events);
      if (unknown.length) return reply.code(400).send({ error: "jenis peristiwa tak dikenal", unknown });
    }
    const url = p.url ?? existing.url;
    const allowPrivate = p.allowPrivate ?? existing.allowPrivate;
    if (p.url !== undefined || p.allowPrivate !== undefined) {
      const urlErr = checkUrl(url, allowPrivate);
      if (urlErr) return reply.code(400).send({ error: urlErr });
    }

    const rotated = p.rotateSecret ? newSecret() : p.secret;
    // Mengaktifkan ulang = memberi kesempatan baru: jejak nonaktif & streak dibersihkan, kalau tidak
    // satu kegagalan berikutnya langsung mematikannya lagi (streak sudah di ambang).
    const reviving = p.enabled === true && !existing.enabled;

    const row = await prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.url !== undefined ? { url: p.url.trim() } : {}),
        ...(p.events !== undefined ? { events: p.events as never } : {}),
        ...(p.projectIds !== undefined ? { projectIds: (p.projectIds ?? null) as never } : {}),
        ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
        ...(p.allowPrivate !== undefined ? { allowPrivate: p.allowPrivate } : {}),
        ...(p.maxPerMinute !== undefined ? { maxPerMinute: p.maxPerMinute } : {}),
        ...(rotated ? { secret: encryptEndpointSecret(rotated) } : {}),
        ...(reviving ? { disabledAt: null, disabledReason: null, failureStreak: 0 } : {}),
      },
    }) as unknown as EndpointRow;
    await refreshWebhookCache();
    return endpointView(row, await pendingOf(id), rotated);
  });

  app.delete("/webhooks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.webhookEndpoint.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "not found" });
    await prisma.webhookEndpoint.delete({ where: { id } });   // deliveries ikut cascade
    await refreshWebhookCache();
    return reply.code(204).send();
  });

  // Uji koneksi SINKRON: ini aksi operator yang menunggu jawaban, bukan peristiwa produk. Tetap
  // mencatat baris riwayat supaya hasilnya bisa dibaca lagi nanti.
  app.post("/webhooks/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await prisma.webhookEndpoint.findUnique({ where: { id } }) as unknown as EndpointRow | null;
    if (!row) return reply.code(404).send({ error: "not found" });
    if (!secretOf(row)) return reply.code(409).send({ error: "secret tak bisa dibuka — rotasi dulu" });

    const eventId = `evt_ping_${Date.now().toString(36)}`;
    const envelope = {
      specVersion: WEBHOOK_SPEC_VERSION, id: eventId, type: WEBHOOK_PING_TYPE,
      createdAt: new Date().toISOString(), project: null,
      actor: req.agent
        ? { kind: "agent", id: req.agent.id, label: `agent:${req.agent.id}` }
        : { kind: "user", id: null, label: req.user?.email ?? "operator" },
      data: {
        entity: "webhook", id: row.id, action: "created", changed: [],
        before: null, after: { endpoint: row.name, message: "ping dari hanoman" },
      },
      truncated: false, truncatedFields: [],
    };
    const body = JSON.stringify(envelope);
    const delivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: row.id, eventId, eventType: WEBHOOK_PING_TYPE, payload: envelope as never,
        status: "sending", attempt: 1, maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      },
    });

    const res = await sendOnce({
      endpoint: normalize(row), deliveryId: delivery.id, eventId,
      eventType: WEBHOOK_PING_TYPE, attempt: 1, body,
    });
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        // Ping yang gagal TIDAK diulang: operator sedang berdiri di depannya dan akan menekan lagi.
        status: res.ok ? "sent" : "failed",
        httpStatus: res.httpStatus, durationMs: res.durationMs, error: res.error,
        sentAt: res.ok ? new Date() : null,
      },
    });
    const out: WebhookTestResult = {
      ok: res.ok, httpStatus: res.httpStatus, durationMs: res.durationMs, error: res.error,
    };
    return out;
  });

  app.get("/webhooks/:id/deliveries", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.webhookEndpoint.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "not found" });
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit) || 50, 1), 200);
    const rows = await prisma.webhookDelivery.findMany({
      where: { endpointId: id }, orderBy: { createdAt: "desc" }, take: limit,
    });
    return { items: rows.map(deliveryView) };
  });

  app.post("/webhooks/deliveries/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await prisma.webhookDelivery.findUnique({ where: { id } });
    if (!d) return reply.code(404).send({ error: "not found" });
    if (d.status === "pending" || d.status === "sending")
      return reply.code(409).send({ error: "masih dalam antrean" });
    const row = await prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: "pending", attempt: 0, nextAttemptAt: null, error: null,
        httpStatus: null, durationMs: null, sentAt: null,
      },
    });
    return deliveryView(row);
  });
}
