import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MODELS, EFFORTS, bundledModelCatalog } from "@hanoman/shared";
import { installModelCatalog } from "../src/api/model-catalog-state";

afterEach(() => { act(() => installModelCatalog(bundledModelCatalog())); });

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
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
  conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" }, ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.getCodexVersion).mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

// SPEC-383 · Temuan A · blok claude tak pernah menyebut "claude" di teks yang TERLIHAT (hanya
// aria-label), dan judul "default global" tetap terpampang di atas blok yang sedang tak dipakai.
describe("SPEC-383 · tab Model sesi bersumbu agen", () => {
  it("menerima model baru saat Settings terbuka tanpa menulis default sampai operator memilihnya", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({ effort: "ultracode" }) as any);
    vi.mocked(api.putSettings).mockClear();
    openModel();
    const select = await screen.findByLabelText("Model claude");
    const next = bundledModelCatalog();
    next.claude = [...next.claude, { id: "claude-future", label: "Future", efforts: ["high", "low"] }];
    act(() => installModelCatalog(next));
    expect(select.querySelector('option[value="claude-future"]')).toBeTruthy();
    expect(select).toHaveValue("claude-opus-5");
    expect(api.putSettings).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "claude-future" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-future", effort: "high" })));
  });
  // Nama agen di dalam `<option>` picker "Agen default" TIDAK dihitung — itu sudah ada sebelum
  // SPEC-383 dan bukan yang menamai bloknya. Yang dituntut: grup ber-judul, memuat picker-nya.
  it("setiap blok model punya judul agen yang terlihat mata", async () => {
    openModel();
    const claude = await screen.findByTestId("agent-group-claude");
    expect(claude).toHaveTextContent("Claude Code");
    expect(claude).toContainElement(screen.getByLabelText("Model claude"));
    const codex = screen.getByTestId("agent-group-codex");
    expect(codex).toHaveTextContent("Codex CLI");
    expect(codex).toContainElement(screen.getByLabelText("Model codex"));
  });

  it("agent claude → grup claude ditandai dipakai, grup codex tidak", async () => {
    openModel();
    expect(await screen.findByTestId("agent-badge-claude")).toHaveTextContent("dipakai sesi baru");
    expect(screen.getByTestId("agent-badge-codex")).toHaveTextContent("tidak dipakai sekarang");
  });

  it("agent codex → penandanya bertukar", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({ agent: "codex" }) as any);
    openModel();
    expect(await screen.findByTestId("agent-badge-codex")).toHaveTextContent("dipakai sesi baru");
    expect(screen.getByTestId("agent-badge-claude")).toHaveTextContent("tidak dipakai sekarang");
  });

  // Katalog claude dulu diduplikasi (S_MODELS/S_EFFORT) — picker Start dan Settings bisa berbeda.
  it("katalog model & effort claude berasal dari @hanoman/shared, bukan salinan lokal", async () => {
    openModel();
    const m = await screen.findByLabelText("Model claude");
    expect([...m.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value))
      .toEqual(MODELS.map((x) => x.id));
    const e = screen.getByLabelText("Effort claude");
    expect([...e.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value))
      .toEqual([...EFFORTS]);
  });
});
