import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ORCHESTRATION_DEFAULTS, zOrchestration } from "@hanoman/shared";
import { StartSessionModal } from "../src/App";
import { PhasePlanPreview } from "../src/screens/PhasePlanPreview";
import { api } from "../src/api/client";

// ADR-0164 · pratinjau rencana fase di modal Start: resolver yang SAMA dengan server.
vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), startSession: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

const spec = { id: "SPEC-9", source: "qa", projectId: "p1" } as any;
const settingWith = (orchestration: unknown, extra: object = {}) => ({
  model: "opus", effort: "xhigh", goal: { enabled: false, condition: "" }, orchestration, ...extra,
});
const renderModal = () => render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);

beforeEach(() => {
  vi.clearAllMocks();
  (api.startSession as any).mockResolvedValue({ id: "spec-9" });
});

describe("StartSessionModal · pratinjau fase (ADR-0164)", () => {
  it("memakai sel Settings dan menandai fase yang mewarisi orchestrator", async () => {
    const orchestration = zOrchestration.parse({});
    orchestration.qa.claude.Plan = { model: "sonnet", effort: "low" };
    (api.getSettings as any).mockResolvedValue(settingWith(orchestration));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Plan · Sonnet · low"));
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Audit · Opus · xhigh (warisi)");
  });

  it("mengubah effort orchestrator ikut mengubah fase yang mewarisi", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(zOrchestration.parse({})));
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Effort")).toHaveValue("xhigh"));
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview"))
      .toHaveTextContent("Execute · Opus · xhigh (warisi)"));
    fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "high" } });
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Execute · Opus · high (warisi)");
  });

  it("flow yang orkestrasinya mati → sesi tunggal", async () => {
    const orchestration = zOrchestration.parse({});
    orchestration.qa.enabled = false;
    (api.getSettings as any).mockResolvedValue(settingWith(orchestration));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Orkestrasi mati untuk flow ini"));
  });

  it("codex di bawah 0.151 → sesi tunggal dengan alasannya", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(structuredClone(ORCHESTRATION_DEFAULTS),
      { agent: "codex", codex: { model: "gpt-5.6-sol", effort: "high" } }));
    (api.getCodexVersion as any).mockResolvedValueOnce({ version: "0.150.0", minRequired: "0.144.0", ok: true });
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("belum mendukung subagent native"));
  });

  // ADR-0164 · gerbang muat: absennya data BELUM dimuat ≠ "sesi tunggal" — pratinjau harus diam
  // dulu sampai respons Settings/versi codex tiba, sama seperti codexVer null ≠ "gagal deteksi".
  it("settings belum termuat → pratinjau menunggu, bukan menuduh sesi tunggal", async () => {
    (api.getSettings as any).mockReturnValueOnce(new Promise(() => {})); // tak pernah resolve
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Memuat rencana fase"));
    expect(screen.getByTestId("phase-plan-preview")).not.toHaveTextContent("dikerjakan subagent");
  });

  // S4a · GET Setting gagal: dulu dianggap termuat dengan orchestration undefined → resolver memakai
  // sel kosong + no_effort aktif, padahal server memakai matriks bawaan. Rencana palsu → galat.
  it("S4a · GET Setting gagal → galat di pratinjau, bukan rencana palsu", async () => {
    (api.getSettings as any).mockRejectedValueOnce(new Error("boom"));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Gagal memuat Setting"));
    expect(screen.getByTestId("phase-plan-preview")).not.toHaveTextContent("dikerjakan subagent");
  });

  it("S4a · blok orchestration absen di respons → matriks bawaan (sama dengan server)", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(undefined));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Spec · Opus · medium"));
    expect(screen.getByTestId("phase-plan-preview")).not.toHaveTextContent("Spec · Opus · medium (warisi)");
  });

  it("codex: versi belum termuat → pratinjau menunggu, lalu tampil setelah versi tiba", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(structuredClone(ORCHESTRATION_DEFAULTS),
      { agent: "codex", codex: { model: "gpt-5.6-sol", effort: "high" } }));
    let resolveVersion!: (v: unknown) => void;
    (api.getCodexVersion as any).mockReturnValueOnce(new Promise((resolve) => { resolveVersion = resolve; }));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Memuat rencana fase"));
    expect(screen.getByTestId("phase-plan-preview")).not.toHaveTextContent("belum mendukung");
    await act(async () => { resolveVersion({ version: "0.151.0", minRequired: "0.144.0", ok: true }); });
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Execute ·"));
  });

  it("codex: versi gagal dimuat → tetap dianggap tak terdeteksi (sama seperti server)", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(structuredClone(ORCHESTRATION_DEFAULTS),
      { agent: "codex", codex: { model: "gpt-5.6-sol", effort: "high" } }));
    (api.getCodexVersion as any).mockRejectedValueOnce(new Error("boom"));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("belum mendukung subagent native"));
  });

  it("sel sebagian (hanya model atau hanya effort) → tanda warisi per bagian", async () => {
    const orchestration = structuredClone(ORCHESTRATION_DEFAULTS);
    orchestration.qa.claude.Plan = { model: "sonnet", effort: null };
    orchestration.qa.claude.Execute = { model: null, effort: "low" };
    (api.getSettings as any).mockResolvedValue(settingWith(orchestration));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview"))
      .toHaveTextContent("Plan · Sonnet · xhigh (effort warisi)"));
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Execute · Opus · low (model warisi)");
  });

  it("mengirim override model dan effort subagent per fase saat mulai", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(structuredClone(ORCHESTRATION_DEFAULTS)));
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Model subagent Plan")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Model subagent Plan"), { target: { value: "haiku" } });
    fireEvent.change(screen.getByLabelText("Effort subagent Plan"), { target: { value: "low" } });
    fireEvent.click(screen.getByRole("button", { name: "Mulai" }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(expect.objectContaining({
      phaseOverrides: { Plan: { model: "haiku", effort: "low" } },
    })));
  });
});

// Audit R6 · override effort tanpa model lalu ganti model orchestrator → nilai tersimpan hilang dari
// opsi dan Select tampil "Warisi rekomendasi" padahal override masih terkirim; label "Warisi
// rekomendasi" menyembunyikan sumbernya (sel Settings atau orchestrator); sufiks "(override sesi)"
// menyembunyikan bagian yang masih mewarisi; `<select>` native, bukan `Select` DS.
describe("StartSessionModal · override fase (audit R6)", () => {
  const codexSetting = () => settingWith(zOrchestration.parse({}),
    { agent: "codex", codex: { model: "gpt-5.6-sol", effort: "high" } });

  it("effort override tetap terlihat (dan ditandai dikoersi) sesudah model orchestrator berganti", async () => {
    (api.getSettings as any).mockResolvedValue(codexSetting());
    (api.getCodexVersion as any).mockResolvedValueOnce({ version: "0.154.0", minRequired: "0.144.0", ok: true });
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Effort subagent Plan")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Effort subagent Plan"), { target: { value: "ultra" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.5" } });
    const effortSelect = screen.getByLabelText("Effort subagent Plan") as HTMLSelectElement;
    expect(effortSelect).toHaveValue("ultra");
    expect(effortSelect.selectedOptions[0]!.textContent).toMatch(/ultra.*dikoersi.*xhigh/);
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Plan · GPT-5.5 · xhigh");
  });

  it("opsi kosong menyebut sumber warisan: sel Settings atau orchestrator", async () => {
    const orchestration = zOrchestration.parse({});
    orchestration.qa.claude.Plan = { model: "sonnet", effort: "low" };
    (api.getSettings as any).mockResolvedValue(settingWith(orchestration));
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Model subagent Plan")).toBeInTheDocument());
    const first = (label: string) => (screen.getByLabelText(label) as HTMLSelectElement).options[0]!.textContent;
    expect(first("Model subagent Plan")).toBe("Warisi Settings · Sonnet");
    expect(first("Effort subagent Plan")).toBe("Warisi Settings · low");
    expect(first("Model subagent Audit")).toBe("Warisi orchestrator · Opus");
    expect(first("Effort subagent Audit")).toBe("Warisi orchestrator · xhigh");
    expect(screen.queryAllByText("Warisi rekomendasi")).toHaveLength(0);
  });

  it("sufiks per bagian: override model tak menyembunyikan effort yang masih mewarisi", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(zOrchestration.parse({})));
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Model subagent Plan")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Model subagent Plan"), { target: { value: "haiku" } });
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Plan · Haiku · xhigh (model override · effort warisi)");
    fireEvent.change(screen.getByLabelText("Effort subagent Plan"), { target: { value: "low" } });
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Plan · Haiku · low (override sesi)");
  });

  it("picker override memakai Select design system", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(zOrchestration.parse({})));
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Model subagent Plan")).toBeInTheDocument());
    expect(screen.getByLabelText("Model subagent Plan").closest(".hn-select")).not.toBeNull();
    expect(screen.getByLabelText("Effort subagent Plan").closest(".hn-select")).not.toBeNull();
  });

  it("model override tersimpan di luar katalog tetap jadi opsi terpilih", () => {
    render(<PhasePlanPreview flow="qa" agent="claude" model="opus" effort="xhigh"
      orchestration={zOrchestration.parse({})} codexVersion={null} loading={false}
      phaseOverrides={{ Plan: { model: "claude-retired-1" } }} onPhaseOverridesChange={() => {}} />);
    expect(screen.getByLabelText("Model subagent Plan")).toHaveValue("claude-retired-1");
  });
});
