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

const spec: any = { id: "SPEC-394", source: "qa", title: "t", stage: "planned" };
const settings = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
};

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings as any);
});

// SPEC-394 · ADR-0084 · keluhan aslinya soal PERSEPSI ("malah membuat session baru"), jadi umpan
// balik yang sampai ke operator harus membedakan sesi yang dilanjutkan dari sesi yang baru lahir.
describe("StartSessionModal · sesi dilanjutkan (SPEC-394)", () => {
  it("meneruskan resumed dari respons ke onStarted", async () => {
    vi.mocked(api.startSession).mockResolvedValue({ id: "spec-394", resumed: true } as any);
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("spec-394", true));
  });

  it("peluncuran biasa tak mengklaim dilanjutkan", async () => {
    vi.mocked(api.startSession).mockResolvedValue({ id: "spec-394" } as any);
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("spec-394", undefined));
  });
});
