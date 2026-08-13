import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { getSetting, sessionModel, sessionAgentDefaults, DEFAULT_SETTING } from "../src/services/settings";
import { DEFAULT_METHOD, resolveMethod } from "@hanoman/shared";

// Baris Setting adalah `Json` bebas bentuk. Baris yang ditulis SEBELUM SPEC-162 menyimpan
// `steps` per fase dan tak punya `model` maupun `effort` — dikembalikan mentah, sesi lahir
// dengan `claude --model undefined`.
const BARIS_LAMA = {
  steps: { brainstorm: { model: "claude-opus-5", effort: "xhigh" } },
  blockStale: true, requireLinks: true, maxConcurrent: 6, askTimeoutMin: 30,
  autoDefault: true, autoScaffold: true, notifyFail: true,
};

describe("settings", () => {
  beforeEach(async () => { await resetDb(); });

  it("DB tanpa baris Setting jatuh ke default, bukan melempar P2025", async () => {
    expect(await getSetting()).toEqual(DEFAULT_SETTING);
  });

  it("baris pra-SPEC-162 diberi model + effort, dan kunci matinya dibuang", async () => {
    await prisma.setting.create({ data: { id: 1, data: BARIS_LAMA } });
    const s = await getSetting();
    expect(s.model).toBe("claude-opus-5");
    expect(s.effort).toBe("xhigh");
    expect(s).not.toHaveProperty("steps");
    expect(s).not.toHaveProperty("maxConcurrent");
  });

  it("sessionModel tak pernah mengembalikan undefined ke argv claude", async () => {
    await prisma.setting.create({ data: { id: 1, data: BARIS_LAMA } });
    const { model, effort } = await sessionModel();
    expect(model).toBeTruthy();
    expect(effort).toBeTruthy();
  });

  it("data yang benar-benar rusak jatuh ke default, tidak mengosongkan layar Settings", async () => {
    await prisma.setting.create({ data: { id: 1, data: { sampah: true } } });
    expect(await getSetting()).toEqual(DEFAULT_SETTING);
  });

  it("default memuat notifyDone + notifySound (SPEC-180)", () => {
    expect(DEFAULT_SETTING.notifyDone).toBe(true);
    expect(DEFAULT_SETTING.notifySound).toBe("short");
  });

  it("default memuat notifyDecision + notifyDecisionSound (SPEC-184)", () => {
    expect(DEFAULT_SETTING.notifyDecision).toBe(true);
    expect(DEFAULT_SETTING.notifyDecisionSound).toBe("alert");
  });

  it("baris yang sudah bentuk baru dikembalikan apa adanya", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      model: "claude-sonnet-5", effort: "low", autoDefault: false, autoScaffold: false, notifyFail: false } } });
    const s = await getSetting();
    expect(s.model).toBe("claude-sonnet-5");
    expect(s.effort).toBe("low");
    expect(s.autoDefault).toBe(false);
  });

  // SPEC-252 · ADR-0061 — matrix per-fase dicabut; model/effort per sesi (default global).
  it("DEFAULT_SETTING tak punya phaseModels", () => {
    expect("phaseModels" in DEFAULT_SETTING).toBe(false);
  });
  it("baris lama yang masih memuat phaseModels tetap parse; sessionModel = global", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      model: "claude-sonnet-5", effort: "low", autoDefault: true, autoScaffold: true, notifyFail: true,
      phaseModels: { feature: { Execute: { effort: "max" } } },
    } } });
    const s = await getSetting();
    expect("phaseModels" in s).toBe(false);
    expect(await sessionModel()).toEqual({ model: "claude-sonnet-5", effort: "low" });
  });

  // SPEC-338 · ADR-0074 — agen menentukan blok model/effort mana yang jadi default sesi.
  it("sessionAgentDefaults mengembalikan model codex saat agent=codex", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      ...DEFAULT_SETTING, agent: "codex", codex: { model: "gpt-5.6-terra", effort: "low" },
    } as unknown as object } });
    expect(await sessionAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "low" });
  });

  it("sessionAgentDefaults default = claude memakai model/effort claude", async () => {
    expect(await sessionAgentDefaults()).toEqual({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
  });

  it("baris Setting lama (tanpa agent/codex) tetap claude — tanpa migration", async () => {
    await prisma.setting.create({ data: { id: 1, data: BARIS_LAMA } });
    const s = await getSetting();
    expect(s.agent).toBe("claude");
    expect(s.codex).toEqual({ model: "gpt-5.6-sol", effort: "xhigh" });
  });

  // SPEC-339 · baris Setting lama menyimpan model codex yang sudah dipensiunkan. Dibaca mentah,
  // UI menampilkan Select kosong dan sesi lahir dengan model yang tak ada di picker.
  it("meremap model codex pensiun ke gpt-5.5 saat dibaca", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      ...DEFAULT_SETTING, codex: { model: "gpt-5.3-codex-spark", effort: "high" },
    } as unknown as object } });
    const s = await getSetting();
    expect(s.codex).toEqual({ model: "gpt-5.5", effort: "high" });
  });

  it("mengoreksi effort yang tak didukung model tersimpan", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      ...DEFAULT_SETTING, codex: { model: "gpt-5.6-luna", effort: "ultra" },
    } as unknown as object } });
    const s = await getSetting();
    expect(s.codex).toEqual({ model: "gpt-5.6-luna", effort: "xhigh" });
  });

  // Pensiun + koersi harus berurutan: effort divalidasi terhadap model HASIL pemetaan.
  it("model pensiun + effort mustahil → keduanya dibereskan sekaligus", async () => {
    await prisma.setting.create({ data: { id: 1, data: {
      ...DEFAULT_SETTING, codex: { model: "gpt-5.4", effort: "ultra" },
    } as unknown as object } });
    const s = await getSetting();
    expect(s.codex).toEqual({ model: "gpt-5.5", effort: "xhigh" });
  });

  // SPEC-734 · AC-8 · baris Setting yang ditulis SEBELUM spec ini tak punya kunci `method`;
  // `.default()` mengisinya saat dibaca → tanpa migration, cermin goal/codex/verifyScope.
  it("baris Setting lama tetap parse dan mendapat method default", async () => {
    await prisma.setting.create({ data: { id: 1, data: BARIS_LAMA } });
    expect((await getSetting()).method).toBe(DEFAULT_METHOD);
  });

  it("method tersimpan dikembalikan apa adanya", async () => {
    await prisma.setting.create({ data: { id: 1, data: { ...BARIS_LAMA, method: "matt" } } });
    expect((await getSetting()).method).toBe("matt");
  });

  // AC-9 · id dari hub yang belum ada di build ini TIDAK boleh membuat baris gagal parse (layar
  // Settings kosong). Nilainya juga TIDAK dikoersi saat dibaca — yang lenient adalah
  // `resolveMethod()` di titik pakai, supaya nilai hub tak dibuang diam-diam.
  it("method tak dikenal tetap parse, dan resolveMethod menjatuhkannya ke default", async () => {
    await prisma.setting.create({ data: { id: 1, data: { ...BARIS_LAMA, method: "tak-ada" } } });
    const s = await getSetting();
    expect(s.method).toBe("tak-ada");
    expect(resolveMethod(s.method).id).toBe(DEFAULT_METHOD);
  });

  it("DEFAULT_SETTING memakai DEFAULT_METHOD", () => {
    expect(DEFAULT_SETTING.method).toBe(DEFAULT_METHOD);
  });
});
