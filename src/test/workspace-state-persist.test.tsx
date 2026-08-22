import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, scoped, readUiState, writeUiState } from "../src/ui-state";
vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  // Bentuk `Setting` diambil dari katalog default bersama — mock yang mengarang bentuknya
  // sendiri gagal di kartu pertama yang membaca blok bersarang. Dirakit DI DALAM factory:
  // `vi.mock` diangkat ke atas berkas, jadi ia tak boleh menyentuh impor tingkat-modul.
  const s = await vi.importActual<any>("@hanoman/shared");
  const SETTING = {
    model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
    notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true,
    notifyDecisionSound: "alert", agentAccessEnabled: true, scheduler: s.SCHEDULER_DEFAULTS,
    goal: s.GOAL_DEFAULTS, agent: "claude", codex: s.CODEX_DEFAULTS, verifyScope: "changed",
    conflict: s.CONFLICT_DEFAULTS, lead: s.LEAD_DEFAULTS, telegram: s.TELEGRAM_DEFAULTS,
  };
  return {
    ...actual,
    api: {
      getSettings: vi.fn().mockResolvedValue(SETTING),
      getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0" }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
      getTelegramStatus: vi.fn().mockResolvedValue(null),
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listUsers: vi.fn().mockResolvedValue([]),
      listDeviceTokens: vi.fn().mockResolvedValue([]),
      listAgentTokens: vi.fn().mockResolvedValue([]),
      getCapabilities: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({ entries: [] }),
      getDocsTree: vi.fn().mockResolvedValue({ categories: [], coverage: 0 }),
      getDoc: vi.fn().mockResolvedValue({ content: "" }),
      docsIndexCheck: vi.fn().mockResolvedValue({ ok: true, missing: [], orphans: [] }),
    },
  };
});
vi.mock("../src/api/events", () => ({
  subscribe: () => () => {},
  // SPEC-897 · HanomanPet membaca status koneksi dari socket `events` yang sama.
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";

beforeEach(() => localStorage.clear());

describe("sub-tab Settings", () => {
  const me = { id: "u1", email: "a@b.c", role: "admin" } as any;

  it("bertahan lintas unmount/remount", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    fireEvent.click(await screen.findByText("Sesi"));
    await waitFor(() => expect(readUiState(uiKey("settings", "tab"), "akun")).toBe("sesi"));
    cleanup();
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await waitFor(() => expect(readUiState(uiKey("settings", "tab"), "akun")).toBe("sesi"));
  });

  it("nilai tab rusak di storage tak membuat layar gagal render", async () => {
    localStorage.setItem(uiKey("settings", "tab"), "{rusak");
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    expect(await screen.findByText("Sesi")).toBeTruthy();
  });
});

describe("kunci ber-scope project", () => {
  it("IDE & Docs memakai kunci berbeda per project", () => {
    writeUiState(uiKey(scoped("ide", "erp"), "tab"), "git");
    writeUiState(uiKey(scoped("docs", "erp"), "selected"), "architecture/stack.md");
    expect(readUiState(uiKey(scoped("ide", "crm"), "tab"), "explorer")).toBe("explorer");
    expect(readUiState(uiKey(scoped("docs", "crm"), "selected"), "")).toBe("");
    expect(readUiState(uiKey(scoped("ide", "erp"), "tab"), "explorer")).toBe("git");
  });
});
