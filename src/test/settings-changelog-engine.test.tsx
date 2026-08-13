import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// SPEC-518 · runtime/model/effort agen pembuat changelog (SPEC-516/ADR-0105). Sampai spec ini
// `generateChangelog` selalu memakai default sesi kerja dan operator tak punya satu pun kontrol.
vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),

    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn(),
    getLeadConfig: vi.fn(), putLeadConfig: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };

const CHANGELOG = (over: object = {}) =>
  ({ enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh", ...over });

const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
  conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
  changelog: CHANGELOG(), ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockImplementation(async (s: any) => s);
  vi.mocked(api.getCodexVersion).mockResolvedValue(
    { version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SPEC-518 · kartu agen changelog", () => {
  it("kartu ada di tab Model sesi", async () => {
    openModel();
    expect(await screen.findByText("Agen changelog")).toBeInTheDocument();
  });

  // Opt-in: mati = warisan penuh, dan kartunya HARUS menyebut nilai warisannya — kalau tidak
  // operator ditinggal bertanya "lalu changelog pakai apa?" (pelajaran SPEC-383).
  it("mati → tak ada picker, nilai warisan ditampilkan", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } }) as any);
    openModel();
    const inh = await screen.findByTestId("changelog-engine-inherited");
    expect(inh).toHaveTextContent("Codex CLI");
    expect(inh).toHaveTextContent("gpt-5.6-terra");
    expect(inh).toHaveTextContent("high");
    expect(screen.queryByLabelText("Runtime changelog")).toBeNull();
  });

  // Blok `Setting.changelog` TAK punya penulis kedua (tak seperti `lead` yang ditulis LeadScreen
  // dan `telegram` yang ditulis command chat), jadi pola `save()` → PUT /settings sah di sini —
  // sama seperti kartu konflik.
  it("menyalakan override → PUT /settings dengan changelog.enabled true", async () => {
    openModel();
    const wrap = await screen.findByLabelText("Override agen changelog");
    fireEvent.click(within(wrap).getByRole("switch"));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ changelog: expect.objectContaining({ enabled: true }) })));
  });

  it("menukar runtime ke codex → model & effort ikut bertukar ke katalog codex", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ changelog: CHANGELOG({ enabled: true }) }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Runtime changelog"), { target: { value: "codex" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        changelog: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
      })));
  });

  // SPEC-339 · effort adalah properti MODEL. Luna tak mendukung `ultra`.
  it("memilih model codex yang tak mendukung effort tersimpan → effort dikoersi", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({
      changelog: CHANGELOG({ enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "ultra" }),
    }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Model changelog"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        changelog: expect.objectContaining({ model: "gpt-5.6-luna", effort: "xhigh" }),
      })));
  });

  it("picker effort codex hanya menawarkan effort yang didukung model terpilih", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({
      changelog: CHANGELOG({ enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" }),
    }) as any);
    openModel();
    const sel = await screen.findByLabelText("Effort changelog");
    const values = Array.from(sel.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).not.toContain("ultra");
    expect(values).toContain("max");
  });
});
