import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { StartSessionModal } from "../src/App";
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
  model: "claude-opus-5", effort: "xhigh", goal: { enabled: false, condition: "" }, orchestration, ...extra,
});
const renderModal = () => render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);

beforeEach(() => {
  vi.clearAllMocks();
  (api.startSession as any).mockResolvedValue({ id: "spec-9" });
});

describe("StartSessionModal · pratinjau fase (ADR-0164)", () => {
  it("memakai sel Settings dan menandai fase yang mewarisi orchestrator", async () => {
    const orchestration = structuredClone(ORCHESTRATION_DEFAULTS);
    orchestration.qa.claude.Plan = { model: "claude-sonnet-5", effort: "low" };
    (api.getSettings as any).mockResolvedValue(settingWith(orchestration));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Plan · Sonnet 5 · low"));
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Audit · Opus 5 · xhigh (warisi)");
  });

  it("mengubah effort orchestrator ikut mengubah fase yang mewarisi", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(structuredClone(ORCHESTRATION_DEFAULTS)));
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Effort")).toHaveValue("xhigh"));
    fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "high" } });
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Execute · Opus 5 · high (warisi)");
  });

  it("flow yang orkestrasinya mati → sesi tunggal", async () => {
    const orchestration = structuredClone(ORCHESTRATION_DEFAULTS);
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
});
