import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// SPEC-488 · runtime/model/effort agen hanoman-lead. Blok `Setting.lead.engine` ada sejak ADR-0091
// tapi tak pernah punya satu pun kontrol — satu-satunya jalan menyetelnya adalah curl.
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

const LEAD = (over: object = {}) => ({
  enabled: false, paused: false, pausedProjects: [], everyMin: 5, timeoutSec: 600,
  maxAutoAnswers: 3, maxConcurrent: 2, queueWaitSec: 120, flowTtlMin: 60,
  requireGreenBeforeIntegrate: true,
  engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
  ...over,
});
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
  conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
  lead: LEAD(), ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.getCodexVersion).mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
  vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD() as any);
  vi.mocked(api.putLeadConfig).mockImplementation(async (c: any) => c);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SPEC-488 · kartu agen hanoman-lead", () => {
  it("kartu ada di tab Model sesi", async () => {
    openModel();
    expect(await screen.findByText("Agen hanoman-lead")).toBeInTheDocument();
  });

  // Opt-in: mati = warisan penuh, dan kartunya HARUS menyebut nilai warisannya — kalau tidak
  // operator ditinggal bertanya "lalu lead pakai apa?" (pelajaran SPEC-383).
  it("mati → tak ada picker, nilai warisan ditampilkan", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } }) as any);
    openModel();
    const inh = await screen.findByTestId("lead-engine-inherited");
    expect(inh).toHaveTextContent("Codex CLI");
    expect(inh).toHaveTextContent("gpt-5.6-terra");
    expect(inh).toHaveTextContent("high");
    expect(screen.queryByLabelText("Runtime lead")).toBeNull();
  });

  it("menyalakan override → PUT /lead/config dengan engine.enabled true", async () => {
    openModel();
    fireEvent.click(await screen.findByRole("switch", { name: "Override agen lead" }));
    await waitFor(() => expect(api.putLeadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ engine: expect.objectContaining({ enabled: true }) })));
  });

  // Inti keputusan D2: blok `lead` punya penulis KEDUA (LeadScreen). Snapshot Settings dimuat
  // sekali saat mount; menulis blok lead DARI snapshot itu akan mengembalikan rem darurat yang
  // ditekan di layar Lead sesudahnya. Nilai lead non-engine WAJIB datang dari GET yang segar.
  it("field lead lain datang dari GET segar, bukan snapshot Settings", async () => {
    vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD({ paused: true, everyMin: 42 }) as any);
    openModel();
    fireEvent.click(await screen.findByRole("switch", { name: "Override agen lead" }));
    await waitFor(() => expect(api.putLeadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ paused: true, everyMin: 42 })));
    expect(api.putSettings).not.toHaveBeenCalled();
  });

  it("menukar runtime ke codex → model & effort ikut bertukar ke katalog codex", async () => {
    const eng = { enabled: true, agent: "claude", model: "claude-opus-5", effort: "xhigh" };
    vi.mocked(api.getSettings).mockResolvedValue(settings({ lead: LEAD({ engine: eng }) }) as any);
    vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD({ engine: eng }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Runtime lead"), { target: { value: "codex" } });
    await waitFor(() => expect(api.putLeadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ engine: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" } })));
  });

  // SPEC-339 · effort adalah properti MODEL. Luna tak mendukung `ultra`; menyimpannya apa adanya
  // berarti lead lahir dengan pasangan yang ditolak codex.
  it("memilih model codex yang tak mendukung effort tersimpan → effort dikoersi", async () => {
    const eng = { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "ultra" };
    vi.mocked(api.getSettings).mockResolvedValue(settings({ lead: LEAD({ engine: eng }) }) as any);
    vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD({ engine: eng }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Model lead"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putLeadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ engine: expect.objectContaining({ model: "gpt-5.6-luna", effort: "xhigh" }) })));
  });

  it("picker effort codex hanya menawarkan effort yang didukung model terpilih", async () => {
    const eng = { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" };
    vi.mocked(api.getSettings).mockResolvedValue(settings({ lead: LEAD({ engine: eng }) }) as any);
    openModel();
    const sel = await screen.findByLabelText("Effort lead");
    const values = Array.from(sel.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).not.toContain("ultra");
    expect(values).toContain("max");
  });
});
