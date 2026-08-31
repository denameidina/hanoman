import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Mock ws agar connectWs tak membuka socket nyata (hindari reconnect timer bocor di test).
vi.mock("ws", () => {
  class FakeWS { readyState = 0; on() { /* noop */ } close() { /* noop */ } }
  return { WebSocket: FakeWS, default: { WebSocket: FakeWS } };
});

import { prisma } from "../src/db";
import * as cfg from "../src/config";
import { syncStatus, stopSyncClient } from "../src/services/sync-client";
import { applyConfigSideEffect } from "../src/services/config-apply";
import { _resetCodexVersionCache, getCodexVersion } from "../src/services/codex-version";
import {
  currentCustomAgentRuntimeSupport, refreshCustomAgentRuntimeSupport,
} from "../src/services/custom-agents";

const clean = async () => { await prisma.runtimeConfig.deleteMany(); };
beforeEach(async () => { await clean(); await cfg.loadConfig(); });
afterAll(async () => { await clean(); stopSyncClient(); });

describe("config side-effects (SPEC-215)", () => {
  it("set SYNC_SERVER_URL+token → sync client running; clear → stop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ records: [], cursor: "0" }), status: 200 }));
    await cfg.setConfig("SYNC_SERVER_URL", "http://127.0.0.1:9"); await applyConfigSideEffect("SYNC_SERVER_URL");
    await cfg.setConfig("SYNC_DEVICE_TOKEN", "tok"); await applyConfigSideEffect("SYNC_DEVICE_TOKEN");
    expect(syncStatus().running).toBe(true);
    await cfg.clearConfig("SYNC_SERVER_URL"); await applyConfigSideEffect("SYNC_SERVER_URL");
    expect(syncStatus().running).toBe(false);
    vi.unstubAllGlobals();
  });
  it("kredensial inheritEnv di-mirror ke process.env", async () => {
    await cfg.setConfig("ANTHROPIC_API_KEY", "sk-test"); await applyConfigSideEffect("ANTHROPIC_API_KEY");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-test");
    await cfg.clearConfig("ANTHROPIC_API_KEY"); await applyConfigSideEffect("ANTHROPIC_API_KEY");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
  it("perubahan biner Codex langsung menyegarkan probe native-agent", async () => {
    await cfg.setConfig("HANOMAN_CODEX_BIN", "/bin/echo");
    _resetCodexVersionCache();
    expect(await getCodexVersion()).toBeNull();

    await cfg.setConfig("HANOMAN_CODEX_BIN", process.execPath);
    await applyConfigSideEffect("HANOMAN_CODEX_BIN");
    expect(await getCodexVersion()).toBe(process.versions.node);
  });

  it("menyerialkan refresh agar probe lama tidak menimpa config terbaru", async () => {
    const calls: string[] = [];
    let releaseOld!: () => void;
    const older = refreshCustomAgentRuntimeSupport(() => new Promise((resolve) => {
      calls.push("old-start");
      releaseOld = () => { calls.push("old-end"); resolve("0.150.0"); };
    }));
    await vi.waitFor(() => expect(calls).toEqual(["old-start"]));
    const latest = refreshCustomAgentRuntimeSupport(async () => {
      calls.push("new");
      return "0.151.0";
    });
    expect(calls).toEqual(["old-start"]);
    releaseOld();
    await Promise.all([older, latest]);
    expect(calls).toEqual(["old-start", "old-end", "new"]);
    expect(currentCustomAgentRuntimeSupport()).toEqual({ version: "0.151.0", ok: true });
  });
});
