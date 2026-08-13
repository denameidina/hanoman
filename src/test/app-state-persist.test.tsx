import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { uiKey, writeUiState, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      authStatus: vi.fn().mockResolvedValue({ needsSetup: false, user: { id: "u1", email: "a@b.c", role: "admin" } }),
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listSpecs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listTerminals: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({}),
      // SPEC-739 · mock `api` parsial WAJIB menyebut getMethodStatus.
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
      getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0" }),
      listNotifications: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getLimits: vi.fn().mockResolvedValue(null),
      getCodexLimits: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ current: "0.0.0", latest: null, canApply: false }),
    },
  };
});
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));

import App from "../src/App";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("state nav App", () => {
  it("memulihkan halaman terakhir yang dibuka", async () => {
    writeUiState(uiKey("app", "section"), "settings");
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Settings").length).toBeGreaterThan(0));
    expect(screen.queryByText("nafanesia.id · ringkasan workspace")).toBeNull();
  });

  it("nilai section tak dikenal jatuh ke overview", async () => {
    writeUiState(uiKey("app", "section"), "runs");
    render(<App />);
    await waitFor(() => expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeTruthy());
  });

  it("deep-link hash menang atas section tersimpan", async () => {
    writeUiState(uiKey("app", "section"), "settings");
    window.location.hash = "#spec=SPEC-1";
    render(<App />);
    await waitFor(() => expect(screen.getByText("specs · brainstorm → execute")).toBeTruthy());
  });

  it("membuang state dari versi kunci lama saat mount", async () => {
    localStorage.setItem("hn.ui.v0.backlog.q", JSON.stringify("lama"));
    render(<App />);
    await waitFor(() => expect(localStorage.getItem("hn.ui.v0.backlog.q")).toBeNull());
  });

  it("section yang sedang dibuka tersimpan", async () => {
    render(<App />);
    await waitFor(() => expect(readUiState(uiKey("app", "section"), "")).toBe("overview"));
  });
});
