// Audit UI/UX 2026-10 · Fase 2C · palet perintah, shortcut global, dan Dalang kembali ke layar asal,
// diuji lewat App utuh (router + auth + shell), bukan komponen terisolasi.
import { eventsStub } from "./helpers/events-stub";
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { resetPaletteUi } from "../src/palette/ui-store";

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
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });

beforeEach(() => {
  localStorage.clear();
  resetPaletteUi();
  go("/overview");
});

describe("palet perintah dan shortcut di App", () => {
  it("⌘K membuka palet; memilih 'Backlog' membawa ke /backlog dan menutup palet", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeTruthy());
    press("k", { metaKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Palet perintah" });
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "backlog" } });
    // Opsi pertama adalah "Buat backlog baru" (grup Aksi); panah turun ke "Backlog" (grup Pindah ke).
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(window.location.pathname).toBe("/backlog"));
    expect(screen.queryByRole("dialog", { name: "Palet perintah" })).toBeNull();
  });

  it("chord g lalu p pindah ke Projects; ? membuka bantuan shortcut", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeTruthy());
    press("g");
    press("p");
    await waitFor(() => expect(window.location.pathname).toBe("/projects"));
    press("?");
    expect(await screen.findByRole("dialog", { name: "Shortcut keyboard" })).toBeInTheDocument();
  });

  it("Dalang keluar kembali ke layar yang tadi dibuka, bukan selalu ke Overview", async () => {
    go("/projects");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/projects"));
    press("g");
    press("d");
    const back = await screen.findByRole("button", { name: "Kembali ke Projects" });
    fireEvent.click(back);
    await waitFor(() => expect(window.location.pathname).toBe("/projects"));
  });
});
