// ADR-0160 · navigasi dashboard = URL. Kontrak yang dijaga: path menentukan layar, klik sidebar
// menulis path, `/` mendarat di halaman tersimpan (ADR-0115 tetap), dan hash lama ADR-0071
// dialihkan ke path — bukan cuma dibaca.
import { eventsStub } from "./helpers/events-stub";
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { uiKey, writeUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      authStatus: vi.fn().mockResolvedValue({ needsSetup: false, user: { id: "u1", email: "a@b.c", role: "admin" } }),
      setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
        hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listSpecs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listTerminals: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({}),
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
      getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0" }),
      listNotifications: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getLimits: vi.fn().mockResolvedValue(null),
      getCodexLimits: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ current: "0.0.0", latest: null, canApply: false }),
    },
  };
});

vi.mock("../src/api/events", () => ({
  ...eventsStub,
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

import App from "../src/App";

const go = (path: string) => window.history.replaceState(null, "", path);

beforeEach(() => { localStorage.clear(); go("/"); });

describe("router App (ADR-0160)", () => {
  it("path menentukan layar: /backlog membuka Backlog walau halaman tersimpan = settings", async () => {
    writeUiState(uiKey("app", "section"), "settings");
    go("/backlog");
    render(<App />);
    await waitFor(() => expect(screen.getByText("specs · brainstorm → execute")).toBeTruthy());
    expect(window.location.pathname).toBe("/backlog");
  });

  it("klik sidebar menulis path, tanpa reload", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeTruthy());
    fireEvent.click(screen.getAllByText("Backlog")[0]!);
    await waitFor(() => expect(window.location.pathname).toBe("/backlog"));
    await waitFor(() => expect(screen.getByText("specs · brainstorm → execute")).toBeTruthy());
  });

  it("/ dialihkan (replace) ke halaman tersimpan, sehingga URL-nya ikut bisa dibagikan", async () => {
    writeUiState(uiKey("app", "section"), "settings");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/settings"));
  });

  it("path tak dikenal (key mati SPEC-162) mendarat di halaman tersimpan, bukan layar kosong", async () => {
    go("/runs");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/overview"));
    await waitFor(() => expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeTruthy());
  });

  it("hash lama #spec=<id> dialihkan ke /backlog/<id>", async () => {
    go("/#spec=SPEC-1");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/backlog/SPEC-1"));
    expect(window.location.hash).toBe("");
  });

  it("hash lama #changelog=<p>&cl=<id> dialihkan ke /changelog/<p>/<id>", async () => {
    go("/#changelog=arta&cl=c1");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/changelog/arta/c1"));
  });
});
