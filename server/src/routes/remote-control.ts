import type { FastifyInstance } from "fastify";
import {
  REQUEST_TIER_GRANTS, exceedingCapabilities, grantsCapability, validateRemoteGrant, zAccessRequestApprove, zAccessRequestCreate,
  zRemoteControlPut,
} from "@hanoman/shared";
import { remoteControlView, updateRemoteControl } from "../services/remote-control";
import { getSetting } from "../services/settings";
import { adminActor, auditAgentAdmin } from "../services/admin-audit";
import { appendEvent } from "../services/logs/event-log";
import {
  REQUEST_TIER_LABEL, createAccessRequest, listAccessRequests, revertAccessRequest, takeAccessRequest, viewById,
} from "../services/remote-access-request";

// SPEC-1215 · ADR-0165 §4/§7 · grant kendali jarak jauh mesin INI.
//
// ADR-0196 · dulu COOKIE_ONLY (agen tak boleh menaikkan haknya sendiri). Kini agent token pemegang
// `remote:read` (GET) / `remote:control` (PUT) boleh memakainya, dengan pagar tak-eskalasi-diri di
// SINI: grant yang diberikan ke hub (`control.capabilities`) hanya boleh memuat capability yang
// DIMILIKI pemanggil, dan blok `logs` (mengirim transkrip/log server ke hub = data keluar) hanya
// boleh diubah pemanggil yang juga memegang `logs:write`. Pemanggil cookie tak dibatasi.
export default async function (app: FastifyInstance) {
  app.get("/remote-control", async () => remoteControlView());

  app.put("/remote-control", async (req, reply) => {
    const parsed = zRemoteControlPut.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const why = parsed.data.control ? validateRemoteGrant(parsed.data.control.capabilities) : null;
    if (why) return reply.code(400).send({ error: why });
    if (req.agent) {
      if (parsed.data.control) {
        const exceeds = exceedingCapabilities(req.agent.capabilities, parsed.data.control.capabilities);
        if (exceeds.length)
          return reply.code(403).send({ error: "grant jarak jauh tidak boleh memuat capability yang tidak dimiliki pemanggil", exceeds });
      }
      if (parsed.data.logs) {
        const now = (await getSetting()).logShipping;
        const l = parsed.data.logs;
        const changed = now.event !== l.event || now.server !== l.server || now.transcript !== l.transcript;
        if (changed && !grantsCapability(req.agent.capabilities, "logs:write"))
          return reply.code(403).send({ error: "capability required", need: "logs:write" });
      }
    }
    const view = await updateRemoteControl(parsed.data, adminActor(req));
    await auditAgentAdmin(req, "remote-control.updated", "grant kendali jarak jauh/lajur log diubah", {
      control: parsed.data.control ?? null, logs: parsed.data.logs ?? null,
    });
    return view;
  });

  // ADR-0217 · opsi C (ADR-0216). Hub MEMINTA tingkat lewat relay; permintaan hanya mengantre di sini.
  // Grant baru hanya lahir dari persetujuan operator LOKAL (`approve` di bawah, cookie-only).
  // POST & GET-nya dijawab relay (principal `remote`, rute di allowlist) tanpa cookie; GET juga dibuka
  // cookie untuk kartu persetujuan. Agen tak pernah sampai ke sini (COOKIE_ONLY di capabilityForRoute).
  app.post("/remote-control/access-requests", async (req, reply) => {
    if (!req.remote) return reply.code(403).send({ error: "permintaan tingkat hanya datang dari server pusat (relay)" });
    const parsed = zAccessRequestCreate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { actor } = req.remote;
    const out = createAccessRequest({ tier: parsed.data.tier, from: actor.hubOrigin, requestedBy: actor.email });
    // Permintaan tertunda yang milik hub LAIN tak dibocorkan lewat 409 ini: hanya miliknya yang dikembalikan.
    if (!out.ok && out.reason === "pending")
      return reply.code(409).send({
        error: "permintaan sebelumnya masih menunggu keputusan di perangkat ini",
        ...(out.view.from === actor.hubOrigin ? { request: out.view } : {}),
      });
    if (!out.ok) {
      return reply.code(429)
        .header("retry-after", String(Math.ceil(out.retryAfterMs / 1000)))
        .send({ error: "terlalu sering meminta tingkat akses; coba lagi nanti" });
    }
    await appendEvent({
      kind: "remote.access-request", level: "info",
      msg: `permintaan tingkat ${REQUEST_TIER_LABEL[parsed.data.tier]} dari ${actor.hubOrigin} menunggu keputusan di perangkat ini`,
      data: { requestId: out.view.id, tier: parsed.data.tier, from: actor.hubOrigin, requestedBy: actor.email, expiresAt: out.view.expiresAt },
    });
    return reply.code(201).send({ request: out.view });
  });

  app.get("/remote-control/access-requests", async (req, reply) => {
    if (req.remote) return { items: listAccessRequests(Date.now(), req.remote.actor.hubOrigin) };
    if (!req.user) return reply.code(403).send({ error: "hanya dari sesi operator lokal" });
    return { items: listAccessRequests() };
  });

  // Persetujuan: HANYA sesi cookie lokal. Relay (principal `remote`) tak pernah sampai sini — rutenya di
  // luar allowlist — dan agen dijawab COOKIE_ONLY. Penerapannya lewat `updateRemoteControl`, pagar dan
  // validasi yang sama dengan PUT di atas; permintaan menurunkan tingkat juga butuh persetujuan ini.
  // ADR-0217 §2 · body WAJIB membawa `tier` dan `from` yang DILIHAT operator di kartu. Bila permintaan
  // tertunda sudah berganti di bawahnya (id, tingkat, atau hub beda — mis. setelah restart), jawabannya
  // 409 dan grant tak disentuh.
  app.post("/remote-control/access-requests/:id/approve", async (req, reply) => {
    if (req.remote || !req.user) return reply.code(403).send({ error: "persetujuan hanya dari sesi operator lokal" });
    const { id } = req.params as { id: string };
    const seen = zAccessRequestApprove.safeParse(req.body);
    if (!seen.success) return reply.code(400).send({ error: seen.error.flatten() });
    const taken = takeAccessRequest(id, "approved", Date.now(), seen.data);
    if (!taken.ok) return reply.code(taken.status).send({ error: taken.error });
    const { entry } = taken;
    // Setiap jalan yang TIDAK menerapkan grant mengembalikan keputusan ke pending — termasuk galat DB di
    // tengah jalan. Tanpa itu permintaan bisa tertinggal "approved" padahal grant belum berubah.
    try {
      if (!(await getSetting()).remoteControl.enabled) {
        revertAccessRequest(id);
        return reply.code(409).send({ error: "kendali jarak jauh masih mati; nyalakan dulu di kartu ini, lalu setujui lagi" });
      }
      const input = zRemoteControlPut.safeParse({ control: { enabled: true, capabilities: [...REQUEST_TIER_GRANTS[entry.tier]] } });
      const why = input.success && input.data.control ? validateRemoteGrant(input.data.control.capabilities) : "tingkat tak dikenal";
      if (!input.success || why) {
        revertAccessRequest(id);
        return reply.code(500).send({ error: `tingkat permintaan tak sah: ${why ?? "?"}` });
      }
      await updateRemoteControl(input.data, adminActor(req));
    } catch (e) {
      revertAccessRequest(id);
      throw e;
    }
    await appendEvent({
      kind: "remote.access-request", level: "info",
      msg: `permintaan tingkat ${REQUEST_TIER_LABEL[entry.tier]} dari ${entry.from} disetujui oleh ${adminActor(req)}`,
      data: { requestId: id, tier: entry.tier, from: entry.from, requestedBy: entry.requestedBy, decision: "approved" },
    });
    return { request: viewById(id) };
  });

  app.post("/remote-control/access-requests/:id/reject", async (req, reply) => {
    if (req.remote || !req.user) return reply.code(403).send({ error: "keputusan hanya dari sesi operator lokal" });
    const { id } = req.params as { id: string };
    const taken = takeAccessRequest(id, "rejected");
    if (!taken.ok) return reply.code(taken.status).send({ error: taken.error });
    const { entry } = taken;
    await appendEvent({
      kind: "remote.access-request", level: "info",
      msg: `permintaan tingkat ${REQUEST_TIER_LABEL[entry.tier]} dari ${entry.from} ditolak oleh ${adminActor(req)}`,
      data: { requestId: id, tier: entry.tier, from: entry.from, requestedBy: entry.requestedBy, decision: "rejected" },
    });
    return { request: viewById(id) };
  });
}
