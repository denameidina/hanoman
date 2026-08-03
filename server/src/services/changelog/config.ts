import { coerceCodexEffort, type Agent } from "@hanoman/shared";
import { getSetting, sessionAgentDefaults } from "../settings";

/**
 * SPEC-518 · agen yang MENULIS narasi changelog (SPEC-516/ADR-0105). Cermin `leadAgentDefaults()`
 * (SPEC-409) & `telegramAgentDefaults()` (SPEC-492), dan berperilaku sama dengan
 * `conflictSessionDefaults()` (ADR-0081) saat mati.
 *
 * **Opt-in.** Selama `changelog.enabled` mati ia mendelegasikan PENUH ke `sessionAgentDefaults()`
 * — satu setelan agen yang berlaku, bukan dua yang bisa berselisih diam-diam. Menyalin nilai
 * default ke sini alih-alih mendelegasikan akan membuat instalasi yang mengubah default globalnya
 * tetap memanggil changelog dengan model lama, tanpa satu pun permukaan yang mengatakannya.
 *
 * **Koersi effort di sini, bukan hanya di picker.** Effort adalah properti MODEL (SPEC-339) dan
 * blok ini bisa ditulis lewat `PUT /settings` ber-`AgentToken` yang tak melewati UI mana pun.
 *
 * Dibaca dari `getSetting()` tiap panggilan (tanpa cache) → ganti setelan berlaku pada
 * pembangkitan berikutnya tanpa restart.
 */
export async function changelogAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const e = (await getSetting()).changelog;
  if (!e.enabled) return sessionAgentDefaults();
  return e.agent === "codex"
    ? { agent: "codex", model: e.model, effort: coerceCodexEffort(e.model, e.effort) }
    : { agent: "claude", model: e.model, effort: e.effort };
}
