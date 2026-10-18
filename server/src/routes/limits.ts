import type { FastifyInstance } from "fastify";
import { getLimits } from "../services/limits";
import { getCodexLimits } from "../services/codex-limits";
import { getAntigravityLimits } from "../services/antigravity-limits";

// GET /api/limits — auth-gated otomatis (bukan anggota PUBLIC di app.ts). Limit langganan Claude
// realtime; poll frontend tiap 60s, cache 30s di service. Lihat SPEC-181.
// GET /api/limits/codex (SPEC-338/ADR-0074) — limit codex, dibaca dari snapshot `rate_limits` di
// rollout sesi codex (tanpa jaringan). Endpoint TERPISAH, bukan memperluas bentuk /limits: sumber
// dan semantik kesegarannya beda, dan badge-nya pun terpisah di top bar.
// GET /api/limits/antigravity (ADR-0224) — limit Antigravity CLI, panggilan live ke Cloud Code API
// Google dengan token agy yang hidup (tak pernah di-refresh). Terpisah dengan alasan yang sama.
export default async function limits(app: FastifyInstance) {
  app.get("/limits", async () => getLimits());
  app.get("/limits/codex", async () => getCodexLimits());
  app.get("/limits/antigravity", async () => getAntigravityLimits());
}
