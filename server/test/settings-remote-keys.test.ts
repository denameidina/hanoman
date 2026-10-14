import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { DEFAULT_SETTING, getSetting } from "../src/services/settings";
import { applyRuntimeDefaults } from "../src/services/runtime-defaults";
import { makeSetting, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
beforeEach(resetDb);
afterAll(async () => { await resetDb(); await app.close(); });

// SPEC-1215 · ADR-0165 §4 / ADR-0166 §7–8 · agent token ber-`settings:write` tak boleh menyalakan
// kendali jarak jauh ke mesinnya sendiri, menyalakan ekspor transkrip, atau memendekkan retensi audit.
describe("PUT /settings tak menulis kunci LOCAL-only SPEC-1215 (AC-A3)", () => {
  it("old clients omitting Antigravity defaults and phase matrix preserve operator choices", async () => {
    const current = applyRuntimeDefaults(undefined)!.data;
    current.antigravity = { model: "future-parent", effort: "low" };
    current.orchestration.feature.antigravity.Plan = { model: "pro", effort: null };
    current.builtinRuntimeDefaults.antigravity = { model: "user", effort: "user" };
    current.builtinRuntimeDefaults.orchestration["feature.antigravity.Plan.model"] = "user";
    await makeSetting(current);
    const { antigravity: _antigravity, ...oldBody } = structuredClone(current);
    for (const flow of Object.values(oldBody.orchestration)) Reflect.deleteProperty(flow, "antigravity");
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: { ...oldBody, notifyDone: false } });
    expect(put.statusCode).toBe(200);
    const after = await getSetting();
    expect(after.antigravity).toEqual(current.antigravity);
    expect(after.orchestration.feature.antigravity).toEqual(current.orchestration.feature.antigravity);
    expect(after.builtinRuntimeDefaults.antigravity).toEqual(current.builtinRuntimeDefaults.antigravity);
    expect(after.builtinRuntimeDefaults.claude).toEqual(current.builtinRuntimeDefaults.claude);
    expect(after.builtinRuntimeDefaults.codex).toEqual(current.builtinRuntimeDefaults.codex);
  });

  it("PUT Antigravity edits mark ownership while keeping native phase effort null", async () => {
    const before = applyRuntimeDefaults(undefined)!.data;
    await makeSetting(before);
    const next = structuredClone(before);
    next.antigravity = { model: "future-parent", effort: "medium" };
    next.orchestration.feature.antigravity.Plan = { model: "flash", effort: null };
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: next });
    expect(put.statusCode).toBe(200);
    const after = await getSetting();
    expect(after.builtinRuntimeDefaults.antigravity).toEqual({ model: "user", effort: "user" });
    expect(after.builtinRuntimeDefaults.orchestration["feature.antigravity.Plan.model"]).toBe("user");
    expect(after.builtinRuntimeDefaults.claude).toEqual(before.builtinRuntimeDefaults.claude);
  });

  it.each([{ model: "gemini-3.8-flash-high", effort: null }, { model: "flash", effort: "high" }])(
    "PUT rejects a new incompatible native phase cell %j without writing", async (cell) => {
      const before = applyRuntimeDefaults(undefined)!.data;
      await makeSetting(before);
      const next = structuredClone(before);
      next.orchestration.feature.antigravity.Plan = cell;
      const put = await app.inject({ method: "PUT", url: "/api/settings", payload: next });
      expect(put.statusCode).toBe(400);
      expect((await getSetting()).orchestration.feature.antigravity.Plan)
        .toEqual(before.orchestration.feature.antigravity.Plan);
    },
  );

  it("PUT unrelated edits preserve legacy incompatible native phase cells", async () => {
    const before = applyRuntimeDefaults(undefined)!.data;
    before.orchestration.feature.antigravity.Plan = { model: "legacy-slug", effort: "high" };
    await makeSetting(before);
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: { ...before, notifyDone: false } });
    expect(put.statusCode).toBe(200);
    expect((await getSetting()).orchestration.feature.antigravity.Plan)
      .toEqual(before.orchestration.feature.antigravity.Plan);
  });
  it("default kunci baru: grant mati, hanya lajur event, retensi 90/7/30", () => {
    expect(DEFAULT_SETTING.remoteControl).toEqual({ enabled: false, capabilities: [] });
    expect(DEFAULT_SETTING.logShipping).toEqual({ event: true, server: false, transcript: false });
    expect(DEFAULT_SETTING.logRetention).toEqual({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 268435456 });
  });

  it("body yang MENYALAKAN grant/lajur/retensi diabaikan — nilai tersimpan bertahan", async () => {
    const body = {
      ...DEFAULT_SETTING,
      remoteControl: { enabled: true, capabilities: ["sessions:read", "sessions:spawn"] },
      logShipping: { event: true, server: true, transcript: true },
      logRetention: { eventDays: 1, serverDays: 1, transcriptDays: 1, maxBytes: 16 * 1024 ** 2 },
    };
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: body });
    expect(put.statusCode).toBe(200);
    const s = await getSetting();
    expect(s.remoteControl).toEqual({ enabled: false, capabilities: [] });
    expect(s.logShipping).toEqual({ event: true, server: false, transcript: false });
    expect(s.logRetention.eventDays).toBe(90);
  });

  it("body yang MEMATIKAN grant juga diabaikan, sementara kunci lain tetap tertulis", async () => {
    await makeSetting({ remoteControl: { enabled: true, capabilities: ["sessions:read"] } });
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: { ...DEFAULT_SETTING, notifyDone: false } });
    expect(put.statusCode).toBe(200);
    const s = await getSetting();
    expect(s.notifyDone).toBe(false);
    expect(s.remoteControl).toEqual({ enabled: true, capabilities: ["sessions:read"] });
  });

  it("edit model dan satu sel fase ditandai user lalu tetap dipertahankan saat seed berikutnya", async () => {
    const orchestration = structuredClone(DEFAULT_SETTING.orchestration);
    orchestration.feature.claude.Plan = { model: "custom-claude", effort: "high" };
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: {
      ...DEFAULT_SETTING, model: "custom-claude", effort: "low", orchestration,
    } });
    expect(put.statusCode).toBe(200);
    const current = await getSetting();
    expect(current.builtinRuntimeDefaults.claude.model).toBe("user");
    expect(current.builtinRuntimeDefaults.orchestration["feature.claude.Plan.model"]).toBe("user");

    const upgraded = applyRuntimeDefaults(current)!;
    expect(upgraded.data.model).toBe("custom-claude");
    expect(upgraded.data.effort).toBe("low");
    expect(upgraded.data.orchestration.feature.claude.Plan).toEqual({ model: "custom-claude", effort: "high" });
    expect(upgraded.data.orchestration.feature.claude.Execute).toEqual(
      DEFAULT_SETTING.orchestration.feature.claude.Execute,
    );
  });

  // S5 · kontrak yang diandalkan rebase dashboard (settings-rebase.ts): body = DB TERBARU + satu
  // perubahan non-runtime → tak satu pun model/effort/sel orkestrasi ditandai `user`, sehingga seed
  // berikutnya tetap bebas memperbaruinya. (Yang dulu merusak: body = snapshot mount yang basi.)
  it("S5 · PUT berbasis DB terbaru yang hanya mengubah notifySound tak menandai runtime `user`", async () => {
    const fresh = await getSetting();
    const put = await app.inject({ method: "PUT", url: "/api/settings",
      payload: { ...fresh, notifySound: fresh.notifySound === "short" ? "chime" : "short" } });
    expect(put.statusCode).toBe(200);
    const marker = (await getSetting()).builtinRuntimeDefaults;
    expect(marker.claude).toEqual({ model: "seeded", effort: "seeded" });
    expect(marker.codex).toEqual({ model: "seeded", effort: "seeded" });
    expect(Object.values(marker.orchestration).every((v) => v === "seeded")).toBe(true);
  });
});
