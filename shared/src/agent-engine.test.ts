import { describe, it, expect } from "vitest";
import { zAgentEngine, zLeadEngine, zTelegramSettings, zSetting, TELEGRAM_DEFAULTS, LEAD_DEFAULTS, CHANGELOG_ENGINE_DEFAULTS } from "./index";

describe("zAgentEngine (SPEC-492)", () => {
  it("default = override MATI, claude-opus-5 · xhigh", () => {
    expect(zAgentEngine.parse({})).toEqual({
      enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh",
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
      engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
    });
    expect(TELEGRAM_DEFAULTS.engine.enabled).toBe(false);
  });

  // Baris Setting lama (pra-SPEC-492) tak punya kunci `engine` sama sekali → wajib tetap parse.
  it("blok telegram lama tanpa engine tetap parse", () => {
    expect(zTelegramSettings.parse({ enabled: true, progress: false }).engine.enabled).toBe(false);
  });
});

// SPEC-518 · agen PEMBUAT CHANGELOG (SPEC-516/ADR-0105) boleh punya runtime/model/effort sendiri.
// Sampai spec ini `generateChangelog` selalu memakai `sessionAgentDefaults()` dan operator tak
// punya satu pun kontrol untuk memisahkannya dari sesi kerja.
describe("Setting.changelog (SPEC-518)", () => {
  // Bentuk KELIMA adalah yang dicegah SPEC-492. Blok changelog wajib memakai skema yang sama
  // dengan lead & telegram, bukan salinan yang bisa bercabang diam-diam.
  it("memakai zAgentEngine, bukan bentuk kelima", () => {
    expect(CHANGELOG_ENGINE_DEFAULTS).toEqual(zAgentEngine.parse({}));
  });

  it("default = override MATI → instalasi lama tak berubah perilakunya", () => {
    expect(CHANGELOG_ENGINE_DEFAULTS).toEqual({
      enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh",
    });
  });

  // Kolom `Setting.data` bertipe Json dan baris yang ditulis sebelum spec ini tak punya kunci
  // `changelog` sama sekali. Tanpa `.default()` seluruh layar Settings mati di baris lama.
  it("baris Setting lama TANPA kunci changelog tetap parse", () => {
    const old = {
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true,
    };
    const parsed = zSetting.safeParse(old);
    expect(parsed.success).toBe(true);
    // Bentuk LITERAL, bukan `toEqual(CHANGELOG_ENGINE_DEFAULTS)`: selama konstantanya belum ada
    // ia `undefined`, dan `undefined` toEqual `undefined` LULUS — test hijau yang tak menguji apa
    // pun (kelas gagal-senyap yang sama dengan kolom yang lupa masuk `FIELDS`).
    expect(parsed.success && parsed.data.changelog).toEqual({
      enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh",
    });
  });

  it("agent di luar claude|codex ditolak; model & effort tetap longgar", () => {
    expect(zSetting.safeParse({
      model: "m", effort: "e", autoDefault: true, autoScaffold: true, notifyFail: true,
      changelog: { agent: "gemini" },
    }).success).toBe(false);
    const ok = zSetting.parse({
      model: "m", effort: "e", autoDefault: true, autoScaffold: true, notifyFail: true,
      changelog: { enabled: true, agent: "codex", model: "gpt-9-belum-ada", effort: "ultra" },
    });
    expect(ok.changelog.model).toBe("gpt-9-belum-ada");
  });
});
