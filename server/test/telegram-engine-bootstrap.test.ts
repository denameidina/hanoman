import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { buildApp } from "../src/app";
import { issueAgentToken } from "../src/services/agent-token";
import { DEFAULT_SETTING, getSetting } from "../src/services/settings";
import { TelegramStore } from "../src/services/telegram/store";
import { telegramSessionDeps } from "../src/services/telegram/bootstrap";

const deps = () => telegramSessionDeps({
  apiBase: "http://127.0.0.1:7777", agentToken: "hnm_agt_X", store: new TelegramStore(prisma),
});

describe("SPEC-492 · bootstrap memakai resolver Telegram", () => {
  beforeEach(async () => { await resetDb(); });

  // AC-3 · sebelum SPEC-492 field ini `sessionAgentDefaults`, jadi sesi operator SELALU mengikuti
  // default global sesi kerja tanpa jalan memisahkannya.
  it("deps.defaults() menuruti Setting.telegram.engine, bukan default global", async () => {
    const base = await getSetting();
    await prisma.setting.create({ data: { id: 1, data: {
      ...base, model: "claude-opus-5", effort: "xhigh",
      telegram: { enabled: true, progress: true, engine: { enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "low" } },
    } as never } });
    expect(await deps().defaults()).toEqual({ agent: "claude", model: "claude-haiku-4-5", effort: "low" });
  });

  it("engine mati → deps.defaults() kembali mewarisi default global", async () => {
    const base = await getSetting();
    await prisma.setting.create({ data: { id: 1, data: {
      ...base, agent: "codex", codex: { model: "gpt-5.5", effort: "medium" },
    } as never } });
    expect(await deps().defaults()).toEqual({ agent: "codex", model: "gpt-5.5", effort: "medium" });
  });
});

describe("SPEC-492 · engine tersimpan lewat PUT /settings yang sudah ada", () => {
  const app = buildApp();          // `buildApp()` SINKRON (server/src/app.ts:65)
  let headers: { authorization: string };

  beforeEach(async () => {
    await prisma.$transaction([prisma.agentToken.deleteMany(), prisma.setting.deleteMany()]);
    await prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } } });
    const { token } = await issueAgentToken({ name: "spec-492", capabilities: ["settings:read", "settings:write"] });
    headers = { authorization: `Bearer ${token}` };
  });
  afterAll(async () => {
    await prisma.$transaction([prisma.agentToken.deleteMany(), prisma.setting.deleteMany()]);
    await app.close();
  });

  // AC-5 · tanpa endpoint baru. Gateway tak pernah dipasang di test ini, jadi
  // `reloadTelegramGateway()` no-op — yang diuji di sini adalah route MENYIMPAN engine tanpa 400.
  it("menyimpan telegram.engine lewat PUT /settings", async () => {
    const before = await getSetting();
    const res = await app.inject({
      method: "PUT", url: "/api/settings", headers,
      payload: { ...before, telegram: { ...before.telegram, engine: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "high" } } },
    });
    expect(res.statusCode).toBe(200);
    expect((await getSetting()).telegram.engine).toEqual({ enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "high" });
  });

  it("GET /settings mengirimkan blok engine", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings", headers });
    expect(res.json().telegram.engine).toEqual({ enabled: false, agent: "claude", model: "opus", effort: "xhigh" });
  });
});
