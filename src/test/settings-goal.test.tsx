import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const settings = (goal: { enabled: boolean; condition: string }) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings({ enabled: false, condition: "" }) as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings({ enabled: true, condition: "" }) as any);
});

const openSesi = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Sesi" }));
};

describe("SettingsScreen · kartu mode goal", () => {
  it("menyalakan default global mode goal → PUT settings", async () => {
    openSesi();
    // Switch DS menaruh aria-label PADA elemen ber-role (sejak 9f344904) — dicari lewat peran +
    // nama aksesibelnya, bukan lewat bentuk DOM-nya.
    fireEvent.click(await screen.findByRole("switch", { name: "Mode goal default" }));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ goal: { enabled: true, condition: "" } })));
  });

  it("mengetik template global → PUT settings dengan kondisinya", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({ enabled: true, condition: "" }) as any);
    openSesi();
    const ta = await screen.findByLabelText("Kondisi mode goal");
    fireEvent.change(ta, { target: { value: "KONDISI-TEMPLATE" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ goal: { enabled: true, condition: "KONDISI-TEMPLATE" } })));
  });
});
