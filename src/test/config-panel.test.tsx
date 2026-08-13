import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), getConfig: vi.fn(), putConfig: vi.fn(), deleteConfig: vi.fn(), getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

const cfgResponse = {
  sync: { running: false, connected: false },
  entries: [
    { key: "SYNC_SERVER_URL", group: "sync", label: "URL hub", kind: "url", apply: "live", category: "knob", editable: true, source: "default", value: null },
    { key: "SYNC_DEVICE_TOKEN", group: "sync", label: "Device token", kind: "secret", apply: "live", category: "credential", editable: true, source: "default", masked: null, hasValue: false },
    { key: "DATABASE_URL", group: "bootstrap", label: "DATABASE_URL", kind: "secret", apply: "restart", category: "bootstrap", editable: false, source: "env", masked: "••••_dev", hasValue: true },
  ],
};

const me = { id: "u1", email: "a@b.c" } as any;

beforeEach(() => {
  (api.getConfig as any).mockResolvedValue(cfgResponse);
  (api.getSettings as any).mockResolvedValue({});
  (api.putConfig as any).mockResolvedValue({ key: "SYNC_SERVER_URL", value: "https://h.co", source: "db" });
});

describe("ConfigPanel (tab Konfigurasi)", () => {
  it("render entri per grup; bootstrap read-only; secret termask", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    fireEvent.click(screen.getByText("Konfigurasi"));
    await waitFor(() => expect(screen.getByText("URL hub")).toBeInTheDocument());
    expect(screen.getByText("Device token")).toBeInTheDocument();
    expect(screen.getByText("••••_dev")).toBeInTheDocument(); // bootstrap read-only masked
  });
  it("simpan knob memanggil putConfig", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Konfigurasi"));
    await waitFor(() => screen.getByText("URL hub"));
    const input = screen.getByLabelText("URL hub") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://h.co" } });
    fireEvent.click(screen.getAllByText("Simpan")[0]!);
    await waitFor(() => expect(api.putConfig).toHaveBeenCalledWith("SYNC_SERVER_URL", "https://h.co"));
  });
});
