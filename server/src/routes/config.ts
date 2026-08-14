import type { FastifyInstance } from "fastify";
import { CONFIG_REGISTRY, configEntry, parseConfigValue, maskSecret, type ConfigEntry, type ConfigEntryView } from "@hanoman/shared";
import { effectiveStr, rawDbValue, sourceOf, setConfig, clearConfig } from "../config";
import { applyConfigSideEffect, rotateSyncOrigin } from "../services/config-apply";
import { syncStatus } from "../services/sync-client";

// SPEC-215 · ADR-0049 · kelola config runtime dari dashboard (cookie-authed). Secret & connection
// string tak pernah balik plaintext — hanya masked + hasValue. Bootstrap read-only.
const isSecret = (e: ConfigEntry) => e.kind === "secret";

// SPEC-477 · ADR-0097 · `capabilityForRoute` hanya melihat method+path dan tak pernah melihat
// `body.key`, jadi ia struktural tak bisa membedakan PUT /config {key:"SYNC_TICK_MS"} dari
// PUT /config {key:"GITHUB_TOKEN"}. Pagarnya karena itu di handler. Ini KONDISI TAMBAHAN untuk
// identitas AgentToken, bukan capability baru — ADR-0065 utuh.
const agentBlocked = (req: { agent?: unknown }, e: ConfigEntry) =>
  Boolean(req.agent) && e.category === "credential";

function view(e: ConfigEntry): ConfigEntryView {
  const eff = effectiveStr(e.key);
  const base = {
    key: e.key, group: e.group, label: e.label, help: e.help, kind: e.kind,
    apply: e.apply, category: e.category, min: e.min, max: e.max,
    editable: e.category !== "bootstrap", source: sourceOf(e.key),
  };
  if (isSecret(e)) return { ...base, masked: eff ? maskSecret(eff) : null, hasValue: Boolean(eff) };
  return { ...base, value: eff ?? null };
}

export default async function (app: FastifyInstance) {
  app.get("/config", async () => ({
    entries: CONFIG_REGISTRY.map(view), sync: syncStatus(),
  }));

  app.put("/config", async (req, reply) => {
    const b = req.body as { key?: string; value?: string };
    const entry = b?.key ? configEntry(b.key) : undefined;
    if (!entry) return reply.code(400).send({ error: "key tak dikenal" });
    if (entry.category === "bootstrap") return reply.code(400).send({ error: "bootstrap read-only" });
    if (agentBlocked(req, entry)) return reply.code(403).send({ error: "cookie session required" });
    const raw = b.value ?? "";
    // secret dengan value kosong = pertahankan yang lama (no-op DB).
    if (isSecret(entry) && raw.trim() === "") {
      if (rawDbValue(entry.key) === undefined) return reply.code(400).send({ error: "tak boleh kosong" });
      return view(entry);
    }
    const parsed = parseConfigValue(entry, raw);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    if (entry.key === "SYNC_SERVER_URL") {
      try { await rotateSyncOrigin(parsed.value); }
      catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
      return view(entry);
    }
    await setConfig(entry.key, parsed.value);
    await applyConfigSideEffect(entry.key);
    return view(entry);
  });

  app.delete("/config/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const entry = configEntry(key);
    if (!entry) return reply.code(400).send({ error: "key tak dikenal" });
    if (entry.category === "bootstrap") return reply.code(400).send({ error: "bootstrap read-only" });
    if (agentBlocked(req, entry)) return reply.code(403).send({ error: "cookie session required" });
    await clearConfig(key);
    await applyConfigSideEffect(key);
    return reply.code(204).send();
  });
}
