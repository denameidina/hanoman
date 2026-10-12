// ADR-0205 · navigasi 8 hub diuji lewat App utuh (router + auth + shell): URL lama tetap hidup,
// klik tab menggerakkan URL, hub mengingat tab terakhir, dan Dalang tetap terbuka dari palet.
import { eventsStub } from "./helpers/events-stub";
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

// Papan Tim memuat datanya sendiri dari banyak endpoint; yang diuji di sini hanya URL dan tab-nya.
vi.mock("../src/screens/TeamScreen", () => ({ TeamScreen: () => null }));

vi.mock("../src/api/events", () => ({
  ...eventsStub,
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

import App from "../src/App";

const go = (path: string) => window.history.replaceState(null, "", path);
const sidebar = () => screen.getByRole("navigation", { name: "Navigasi utama" });

beforeEach(() => {
  localStorage.clear();
  resetPaletteUi();
  go("/overview");
});

describe("navigasi hub di App", () => {
  it("sidebar memuat delapan hub; tak ada lagi 17 entri datar", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeTruthy());
    expect(within(sidebar()).getAllByRole("button")).toHaveLength(8);
    for (const label of ["Overview", "Projects", "Backlog", "Triase", "Sesi", "Otonom", "Skills", "Pengaturan"])
      expect(within(sidebar()).getByRole("button", { name: label })).toBeInTheDocument();
    expect(within(sidebar()).queryByRole("button", { name: "Dalang Hanoman" })).toBeNull();
  });

  it("deep link lama tetap hidup: /prd membuka PRD dengan tab PRD terpilih, URL tak berubah", async () => {
    go("/prd");
    render(<App />);
    const tabs = await screen.findByRole("tablist", { name: "Projects" });
    expect(within(tabs).getByRole("tab", { name: "PRD" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.pathname).toBe("/prd");
  });

  it("klik tab menggerakkan URL ke section-nya (Backlog → Tugas manusia = /team)", async () => {
    go("/backlog");
    render(<App />);
    const tabs = await screen.findByRole("tablist", { name: "Backlog" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Tugas manusia" }));
    await waitFor(() => expect(window.location.pathname).toBe("/team"));
    // URL berubah lebih dulu daripada render ulang React: tunggu tab-nya ikut terpilih, bukan hanya URL-nya.
    await waitFor(() => expect(screen.getByRole("tab", { name: "Tugas manusia" })).toHaveAttribute("aria-selected", "true"));
  });

  it("klik hub kembali ke tab terakhir yang dibuka di hub itu", async () => {
    go("/prd");
    render(<App />);
    await screen.findByRole("tablist", { name: "Projects" });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Backlog" }));
    await waitFor(() => expect(window.location.pathname).toBe("/backlog"));
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Projects" }));
    await waitFor(() => expect(window.location.pathname).toBe("/prd"));
  });

  it("palet 'Buka panggung' membuka Dalang tanpa Shell, dan Dalang tetap bisa dicapai lewat URL", async () => {
    go("/overview");
    render(<App />);
    await waitFor(() => expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeTruthy());
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Palet perintah" });
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "panggung" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(window.location.pathname).toBe("/dalang"));
  });
});
