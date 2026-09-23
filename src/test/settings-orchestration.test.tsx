import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ORCHESTRATION_DEFAULTS, ORCHESTRATION_FLOWS } from "@hanoman/shared";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

// ADR-0164 · tab Orkestrasi: saklar per flow + matriks model/effort per fase per runtime.
vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), putSettings: vi.fn(), getConfig: vi.fn(), putConfig: vi.fn(), deleteConfig: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

const SETTING = {
  model: "opus", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  goal: { enabled: false, condition: "" }, orchestration: ORCHESTRATION_DEFAULTS,
};
const me = { id: "u1", email: "a@b.c" } as any;
const lastPut = () => (api.putSettings as any).mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  (api.getSettings as any).mockResolvedValue(structuredClone(SETTING));
  (api.putSettings as any).mockResolvedValue({});
});

const open = async () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
  fireEvent.click(screen.getByText("Orkestrasi"));
  return screen.findByTestId("orch-flow-feature");
};

describe("Settings · Orkestrasi (ADR-0164)", () => {
  it("satu kartu per flow memuat fase flow itu", async () => {
    const feature = await open();
    for (const phase of ["Brainstorm", "Objective", "Spec", "Plan", "Execute"])
      expect(within(feature).getByText(phase)).toBeInTheDocument();
    expect(screen.getByTestId("orch-flow-no_effort")).toBeInTheDocument();
  });

  it("memilih model sel menyimpan sel itu; effort tetap warisi", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Model feature Plan claude"), { target: { value: "sonnet" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(lastPut().orchestration.feature.claude.Plan).toEqual({ model: "sonnet", effort: "high" });
  });

  it("memilih effort sel menyimpan effort itu", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Effort feature Execute claude"), { target: { value: "low" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(lastPut().orchestration.feature.claude.Execute).toEqual({ model: "sonnet", effort: "low" });
  });

  it("mematikan saklar flow menyimpan enabled:false", async () => {
    await open();
    fireEvent.click(screen.getByRole("switch", { name: "Orkestrasi qa" }));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(lastPut().orchestration.qa.enabled).toBe(false);
  });

  it("setiap saklar flow punya nama aksesibel", async () => {
    await open();
    for (const flow of ORCHESTRATION_FLOWS)
      expect(screen.getByRole("switch", { name: `Orkestrasi ${flow}` })).toBeInTheDocument();
  });

  it("ganti model codex mengoreksi effort yang tak didukung model baru", async () => {
    const orchestration = structuredClone(ORCHESTRATION_DEFAULTS);
    orchestration.qa.codex.Execute = { model: "gpt-5.6-sol", effort: "ultra" };
    (api.getSettings as any).mockResolvedValue({ ...structuredClone(SETTING), orchestration });
    await open();
    fireEvent.change(screen.getByLabelText("Model qa Execute codex"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(lastPut().orchestration.qa.codex.Execute).toEqual({ model: "gpt-5.6-luna", effort: "xhigh" });
  });
});
