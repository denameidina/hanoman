import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), startSession: vi.fn(), getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

const spec: any = { id: "SPEC-332", source: "brief", title: "t", stage: "planned" };
const settings = (goal: { enabled: boolean; condition: string }) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings({ enabled: true, condition: "TEMPLATE-GLOBAL" }) as any);
  vi.mocked(api.startSession).mockResolvedValue({ id: "spec-332" } as any);
});

describe("StartSessionModal · mode goal", () => {
  it("prefill dari Setting global dan mengirim goal + goalCondition", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByDisplayValue("TEMPLATE-GLOBAL")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-332", goal: true, goalCondition: "TEMPLATE-GLOBAL" })));
  });

  it("toggle mati → goal:false, kondisi tak dikirim, textarea disembunyikan", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByDisplayValue("TEMPLATE-GLOBAL")).toBeNull();
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ goal: false, goalCondition: undefined })));
  });

  it("kondisi kosong → hanya goal:true (server memakai template/default)", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({ enabled: true, condition: "" }) as any);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ goal: true, goalCondition: undefined })));
  });
});

// SPEC-407 · ADR-0089 · backlog goal SELALU bermode goal — switch-nya terkunci. Template global
// TIDAK boleh ikut terkirim sebagai override: server menurunkan kondisinya dari item, dan override
// yang tak diminta operator justru mengganti goal itu dengan kalimat generik.
describe("StartSessionModal · spec bersource goal (SPEC-407)", () => {
  const goalSpec: any = { id: "SPEC-407", source: "goal", title: "t", stage: "planned" };

  it("switch terkunci aktif dan kondisi global tak ikut terkirim", async () => {
    render(<StartSessionModal open spec={goalSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByDisplayValue("TEMPLATE-GLOBAL")).toBeNull();
    fireEvent.click(screen.getByRole("switch"));          // klik tak boleh mematikannya
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-407", flow: "goal", goal: true, goalCondition: undefined })));
  });

  it("kondisi yang diketik operator tetap menang", async () => {
    render(<StartSessionModal open spec={goalSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "KONDISI-SESI" } });
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ goalCondition: "KONDISI-SESI" })));
  });
});
