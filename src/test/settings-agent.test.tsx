import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
  vi.mocked(api.getCodexVersion).mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SettingsScreen · kartu agen sesi (SPEC-338)", () => {
  it("mengubah agen default → PUT settings", async () => {
    openModel();
    const sel = await screen.findByLabelText("Agen default");
    fireEvent.change(sel, { target: { value: "codex" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "codex" })));
  });

  it("mengubah model codex → PUT settings menjaga effort codex", async () => {
    openModel();
    const sel = await screen.findByLabelText("Model codex");
    fireEvent.change(sel, { target: { value: "gpt-5.6-terra" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codex: { model: "gpt-5.6-terra", effort: "xhigh" } })));
  });

  it("mengubah effort codex → PUT settings menjaga model codex", async () => {
    openModel();
    const sel = await screen.findByLabelText("Effort codex");
    fireEvent.change(sel, { target: { value: "low" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codex: { model: "gpt-5.6-sol", effort: "low" } })));
  });

  it("kartu model claude tetap ada berdampingan", async () => {
    openModel();
    expect(await screen.findByLabelText("Agen default")).toBeInTheDocument();
    expect(screen.getByText("Model sesi — default global")).toBeInTheDocument();
  });

  // SPEC-339 · effort per model: memilih Luna saat effort `ultra` harus menyimpan pasangan yang
  // sah, bukan pasangan yang nanti ditolak codex saat sesi lahir.
  it("memilih Luna saat effort ultra ikut menurunkan effort di PUT", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ codex: { model: "gpt-5.6-sol", effort: "ultra" } }) as any);
    openModel();
    const sel = await screen.findByLabelText("Model codex");
    fireEvent.change(sel, { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codex: { model: "gpt-5.6-luna", effort: "xhigh" } })));
  });

  it("daftar effort codex mengikuti model terpilih", async () => {
    openModel();
    await screen.findByLabelText("Effort codex");
    const opts = [...screen.getByLabelText("Effort codex").querySelectorAll("option")].map((o) => o.value);
    expect(opts).toEqual(["ultra", "max", "xhigh", "high", "medium", "low"]);
  });

  // SPEC-339 · nilai di luar katalog tetap harus TERLIHAT, bukan membuat Select kosong.
  it("model codex di luar katalog tetap tampil sebagai opsi", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ codex: { model: "gpt-7-belum-ada", effort: "ultra" } }) as any);
    openModel();
    const sel = await screen.findByLabelText("Model codex");
    expect(sel).toHaveValue("gpt-7-belum-ada");
    const opts = [...sel.querySelectorAll("option")].map((o) => o.value);
    expect(opts).toContain("gpt-7-belum-ada");
  });
});
