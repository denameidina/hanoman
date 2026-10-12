// Audit UI/UX 2026-10 · Fase 3C · penulis blok engine yang TAK lewat PUT /settings biasa.
//
// Blok `lead` punya penulis kedua (LeadScreen: rem darurat, denyut) dan blok `telegram` punya penulis
// ketiga (command /runtime, /model, /effort dari chat). Mengirim snapshot mount ke PUT /settings akan
// membalik perubahan mereka tanpa satu klik pun yang mengatakannya (SPEC-488, SPEC-492). Karena itu
// setiap penulis di sini MEMBACA ULANG blok segar sebelum menulis, lalu hanya menempelkan `engine`.
import { LEAD_DEFAULTS, TELEGRAM_DEFAULTS } from "@hanoman/shared";
import type { Setting } from "@hanoman/shared";
import { api } from "../../api/client";
import type { ShowToast } from "../../ds";
import type { SettingsStore } from "./useSettingsStore";

export type LeadEngine = Setting["lead"]["engine"];
export type TelegramEngine = Setting["telegram"]["engine"];

/** Resolve `true` bila tersimpan. Galat ditampilkan sebagai toast dan blok dikembalikan (rollback). */
export async function saveLeadEngine(
  store: SettingsStore, onToast: ShowToast | undefined, patch: Partial<LeadEngine>, msg: string,
): Promise<boolean> {
  const prev = store.current()?.lead ?? LEAD_DEFAULTS;
  const engineOf = (lead: Setting["lead"] | undefined) => (lead ?? LEAD_DEFAULTS).engine ?? LEAD_DEFAULTS.engine;
  store.update((p) => ({ ...p, lead: { ...(p.lead ?? LEAD_DEFAULTS), engine: { ...engineOf(p.lead), ...patch } } }));
  try {
    const fresh = await api.getLeadConfig();
    const saved = await api.putLeadConfig({
      ...fresh, engine: { ...(fresh.engine ?? LEAD_DEFAULTS.engine), ...patch },
    });
    store.update((p) => ({ ...p, lead: saved }));
    onToast?.(msg, "ok", "check-circle-2");
    return true;
  } catch {
    store.update((p) => ({ ...p, lead: prev }));
    onToast?.("Gagal menyimpan setelan lead", "err", "alert-triangle");
    return false;
  }
}

/** Sama seperti `saveLeadEngine`, untuk blok `telegram` lewat GET + PUT /settings yang di-rebase. */
export async function saveTelegramEngine(
  store: SettingsStore, onToast: ShowToast | undefined, patch: Partial<TelegramEngine>, msg: string,
): Promise<boolean> {
  const prevTg = store.current()?.telegram ?? TELEGRAM_DEFAULTS;
  const engineOf = (tg: Setting["telegram"]) => tg.engine ?? TELEGRAM_DEFAULTS.engine;
  store.update((p) => ({ ...p, telegram: { ...(p.telegram ?? TELEGRAM_DEFAULTS), engine: { ...engineOf(p.telegram ?? TELEGRAM_DEFAULTS), ...patch } } }));
  try {
    const fresh = await api.getSettings();
    const freshTg = fresh.telegram ?? TELEGRAM_DEFAULTS;
    const next: Setting = {
      ...fresh,
      telegram: { ...freshTg, engine: { ...(freshTg.engine ?? TELEGRAM_DEFAULTS.engine), ...patch } },
    };
    const saved = await api.putSettings(next);
    store.update((p) => ({ ...p, telegram: (saved ?? next).telegram ?? p.telegram }));
    onToast?.(msg, "ok", "check-circle-2");
    return true;
  } catch {
    store.update((p) => ({ ...p, telegram: prevTg }));
    onToast?.("Gagal menyimpan setelan operator Telegram", "err", "alert-triangle");
    return false;
  }
}
