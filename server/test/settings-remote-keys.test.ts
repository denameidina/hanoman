import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { DEFAULT_SETTING, getSetting } from "../src/services/settings";
import { makeSetting, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
beforeEach(resetDb);
afterAll(async () => { await resetDb(); await app.close(); });

// SPEC-1215 · ADR-0165 §4 / ADR-0166 §7–8 · agent token ber-`settings:write` tak boleh menyalakan
// kendali jarak jauh ke mesinnya sendiri, menyalakan ekspor transkrip, atau memendekkan retensi audit.
describe("PUT /settings tak menulis kunci LOCAL-only SPEC-1215 (AC-A3)", () => {
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
});
