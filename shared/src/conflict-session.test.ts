import { describe, it, expect } from "vitest";
import { zConflict, CONFLICT_DEFAULTS, zSetting } from "./entities";

// SPEC-383 · ADR-0081 · blok default khusus sesi penyelesai konflik rebase/merge. Opt-in:
// `enabled: false` berarti sesi konflik mewarisi default global persis seperti sebelum SPEC-383.
describe("SPEC-383 · zConflict", () => {
  it("default = mati, agen claude, model/effort default claude", () => {
    expect(CONFLICT_DEFAULTS).toEqual({
      enabled: false, agent: "claude", model: "opus", effort: "xhigh",
    });
    expect(zConflict.parse({})).toEqual(CONFLICT_DEFAULTS);
  });

  it("agen di luar katalog ditolak (cermin zAgent)", () => {
    expect(zConflict.safeParse({ agent: "gemini" }).success).toBe(false);
  });

  it("model/effort tetap lenient z.string() — server tak mengunci katalog", () => {
    const r = zConflict.parse({ enabled: true, agent: "codex", model: "gpt-9", effort: "brutal" });
    expect(r).toEqual({ enabled: true, agent: "codex", model: "gpt-9", effort: "brutal" });
  });
});

describe("SPEC-383 · zSetting.conflict", () => {
  // Kolom `Setting.data` bertipe Json: baris yang ditulis sebelum SPEC-383 tak punya kunci ini.
  // `.default()` mengisinya saat dibaca → tanpa migration, cermin goal/codex/verifyScope.
  it("baris Setting lama tanpa blok conflict tetap parse dan terisi default", () => {
    const parsed = zSetting.parse({
      model: "claude-opus-5", effort: "xhigh",
      autoDefault: true, autoScaffold: true, notifyFail: true,
    });
    expect(parsed.conflict).toEqual(CONFLICT_DEFAULTS);
  });

  it("blok conflict tersimpan dikembalikan apa adanya", () => {
    const parsed = zSetting.parse({
      model: "claude-opus-5", effort: "xhigh",
      autoDefault: true, autoScaffold: true, notifyFail: true,
      conflict: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "medium" },
    });
    expect(parsed.conflict).toEqual({
      enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "medium",
    });
  });
});
