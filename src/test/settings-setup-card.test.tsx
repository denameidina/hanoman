import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn().mockResolvedValue({}),
    getConfig: vi.fn().mockResolvedValue({ sync: { running: false, connected: false }, entries: [] }),
    putConfig: vi.fn(), deleteConfig: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
    setupStatus: vi.fn().mockResolvedValue({
      needed: false, deployment: "local", hardening: false, hardeningLocked: false,
      supervised: true, setupTokenRequired: false, prerequisites: [],
    }),
    applySetup: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

// Tanda tangan nyata: SettingsScreen({ onToast?, me, onLoggedOut }) — SettingsScreen.tsx:542
const props = { me: { id: "u1", email: "a@b.c", role: "admin", createdAt: "" } as never, onLoggedOut: () => {} };
const openTab = () => fireEvent.click(screen.getByRole("button", { name: /Setup awal/ }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();   // SPEC-740 · sub-tab aktif bertahan; mulai dari keadaan bersih
});

describe("kartu Setup awal (SPEC-884)", () => {
  it("menampilkan peruntukan dan status hardening", async () => {
    render(<SettingsScreen {...props} />);
    openTab();
    await waitFor(() => expect(screen.getByTestId("setup-card")).toBeTruthy());
    expect(screen.getByText(/Device saya sendiri/)).toBeTruthy();
    expect(screen.getByText(/Hardening mati/)).toBeTruthy();
    expect(api.setupStatus).toHaveBeenCalled();
  });

  it("tombol membuka ulang wizard", async () => {
    render(<SettingsScreen {...props} />);
    openTab();
    await waitFor(() => expect(screen.getByTestId("setup-card")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Jalankan ulang setup/ }));
    expect(screen.getByLabelText("Device saya sendiri")).toBeTruthy();
  });
});
