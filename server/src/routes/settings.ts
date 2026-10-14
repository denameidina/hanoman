import type { FastifyInstance } from "fastify";
import { zSetting, zAntigravityPhaseCell, ORCHESTRATION_FLOWS } from "@hanoman/shared";
import { prisma } from "../db";
import { getSetting } from "../services/settings";
import { markRuntimeDefaultsUserEdited } from "../services/runtime-defaults";
import { reloadTelegramGateway } from "../services/telegram/bootstrap";
import { telegramReloadNeeded } from "../services/telegram/config";
export default async function (app: FastifyInstance) {
  app.get("/settings", async () => getSetting());
  app.put("/settings", async (req, reply) => {
    const parsed = zSetting.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const before = await getSetting();
    const input = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body as Record<string, unknown> : {};
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(input, key);
    const orchestration = parsed.data.orchestration;
    const rawOrchestration = input.orchestration && typeof input.orchestration === "object" && !Array.isArray(input.orchestration)
      ? input.orchestration as Record<string, unknown> : {};
    for (const flow of ORCHESTRATION_FLOWS) {
      const rawFlow = rawOrchestration[flow];
      if (!rawFlow || typeof rawFlow !== "object" || !Object.prototype.hasOwnProperty.call(rawFlow, "antigravity"))
        orchestration[flow].antigravity = before.orchestration[flow].antigravity;
      for (const [phase, cell] of Object.entries(orchestration[flow].antigravity)) {
        const old = before.orchestration[flow].antigravity[phase];
        if (old?.model === cell.model && old?.effort === cell.effort) continue;
        const native = zAntigravityPhaseCell.safeParse(cell);
        if (!native.success) return reply.code(400).send({ error: native.error.flatten() });
      }
    }
    // Klien lama tidak mengirim blok runtime baru. Jangan biarkan default zod mengganti matriks
    // atau pilihan model milik operator hanya karena request datang dari versi dashboard lama.
    const runtimePreserved = {
      ...parsed.data,
      model: has("model") ? parsed.data.model : before.model,
      effort: has("effort") ? parsed.data.effort : before.effort,
      codex: has("codex") ? parsed.data.codex : before.codex,
      antigravity: has("antigravity") ? parsed.data.antigravity : before.antigravity,
      orchestration: has("orchestration") ? orchestration : before.orchestration,
    };
    // SPEC-1215 · ADR-0165 §4 / ADR-0166 §7–8 · tiga kunci ini dibaca dari baris TERSIMPAN, bukan body:
    // `settings:write` agent token tak boleh menyalakan RCE ke mesinnya sendiri, mengekspor transkrip,
    // atau memendekkan retensi (= menghapus bukti audit). Pengelolanya route COOKIE_ONLY sendiri.
    const data = {
      ...runtimePreserved,
      builtinRuntimeDefaults: markRuntimeDefaultsUserEdited(before, runtimePreserved),
      remoteControl: before.remoteControl, logShipping: before.logShipping, logRetention: before.logRetention,
    };
    const row = await prisma.setting.upsert({ where: { id: 1 },
      update: { data }, create: { id: 1, data } });
    // SPEC-477 · ADR-0097 · toggle gateway berlaku LANGSUNG, tanpa restart. Dibandingkan dulu
    // supaya PUT settings yang tak menyentuh Telegram tak memutus long-poll yang sedang jalan.
    // SPEC-492 · `telegram.engine` sengaja DIKECUALIKAN dari perbandingan: ia dibaca lazy tiap
    // sesi operator lahir, jadi menggeser satu dropdown tak boleh memutus long-poll dan
    // mempertaruhkan `readiness` pada satu panggilan `getMe()`.
    if (telegramReloadNeeded(before.telegram, parsed.data.telegram)) {
      await reloadTelegramGateway();
    }
    return row.data;
  });
}
