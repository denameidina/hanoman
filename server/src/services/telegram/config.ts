import type { Prisma } from "@prisma/client";
import { coerceCodexEffort, type Agent, type AgentEngine, type TelegramSettings } from "@hanoman/shared";
import { prisma } from "../../db";
import { getSetting, sessionAgentDefaults } from "../settings";
import type { EngineContext } from "./engine-command";

// SPEC-492 · cermin `services/lead/config.ts`. Blok `telegram.engine` hidup di dalam Setting
// singleton (id=1); `getSetting` sudah mengisi default (zTelegramSettings.engine) untuk baris
// lama tanpa blok ini → tanpa migration.
export async function getTelegramEngine(): Promise<AgentEngine> {
  return (await getSetting()).telegram.engine;
}

/**
 * Ganti blok engine saja; pertahankan seluruh Setting lain. WAJIB read-modify-write dari
 * `getSetting()` SEGAR — blok `telegram` punya penulis kedua (`PUT /settings` dari layar
 * Settings), dan menulis dari snapshot adalah kelas bug SPEC-488 pada blok `lead`.
 */
export async function setTelegramEngine(next: AgentEngine): Promise<AgentEngine> {
  const cur = await getSetting();
  const data = { ...cur, telegram: { ...cur.telegram, engine: next } } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  return next;
}

/**
 * Agen yang menjalankan SESI OPERATOR Telegram. Sejajar `leadAgentDefaults()`: selama
 * `telegram.engine.enabled` mati ia mendelegasikan penuh ke default sesi global — satu setelan
 * agen, bukan dua yang bisa berselisih diam-diam. Effort codex dikoersi di sini (SPEC-339:
 * effort adalah properti MODEL) supaya blok ini tak bisa melahirkan sesi yang ditolak codex.
 */
export async function telegramAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const e = (await getSetting()).telegram.engine;
  if (!e.enabled) return sessionAgentDefaults();
  return e.agent === "codex"
    ? { agent: "codex", model: e.model, effort: coerceCodexEffort(e.model, e.effort) }
    : { agent: e.agent, model: e.model, effort: e.effort };
}

/**
 * SPEC-492 · seluruh keadaan yang dibutuhkan parser command, dalam satu bacaan Setting.
 * `effective` sengaja diambil dari `telegramAgentDefaults()` — satu definisi "apa yang berlaku",
 * bukan dua yang bisa berselisih.
 */
export async function telegramEngineContext(): Promise<EngineContext> {
  const s = await getSetting();
  return {
    enabled: s.telegram.engine.enabled,
    effective: await telegramAgentDefaults(),
    claude: { model: s.model, effort: s.effort },
    codex: { model: s.codex.model, effort: s.codex.effort },
    antigravity: { model: s.antigravity.model, effort: s.antigravity.effort },
  };
}

/**
 * `PUT /settings` me-reload gateway bila blok `telegram` berubah — dan reload itu tak gratis:
 * ia menghentikan long-poll lalu memanggil `getMe()`, jadi kegagalan jaringan sesaat menjatuhkan
 * `readiness` ke `error`. `engine` dibaca LAZY oleh `telegramAgentDefaults()` di tiap kelahiran
 * sesi, jadi ia tak pernah butuh reload. Sisa bloknya tetap dibandingkan utuh (bukan field per
 * field) supaya field telegram yang ditambahkan nanti otomatis ikut memicu reload.
 */
export function telegramReloadNeeded(before: TelegramSettings, after: TelegramSettings): boolean {
  const strip = ({ engine: _engine, ...rest }: TelegramSettings) => rest;
  return JSON.stringify(strip(before)) !== JSON.stringify(strip(after));
}
