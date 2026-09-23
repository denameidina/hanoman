import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { getSetting } from "../src/services/settings";
import {
  getTelegramEngine, setTelegramEngine, telegramAgentDefaults, telegramEngineContext,
  telegramReloadNeeded,
} from "../src/services/telegram/config";

const setting = async (over: Record<string, unknown>) => {
  const base = await getSetting();
  await prisma.setting.create({ data: { id: 1, data: { ...base, ...over } as never } });
};

describe("SPEC-492 · resolver agen operator Telegram", () => {
  beforeEach(async () => { await resetDb(); });

  // AC-2 cabang 1: opt-in MATI = warisan penuh, tak sebyte pun berbeda dari sesi kerja.
  it("engine mati → sessionAgentDefaults() persis", async () => {
    await setting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    expect(await telegramAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  it("DB tanpa baris Setting sama sekali tetap menjawab default global", async () => {
    expect(await telegramAgentDefaults()).toEqual({ agent: "claude", model: "sonnet", effort: "medium" });
  });

  it("engine hidup → nilai engine, bukan default global", async () => {
    await setting({
      model: "claude-opus-5", effort: "xhigh",
      telegram: { enabled: true, progress: true, engine: { enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "low" } },
    });
    expect(await telegramAgentDefaults()).toEqual({ agent: "claude", model: "claude-haiku-4-5", effort: "low" });
  });

  // SPEC-339 · effort adalah properti MODEL. Luna tak mendukung `ultra`; meneruskannya apa adanya
  // berarti sesi operator lahir dengan pasangan yang ditolak codex.
  it("engine codex → effort dikoersi ke katalog model", async () => {
    await setting({
      telegram: { enabled: true, progress: true, engine: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "ultra" } },
    });
    expect(await telegramAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });

  it("setTelegramEngine menulis tanpa merusak field Setting lain", async () => {
    await setting({
      model: "claude-sonnet-5",
      telegram: { enabled: true, progress: false, engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" } },
    });
    await setTelegramEngine({ enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "medium" });
    const s = await getSetting();
    expect(s.model).toBe("claude-sonnet-5");          // blok akar utuh
    expect(s.telegram.enabled).toBe(true);            // saudara sebidang utuh
    expect(s.telegram.progress).toBe(false);
    expect(await getTelegramEngine()).toEqual({ enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "medium" });
  });

  it("setTelegramEngine tetap bekerja saat baris Setting belum ada", async () => {
    await setTelegramEngine({ enabled: true, agent: "claude", model: "claude-fable-5", effort: "high" });
    expect((await getTelegramEngine()).model).toBe("claude-fable-5");
  });

  // AC-9 · reload menghentikan long-poll lalu memanggil getMe(); menjatuhkan readiness ke `error`
  // gara-gara satu dropdown digeser adalah harga yang tak perlu — `engine` dibaca LAZY tiap sesi lahir.
  it("gerbang reload buta terhadap engine, tapi awas terhadap enabled/progress", () => {
    const eng = (model: string) => ({ enabled: false, agent: "claude" as const, model, effort: "xhigh" });
    const a = { enabled: true, progress: true, engine: eng("claude-opus-5") };
    expect(telegramReloadNeeded(a, { ...a, engine: eng("claude-haiku-4-5") })).toBe(false);
    expect(telegramReloadNeeded(a, { ...a, enabled: false })).toBe(true);
    expect(telegramReloadNeeded(a, { ...a, progress: false })).toBe(true);
    expect(telegramReloadNeeded(a, { ...a })).toBe(false);
  });
});

describe("SPEC-492 · konteks command runtime", () => {
  beforeEach(async () => { await resetDb(); });

  it("mati → effective = default global, blok claude & codex ikut disodorkan", async () => {
    await setting({
      agent: "claude", model: "claude-sonnet-5", effort: "high",
      codex: { model: "gpt-5.5", effort: "medium" },
    });
    expect(await telegramEngineContext()).toEqual({
      enabled: false,
      effective: { agent: "claude", model: "claude-sonnet-5", effort: "high" },
      claude: { model: "claude-sonnet-5", effort: "high" },
      codex: { model: "gpt-5.5", effort: "medium" },
    });
  });

  it("hidup → effective = nilai engine", async () => {
    await setting({
      telegram: { enabled: true, progress: true, engine: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "max" } },
    });
    const ctx = await telegramEngineContext();
    expect(ctx.enabled).toBe(true);
    expect(ctx.effective).toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "max" });
  });
});
