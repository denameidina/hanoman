import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings() as any);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SPEC-339 · catatan versi codex", () => {
  it("CLI terlalu tua untuk model 5.6 → catatan muncul dengan perintah upgrade", async () => {
    vi.mocked(api.getCodexVersion).mockResolvedValue(
      { version: "0.142.5", minRequired: "0.144.0", ok: false } as any);
    openModel();
    const note = await screen.findByTestId("codex-version-note");
    expect(note).toHaveTextContent("0.142.5");
    expect(note).toHaveTextContent("0.144.0");
  });

  it("CLI cukup baru → tak ada catatan", async () => {
    vi.mocked(api.getCodexVersion).mockResolvedValue(
      { version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
    openModel();
    await screen.findByLabelText("Model codex");
    expect(screen.queryByTestId("codex-version-note")).toBeNull();
  });

  // Ketiadaan bukti bukan bukti ketiadaan: versi tak terdeteksi TIDAK boleh memicu peringatan.
  it("versi tak terdeteksi → tak ada catatan", async () => {
    vi.mocked(api.getCodexVersion).mockResolvedValue(
      { version: null, minRequired: "0.144.0", ok: true } as any);
    openModel();
    await screen.findByLabelText("Model codex");
    expect(screen.queryByTestId("codex-version-note")).toBeNull();
  });

  // Model yang tak butuh 0.144.0 tak boleh ikut diperingatkan.
  it("model gpt-5.5 pada CLI 0.142.5 → tak ada catatan", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ codex: { model: "gpt-5.5", effort: "xhigh" } }) as any);
    vi.mocked(api.getCodexVersion).mockResolvedValue(
      { version: "0.142.5", minRequired: "0.144.0", ok: false } as any);
    openModel();
    await screen.findByLabelText("Model codex");
    expect(screen.queryByTestId("codex-version-note")).toBeNull();
  });
});
