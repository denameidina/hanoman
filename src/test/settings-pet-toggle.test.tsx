// Tampilkan Hanoman (pet) di tab Sesi harian: preferensi PER BROWSER (ui-state/pet-pref.ts), bukan
// Setting server. Tiga pilihan: Default (null, default per tier), Tampilkan (true), Sembunyikan (false).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";
import { readPetEnabled, writePetEnabled } from "../src/ui-state/pet-pref";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const settings = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
};

beforeEach(() => {
  writePetEnabled(null);
  vi.mocked(api.getSettings).mockResolvedValue(settings as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings as any);
});

const openSesi = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Sesi harian" }));
};
const grupPet = async () => screen.findByRole("radiogroup", { name: "Tampilkan Hanoman (pet)" });

describe("SettingsScreen · Tampilkan Hanoman (pet) per browser", () => {
  it("belum pernah dipilih: opsi Default tercentang, dan hint menjelaskan default per tier", async () => {
    openSesi();
    const grup = await grupPet();
    expect(within(grup).getByRole("radio", { name: "Default" })).toBeChecked();
    expect(within(grup).getByRole("radio", { name: "Tampilkan" })).not.toBeChecked();
    expect(screen.getByText(/Default: aktif di desktop, mati di tablet & ponsel/)).toBeTruthy();
  });

  it("memilih Sembunyikan menulis false ke preferensi browser, dan tidak menyimpan apa pun ke server", async () => {
    openSesi();
    const grup = await grupPet();
    fireEvent.click(within(grup).getByRole("radio", { name: "Sembunyikan" }));
    expect(readPetEnabled()).toBe(false);
    expect(within(grup).getByRole("radio", { name: "Sembunyikan" })).toBeChecked();
    expect(api.putSettings).not.toHaveBeenCalled();
  });

  it("memilih Tampilkan menulis true; kembali ke Default menulis null (default per tier)", async () => {
    openSesi();
    const grup = await grupPet();
    fireEvent.click(within(grup).getByRole("radio", { name: "Tampilkan" }));
    expect(readPetEnabled()).toBe(true);
    fireEvent.click(within(grup).getByRole("radio", { name: "Default" }));
    expect(readPetEnabled()).toBeNull();
    expect(within(grup).getByRole("radio", { name: "Default" })).toBeChecked();
  });

  it("preferensi yang sudah tersimpan di browser terbaca saat tab Sesi harian dibuka", async () => {
    writePetEnabled(false);
    openSesi();
    const grup = await grupPet();
    expect(within(grup).getByRole("radio", { name: "Sembunyikan" })).toBeChecked();
  });
});
