import { describe, it, expect } from "vitest";
import { zAgentEngine, zLeadEngine, zTelegramSettings, zSetting, TELEGRAM_DEFAULTS, LEAD_DEFAULTS } from "./index";

describe("zAgentEngine (SPEC-492)", () => {
  it("default = override MATI, opus · xhigh", () => {
    expect(zAgentEngine.parse({})).toEqual({
      enabled: false, agent: "claude", model: "opus", effort: "xhigh",
    });
  });

  // Brief SPEC-492: "Tiru bentuk zLeadEngine apa adanya, jangan bikin bentuk ketiga yang beda."
  // Satu definisi, bukan dua yang kebetulan sama — kalau bercabang, ia bercabang diam-diam.
  it("zLeadEngine ADALAH zAgentEngine, bukan salinannya", () => {
    expect(zLeadEngine).toBe(zAgentEngine);
    expect(LEAD_DEFAULTS.engine).toEqual(zAgentEngine.parse({}));
  });

  it("model & effort tetap longgar — katalog ditegakkan permukaan operator, bukan server", () => {
    const v = zAgentEngine.parse({ enabled: true, agent: "codex", model: "gpt-9-belum-ada", effort: "ultra" });
    expect(v.model).toBe("gpt-9-belum-ada");
    expect(zAgentEngine.safeParse({ agent: "gemini" }).success).toBe(false);
  });

  it("telegram punya engine, default MATI supaya instalasi lama tak berubah perilakunya", () => {
    expect(zTelegramSettings.parse({})).toEqual({
      enabled: false, progress: true,
      engine: { enabled: false, agent: "claude", model: "opus", effort: "xhigh" },
    });
    expect(TELEGRAM_DEFAULTS.engine.enabled).toBe(false);
  });

  // Baris Setting lama (pra-SPEC-492) tak punya kunci `engine` sama sekali → wajib tetap parse.
  it("blok telegram lama tanpa engine tetap parse", () => {
    expect(zTelegramSettings.parse({ enabled: true, progress: false }).engine.enabled).toBe(false);
  });
});

describe("setelan setelah changelog dihapus", () => {
  it("setelan lama tetap dapat dibaca, blok changelog dibuang", () => {
    const parsed = zSetting.parse({
      model: "opus", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
      changelog: { enabled: true, agent: "codex", model: "old", effort: "high" },
    });
    expect(parsed).not.toHaveProperty("changelog");
    expect(parsed.model).toBe("opus");
  });
});
