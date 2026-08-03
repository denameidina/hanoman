import type { FastifyInstance } from "fastify";
import type { LeadDecision } from "@prisma/client";
import { zLead, zLeadAsk, zLeadOverride, type LeadAnswer, type LeadStatusView } from "@hanoman/shared";
import { prisma } from "../db";
import { listSessions, liveDecisions, markerFilled, sendToPane } from "../services/pty";
import { listQueue } from "../services/scheduler/queue";
import { getLead, setLead, leadActive } from "../services/lead/config";
import { decide, takeDelivery } from "../services/lead/decide";
import { applyAction } from "../services/lead/apply";
import { listDecisions, overrideDecision, cancelDecision, toDecisionView } from "../services/lead/trail";
import { listFlows, closeFlow, toFlowView, LeadFlowClosedError } from "../services/lead/flow";
import { decidingIds, queuedIds } from "../services/lead/deciding";
import { LeadBusyError, leadGateStats } from "../services/lead/gate";
import { resetSession } from "../services/lead/detect";
import { lastPulse } from "../services/lead/engine";

// SPEC-409 · ADR-0091 · permukaan HTTP hanoman-lead. Semuanya polling (AC-26) — tak ada kanal
// WebSocket baru; ADR-0039 tetap utuh.
//
// Peta capability ada di services/agent-capabilities.ts: prefix `lead` → `lead:read`/`lead:write`
// MENURUT METHOD. Itu bukan detail: SPEC-405 membuktikan apa yang terjadi saat sebuah prefix
// dipetakan ke izin baca tanpa melihat method — setiap agent token mendapat endpoint tulis di
// bawahnya. `POST /lead/decisions` adalah endpoint TULIS (ia melahirkan baris jejak dan bisa
// menggerakkan sesi), dan capability baca tak pernah cukup untuk memanggilnya (AC-5).
export default async function (app: FastifyInstance) {
  app.get("/lead/config", async () => getLead());

  app.put("/lead/config", async (req, reply) => {
    const parsed = zLead.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return setLead(parsed.data);   // ganti blok penuh (pola PUT /scheduler/config). Pause = { paused:true }.
  });

  app.get("/lead/status", async (): Promise<LeadStatusView> => {
    const cfg = await getLead();
    const projects = await prisma.project.findMany({
      where: { leadOptIn: true }, select: { id: true, name: true }, orderBy: { id: "asc" },
    });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // SPEC-402 · bacaan tmux yang gagal MELEMPAR; layar status tak boleh ikut 500 karenanya.
    let live: ReturnType<typeof listSessions> = [];
    try { live = listSessions().filter((s) => !s.exited); } catch { /* tmux tak terbaca */ }
    let waiting: string[] = [];
    try { waiting = liveDecisions().filter((d) => markerFilled(d.decisionFile)).map((d) => d.id); }
    catch { /* idem */ }
    const rows = await Promise.all(projects.map(async (p) => ({
      projectId: p.id, name: p.name,
      optIn: true,
      paused: !leadActive(cfg, p.id),
      decisions24h: await prisma.leadDecision.count({ where: { projectId: p.id, createdAt: { gte: since } } }),
      openSessions: live.filter((s) => s.projectId === p.id).length,
    })));
    const last = lastPulse();
    return {
      config: cfg, projects: rows,
      queue: (await listQueue()).map((q) => ({
        id: q.id, specId: q.specId, projectId: q.projectId, source: q.source,
        priority: q.priority, status: q.status, sessionId: q.sessionId, note: q.note,
        enqueuedAt: q.enqueuedAt.toISOString(),
        launchedAt: q.launchedAt ? q.launchedAt.toISOString() : null,
      })),
      deciding: decidingIds(), queued: queuedIds(), waiting,
      lastPulseAt: last ? new Date(last).toISOString() : null,
      // SPEC-479 · keadaan gerbang konkurensi. Tanpa ini "lead sedang penuh" dan "lead diam"
      // terlihat identik di layar, dan salah baca itulah yang melahirkan tiketnya.
      gate: { ...leadGateStats(), capacity: cfg.maxConcurrent },
    };
  });

  // AC-24 · jejak urut waktu, disaring per project & per backlog.
  // SPEC-523 · amplop `Paginated`. `take`/`skip` lama tetap diterima; `page`/`limit` menang.
  app.get("/lead/decisions", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const r = await listDecisions({
      projectId: q.projectId, specId: q.specId, sessionId: q.sessionId, status: q.status,
      // SPEC-485 · satu rantai dibaca lewat filter ini, urut NAIK (lihat `listDecisions`).
      flowId: q.flowId,
      take: q.take ? Number(q.take) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { items: r.rows.map(toDecisionView), total: r.total, page: r.page, pageSize: r.pageSize };
  });

  // SPEC-485 · ADR-0102 · daftar RANTAI. Langkahnya dibaca lewat `GET /lead/decisions?flowId=`,
  // sengaja bukan bersarang di sini: langkah adalah baris jejak biasa, dan menyalinnya ke
  // serializer kedua berarti dua bentuk yang bisa berselisih diam-diam.
  app.get("/lead/flows", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const r = await listFlows({
      projectId: q.projectId, status: q.status,
      take: q.take ? Number(q.take) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { items: r.rows.map(toFlowView), total: r.total, page: r.page, pageSize: r.pageSize };
  });

  // Submit akhir: rantai ditutup dan tak menerima pertanyaan lanjutan lagi. 409 (bukan 404) saat ia
  // sudah tertutup — tak ada yang rusak, kesempatannya yang sudah lewat.
  app.post("/lead/flows/:id/submit", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await closeFlow(id, "submit");
    if (!row) return reply.code(409).send({ error: "rantai tak ada atau sudah tertutup" });
    return toFlowView(row);
  });

  app.post("/lead/flows/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await closeFlow(id, "operator");
    if (!row) return reply.code(409).send({ error: "rantai tak ada atau sudah tertutup" });
    return toFlowView(row);
  });

  // AC-1/AC-5 · PINTU #1 — kontrak eksplisit "minta putusan". Dipakai sesi internal maupun agen
  // eksternal ber-AgentToken. Balasannya TERSTRUKTUR (bisa dibaca mesin), bukan prosa bebas.
  app.post("/lead/decisions", async (req, reply) => {
    const parsed = zLeadAsk.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const ask = parsed.data;
    const project = await prisma.project.findUnique({ where: { id: ask.projectId }, select: { leadOptIn: true } });
    if (!project) return reply.code(404).send({ error: "project not found" });
    const cfg = await getLead();
    // AC-15/30 · lead mati / dijeda / project tak opt-in → peminta kembali ke perilaku hari ini
    // (menunggu manusia). 409, bukan 500: tak ada yang rusak, hanya tak ada yang menjawab.
    if (!project.leadOptIn || !leadActive(cfg, ask.projectId))
      return reply.code(409).send({ error: "lead tidak aktif untuk project ini" });

    // SPEC-485 · ADR-0102 · VALIDASI DI SERVER, bukan hanya UI. Bentuk yang mustahil dipenuhi
    // ditolak di pintu masuk: melahirkan baris `gagal` untuk permintaan yang memang salah bentuk
    // hanya memindahkan kesalahannya ke jejak, dan membakar satu proses agen untuknya.
    const optionCount = ask.options.length;
    if (ask.select.mode === "multi" && optionCount === 0)
      return reply.code(400).send({ error: "select.mode `multi` menuntut daftar `options`" });
    if (ask.select.max !== null && ask.select.min > ask.select.max)
      return reply.code(400).send({ error: "select.min melebihi select.max" });
    if (ask.select.max !== null && optionCount > 0 && ask.select.max > optionCount)
      return reply.code(400).send({ error: `select.max (${ask.select.max}) melebihi jumlah opsi (${optionCount})` });
    if (ask.select.min > optionCount)
      return reply.code(400).send({ error: `select.min (${ask.select.min}) melebihi jumlah opsi (${optionCount})` });

    // SPEC-479 (QA) · pintu ini tak punya pengereman apa pun sebelum gerbang konkurensi: Fastify
    // melayani permintaan secara konkuren, jadi terukur 12 permintaan bersamaan → 12 proses
    // `claude -p --effort xhigh` sekaligus di mesin 8 GB / 8 core yang sudah menanggung sesi
    // pekerja. Sekarang ia mengantre, dan antrean yang penuh MENJAWAB alih-alih menggantung.
    let row: LeadDecision | null;
    try {
      row = await decide({
        projectId: ask.projectId, specId: ask.specId ?? null, sessionId: ask.sessionId ?? null,
        gate: "contract", kind: "answer", question: ask.question, options: ask.options,
        notes: ask.context ? [ask.context] : undefined,
        select: ask.select, chain: ask.chain, flowId: ask.flowId ?? null,
      });
    } catch (e) {
      // SPEC-485 · 409 · rantai yang sudah ditutup tak menerima pertanyaan lanjutan. Bukan 400
      // (bentuknya sah) dan bukan 404 (alurnya ada, hanya sudah selesai).
      if (e instanceof LeadFlowClosedError) return reply.code(409).send({ error: e.message });
      if (!(e instanceof LeadBusyError)) throw e;
      // 503, dan sengaja BUKAN dua kode yang sudah dipakai di sini: 409 berarti "tak ada yang
      // menjawab, tunggu manusia" (lead mati/dijeda) dan 504 berarti "lead sudah mencoba lalu
      // kehabisan waktu" — keduanya menyuruh peminta menyerah. Ini kebalikannya: lead sehat,
      // hanya penuh, dan permintaan yang sama layak dikirim lagi.
      return reply.code(503)
        .header("retry-after", String(Math.max(5, cfg.queueWaitSec)))
        .send({ error: e.message, retryable: true, queued: e.queued });
    }
    if (!row) return reply.code(409).send({ error: "lead tidak aktif untuk project ini" });
    // SPEC-480 · kontrak eksplisit tak mengetik ke pane, tapi ia tetap mengambil putusan
    // "sebagaimana dikirim": salinan TERPANGKAS-nya. Jejak DB tetap memegang prosa lead yang utuh.
    const sent = takeDelivery(row.id);
    if (row.status === "gagal") return reply.code(504).send({ error: row.reason, id: row.id });
    // Lead memutuskan LALU melapor: tindakan yang menyusul dijalankan sebelum balasan dikirim,
    // supaya peminta tak menerima keputusan yang belum berlaku di dunia nyata.
    if (row.action !== "none") { try { await applyAction(row); } catch { /* jejak tetap ada */ } }
    // SPEC-485 · status alur dibaca SESUDAH `decide()` menutupnya (alur tunggal) atau memajukannya
    // (alur berantai) — peminta butuh tahu apakah ia masih boleh bertanya lagi tanpa memanggil
    // endpoint kedua.
    const flowStatus = row.flowId
      ? (await prisma.leadFlow.findUnique({ where: { id: row.flowId }, select: { status: true } }))?.status ?? null
      : null;
    const answer: LeadAnswer = {
      id: row.id,
      decision: sent?.decision ?? row.answer,
      reason: sent?.reason ?? row.reason,
      refs: Array.isArray(row.refs) ? (row.refs as unknown[]).map(String) : [],
      confidence: row.confidence as LeadAnswer["confidence"],
      action: row.action as LeadAnswer["action"],
      // Saluran pengiriman bisa meleset (baris lahir dari jalur lain); kolomnya yang selalu ada.
      choice: sent?.choice ?? (row.choice ? { index: row.choiceIndex ?? 1, option: row.choice } : null),
      missing: sent?.missing ?? (Array.isArray(row.missing) ? (row.missing as unknown[]).map(String) : []),
      // SPEC-485 · `choices` bentuk yang berlaku; `toDecisionView` sudah tahu cara menurunkannya
      // dari kolom lama, jadi pemetaannya tak diduplikasi di sini (kelas bug SPEC-431/448/475).
      choices: sent?.choices ?? toDecisionView(row).choices,
      flowId: row.flowId,
      flowStatus: flowStatus as LeadAnswer["flowStatus"],
    };
    return reply.code(201).send(answer);
  });

  // AC-28 · operator menimpa. Keputusan lama → `ditimpa`, jawaban operator jadi yang berlaku, dan
  // bila panenya masih hidup jawaban baru itu DIKETIK ke sesi yang bersangkutan.
  app.post("/lead/decisions/:id/override", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zLeadOverride.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const r = await overrideDecision(id, parsed.data.answer, parsed.data.reason, parsed.data.choices);
    if (!r) return reply.code(409).send({ error: "keputusan tak ada atau sudah tak berlaku" });
    let delivered = false;
    if (r.next.sessionId) {
      // OQ-8 · manusia menang. Penghitung jawaban otomatis sesi ini di-reset: campur tangan
      // operator memutus rantai "berturut-turut" yang dijaga AC-11.
      resetSession(r.next.sessionId);
      // SPEC-485 · centang operator ikut menyeberang: dialog multiSelect di pane dicentang sesuai
      // pilihan manusia, bukan cuma menerima prosanya.
      delivered = await sendToPane(r.next.sessionId, parsed.data.answer, 50,
        toDecisionView(r.next).choices.map((c) => c.option)).catch(() => false);
    }
    return { old: toDecisionView(r.old), next: toDecisionView(r.next), delivered };
  });

  app.post("/lead/decisions/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await cancelDecision(id);
    if (!row) return reply.code(409).send({ error: "keputusan tak ada atau sudah tak berlaku" });
    if (row.sessionId) resetSession(row.sessionId);
    return toDecisionView(row);
  });
}
