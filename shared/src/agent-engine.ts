import { z } from "zod";
import { zAgent } from "./enums";

/**
 * SPEC-492 · bentuk BERSAMA "override agen": satu triple (agen + model + effort) di atas satu
 * saklar opt-in. Dipakai `Setting.lead.engine` (SPEC-409/ADR-0091) dan `Setting.telegram.engine`
 * (SPEC-492). Sengaja SATU definisi, bukan dua yang kebetulan sama — dua definisi bercabang
 * diam-diam, dan kartu Settings keduanya memakai kode render yang sama.
 *
 * Ia hidup di modul DAUN (hanya zod + ./enums) karena `entities.ts` sudah meng-import
 * `./telegram`: mendefinisikannya di entities lalu meng-import-nya dari telegram menutup siklus
 * modul, dan `TELEGRAM_DEFAULTS = zTelegramSettings.parse({})` yang jalan di top level akan
 * membaca binding yang masih TDZ → `ReferenceError` sebelum satu route pun terdaftar.
 *
 * `model`/`effort` sengaja `z.string()` longgar seperti di akar `zSetting`: katalog ditegakkan
 * permukaan operator (kartu Settings, parser command Telegram), bukan server.
 */
export const zAgentEngine = z.object({
  enabled: z.boolean().default(false),
  agent: zAgent.default("claude"),
  model: z.string().default("opus"),
  effort: z.string().default("xhigh"),
});
export type AgentEngine = z.infer<typeof zAgentEngine>;
