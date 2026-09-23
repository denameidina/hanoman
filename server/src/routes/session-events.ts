import type { FastifyInstance } from "fastify";
import { parseHookEvent } from "@hanoman/shared";
import { verifySessionEventToken } from "../services/session-event-token";
import { getSessionAsync } from "../services/pty";
import { intakeAsk } from "../services/lead/ask";
import { startAgentInvocation, stopAgentInvocation } from "../services/agent-invocations";
import { refreshPhaseInvocations } from "../services/phase-invocations";

// SPEC-909 · ADR-0146 · pintu masuk event pertanyaan sesi.
//
// Prefix SENDIRI, bukan sub-path `/api/lead`, dan itu keputusan keamanan: `capabilityForRoute`
// memetakan seluruh prefix `lead` ke `rw("lead")`, jadi di sana setiap agent token pemegang
// `lead:write` bisa MEMALSUKAN pertanyaan atas nama sesi mana pun dan menggerakkan lead. Prefix ini
// dipetakan eksplisit ke `COOKIE_ONLY`; kredensialnya bukan cookie dan bukan agent token melainkan
// token turunan per sesi, jadi gate cookie di app.ts mem-bypass-nya — pola yang sama dengan
// `/api/sync` (device token) dan `/api/help` (kunci tiket).
//
// Karena bypass itu MENDAHULUI cabang agent token, peta capability tak pernah dieksekusi di sini:
// agent token ditolak oleh HMAC di bawah dengan 401, bukan 403. Petanya tetap ada supaya jawabannya
// benar bila urutan cabang di app.ts kelak berubah, bukan sebagai lapis kedua yang aktif hari ini.

const bearer = (h: string | undefined): string => /^Bearer (.+)$/.exec(h ?? "")?.[1] ?? "";
const recordOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? value as Record<string, unknown> : null;
const boundedString = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
// S1 · waktu event dari relay spool (`x-hanoman-event-at`, ms epoch dari nama berkas hook). Hanya
// membedakan replay dari lanjutan relay di AgentInvocation; di luar rentang wajar (lebih dari 7 hari
// lalu atau lebih dari 1 menit ke depan) diabaikan → waktu terima, perilaku sebelum header ini ada.
const EVENT_AT_PAST_MS = 7 * 24 * 60 * 60_000;
const EVENT_AT_FUTURE_MS = 60_000;
const eventAtOf = (header: unknown, now = Date.now()): Date | undefined => {
  if (typeof header !== "string" || !/^\d{1,15}$/.test(header)) return undefined;
  const ms = Number(header);
  return ms >= now - EVENT_AT_PAST_MS && ms <= now + EVENT_AT_FUTURE_MS ? new Date(ms) : undefined;
};

export default async function (app: FastifyInstance) {
  app.post("/session-events", async (req, reply) => {
    // Identitas datang dari HEADER, bukan dari body: body adalah kontrak agen yang bentuknya bisa
    // berubah tiap rilis, sementara header ini kontrak kita sendiri. `session_id` di dalam payload
    // adalah id internal agen dan tak pernah berarti sesi hanoman.
    const sessionId = String(req.headers["x-hanoman-session"] ?? "");
    const token = bearer(req.headers.authorization);
    if (!sessionId || !token || !verifySessionEventToken(sessionId, token))
      return reply.code(401).send({ error: "unauthorized" });

    // Asinkron dengan sengaja: `getSession()` memakai `execFileSync` tmux dan memblokir event loop
    // sampai 916 ms saat mesin sibuk (SPEC-878). Jalur event tak boleh membayar itu.
    const s = await getSessionAsync(sessionId);
    if (!s || s.exited) return reply.code(404).send({ error: "live session not found" });

    const body = recordOf(req.body);
    const lifecycle = body?.hook_event_name;
    if (body && (lifecycle === "SubagentStart" || lifecycle === "SubagentStop")) {
      const runtimeInvocationId = boundedString(
        body.agent_id ?? body.subagent_id ?? body.thread_id, 500,
      );
      const agentName = boundedString(body.agent_type ?? body.agent_name, 200);
      const meta = agentName
        ? (s.agentRoster ?? []).find((agent) => agent.name === agentName) : undefined;
      if (!runtimeInvocationId || !meta) return reply.code(202).send({ ignored: true });
      const identity = {
        sessionId, projectId: s.projectId, specId: s.specId, runtime: s.agent,
        runtimeInvocationId, customAgentId: meta.id, agentName: meta.name, model: meta.model,
        definitionHash: meta.definitionHash,
        ...(meta.phase ? { phase: meta.phase } : {}),
        ...(meta.effort ? { effort: meta.effort } : {}),
        cwd: s.cwd,
      };
      const eventAt = eventAtOf(req.headers["x-hanoman-event-at"]);
      const outcome = lifecycle === "SubagentStart"
        ? await startAgentInvocation({ ...identity, ...(eventAt ? { startedAt: eventAt } : {}) })
        : await stopAgentInvocation({
          ...identity,
          ...(eventAt ? { endedAt: eventAt } : {}),
          status: body.status === "interrupted" ? "interrupted" : "completed",
          result: boundedString(body.last_assistant_message ?? body.result, 1_000_000),
          transcriptPath: boundedString(
            body.agent_transcript_path ?? body.transcript_path, 4_096,
          ),
          // ADR-0164 · effort yang BENAR-BENAR dipakai runtime (claude: `effort.level` di
          // SubagentStop) — HANYA untuk agen fase. Review Task 9: custom agent bisa membawa
          // `effort` roster sendiri (mis. katalog method), dan payload runtime bukan miliknya
          // untuk ditimpa — pertahankan perilaku effort roster custom agent apa adanya.
          // M-4 · payload hook tak tepercaya: `boundedString` menolak nilai bukan-string, kosong,
          // atau raksasa — melebihi batas berarti diabaikan, effort roster dipertahankan APA
          // ADANYA (bukan ditimpa potongan yang menyesatkan).
          ...(meta.phase && boundedString(recordOf(body.effort)?.level, 64)
            ? { effort: boundedString(recordOf(body.effort)?.level, 64)! } : {}),
        });
      if (meta.phase) void refreshPhaseInvocations(sessionId);
      return reply.code(202).send(outcome.duplicate ? { duplicate: true } : { accepted: true });
    }

    const event = parseHookEvent(req.body);
    // Bukan 400: hook menembak untuk SETIAP `PreToolUse`/`Stop` yang cocok matchernya, dan sebagian
    // besar memang bukan pertanyaan. Menjawabnya error akan memenuhi log sesi dengan kegagalan palsu.
    if (!event) return reply.code(202).send({ ignored: true });

    const r = await intakeAsk({
      sessionId, agent: s.agent, projectId: s.projectId, specId: s.specId,
      decisionFile: s.decisionFile, event,
    });
    if (r.status === "duplicate") return reply.code(202).send({ duplicate: true });
    if (r.status === "rate-limited") return reply.code(429).send({ error: "terlalu banyak event" });
    if (r.status === "rejected") return reply.code(202).send({ rejected: true, reason: r.reason });
    return reply.code(202).send({ accepted: true });
  });
}
