import type { FastifyInstance } from "fastify";
import { zSetting } from "@hanoman/shared";
import { prisma } from "../db";
import { getSetting } from "../services/settings";
import { reloadTelegramGateway } from "../services/telegram/bootstrap";
import { telegramReloadNeeded } from "../services/telegram/config";
export default async function (app: FastifyInstance) {
  app.get("/settings", async () => getSetting());
  app.put("/settings", async (req, reply) => {
    const parsed = zSetting.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const before = await getSetting();
    // SPEC-1215 · ADR-0165 §4 / ADR-0166 §7–8 · tiga kunci ini dibaca dari baris TERSIMPAN, bukan body:
    // `settings:write` agent token tak boleh menyalakan RCE ke mesinnya sendiri, mengekspor transkrip,
    // atau memendekkan retensi (= menghapus bukti audit). Pengelolanya route COOKIE_ONLY sendiri.
    const data = {
      ...parsed.data,
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
