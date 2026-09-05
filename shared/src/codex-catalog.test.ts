import { describe, it, expect } from "vitest";
import {
  CODEX_MODELS, CODEX_EFFORTS, CODEX_DEFAULTS, RETIRED_CODEX_MODELS,
  codexModel, codexEfforts, coerceCodexEffort, cmpVersion, codexClientTooOld,
} from "./entities";

describe("SPEC-339 · katalog codex per-model", () => {
  it("memuat trio GPT-5.6 + gpt-5.5, tanpa model yang dipensiunkan", () => {
    expect(CODEX_MODELS.map((m) => m.id)).toEqual([
      "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
    ]);
  });

  // Nilai verbatim dari `codex debug models` (codex-cli 0.145.0). Luna TIDAK mendukung ultra.
  it("Luna tak mendukung ultra; 5.5 tak mendukung max maupun ultra", () => {
    expect(codexEfforts("gpt-5.6-sol")).toEqual(["ultra", "max", "xhigh", "high", "medium", "low"]);
    expect(codexEfforts("gpt-5.6-luna")).toEqual(["max", "xhigh", "high", "medium", "low"]);
    expect(codexEfforts("gpt-5.5")).toEqual(["xhigh", "high", "medium", "low"]);
  });

  it("minClient mengikuti manifest: trio 5.6 butuh 0.144.0", () => {
    expect(codexModel("gpt-5.6-sol")?.minClient).toBe("0.144.0");
    expect(codexModel("gpt-5.6-terra")?.minClient).toBe("0.144.0");
    expect(codexModel("gpt-5.6-luna")?.minClient).toBe("0.144.0");
    expect(codexModel("gpt-5.5")?.minClient).toBe("0.124.0");
  });

  it("effort tak didukung diturunkan ke fallback model", () => {
    expect(coerceCodexEffort("gpt-5.6-luna", "ultra")).toBe("xhigh");
    expect(coerceCodexEffort("gpt-5.5", "max")).toBe("xhigh");
    expect(coerceCodexEffort("gpt-5.5", "ultra")).toBe("xhigh");
  });

  it("effort yang didukung diteruskan apa adanya", () => {
    expect(coerceCodexEffort("gpt-5.6-sol", "ultra")).toBe("ultra");
    expect(coerceCodexEffort("gpt-5.6-luna", "max")).toBe("max");
    expect(coerceCodexEffort("gpt-5.5", "low")).toBe("low");
  });

  // Katalog kita TIDAK boleh jadi gerbang yang memblokir model yang belum sempat didaftar —
  // server sengaja lenient (z.string()).
  it("model tak dikenal: effort diteruskan apa adanya, daftar jatuh ke irisan aman", () => {
    expect(coerceCodexEffort("gpt-7-belum-ada", "ultra")).toBe("ultra");
    expect(codexEfforts("gpt-7-belum-ada")).toEqual(["xhigh", "high", "medium", "low"]);
    expect(codexModel("gpt-7-belum-ada")).toBeUndefined();
  });

  it("model pensiun dipetakan ke gpt-5.5 — aman untuk CLI lama", () => {
    expect(RETIRED_CODEX_MODELS["gpt-5.3-codex-spark"]).toBe("gpt-5.5");
    expect(RETIRED_CODEX_MODELS["gpt-5.4"]).toBe("gpt-5.5");
    expect(RETIRED_CODEX_MODELS["gpt-5.4-mini"]).toBe("gpt-5.5");
  });

  it("default codex = gpt-5.6-sol / xhigh, dan CODEX_EFFORTS adalah gabungan", () => {
    expect(CODEX_DEFAULTS).toEqual({ model: "gpt-5.6-sol", effort: "xhigh" });
    expect(CODEX_EFFORTS).toEqual(["ultra", "max", "xhigh", "high", "medium", "low"]);
  });

  // localeCompare akan bilang "0.9.0" > "0.144.0" — perbandingan WAJIB numerik per segmen.
  it("cmpVersion membandingkan numerik per segmen", () => {
    expect(cmpVersion("0.142.5", "0.144.0")).toBeLessThan(0);
    expect(cmpVersion("0.145.0", "0.144.0")).toBeGreaterThan(0);
    expect(cmpVersion("0.144.0", "0.144.0")).toBe(0);
    expect(cmpVersion("0.9.0", "0.144.0")).toBeLessThan(0);
  });

  it("codexClientTooOld: aturan peringatan versi tinggal di satu tempat", () => {
    expect(codexClientTooOld("gpt-5.6-sol", "0.142.5")).toBe(true);
    expect(codexClientTooOld("gpt-5.6-sol", "0.145.0")).toBe(false);
    expect(codexClientTooOld("gpt-5.6-sol", "0.144.0")).toBe(false);
    // gpt-5.5 hanya butuh 0.124.0 — CLI 0.142.5 sudah cukup, jangan ikut diperingatkan.
    expect(codexClientTooOld("gpt-5.5", "0.142.5")).toBe(false);
    // Versi tak terdeteksi & model tak dikenal tak pernah memicu peringatan.
    expect(codexClientTooOld("gpt-5.6-sol", null)).toBe(false);
    expect(codexClientTooOld("gpt-7-belum-ada", "0.1.0")).toBe(false);
  });
});
