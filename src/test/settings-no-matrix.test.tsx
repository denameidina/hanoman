import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

// SPEC-252 · ADR-0061 — matrix model/effort per fase (SPEC-238) DICABUT. Tab "Model sesi" hanya
// menyisakan default global; model/effort dipilih per sesi saat Start (StartSessionModal).
vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), putSettings: vi.fn(), getConfig: vi.fn(), putConfig: vi.fn(), deleteConfig: vi.fn(), getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

const SETTING = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  goal: { enabled: false, condition: "" },   // SPEC-332 · ADR-0073 · selalu ada di response (zod default)
};
const me = { id: "u1", email: "a@b.c" } as any;

beforeEach(() => {
  (api.getSettings as any).mockResolvedValue({ ...SETTING });
  (api.putSettings as any).mockResolvedValue({ ...SETTING });
});

describe("Settings tanpa matrix per-fase (SPEC-252)", () => {
  it("tab Model menampilkan default global TANPA matrix per-fase", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Model sesi"));
    // kartu default global tetap ada. SPEC-383 · judulnya di-assert PERSIS: frasa "default global"
    // kini juga muncul di kartu Konflik rebase & merge (baris warisan), jadi regex longgar cocok dua kali.
    expect(await screen.findByText("Model sesi — default global")).toBeInTheDocument();
    // matrix per-fase tidak ada lagi
    expect(screen.queryByText(/Model & effort per fase/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Laporan")).not.toBeInTheDocument();
  });

  it("mengubah model global mem-PUT { model } (bukan phaseModels)", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Model sesi"));
    await screen.findByText("Model sesi — default global");
    // SPEC-338 · tab ini kini juga memuat kartu "Agen sesi" di atasnya, jadi select model claude
    // dipilih lewat label — bukan urutan (`selects[0]` sekarang picker agen).
    fireEvent.change(screen.getByLabelText("Model claude"), { target: { value: "claude-sonnet-5" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    const putArg = (api.putSettings as any).mock.calls.at(-1)[0];
    expect(putArg.model).toBe("claude-sonnet-5");
    expect("phaseModels" in putArg).toBe(false);
  });
});
