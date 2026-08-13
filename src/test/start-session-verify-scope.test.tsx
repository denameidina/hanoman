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

const spec: any = { id: "SPEC-376", source: "brief", title: "t", stage: "planned" };
const settings = (verifyScope: string) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" }, verifyScope,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings("changed") as any);
  vi.mocked(api.startSession).mockResolvedValue({ id: "spec-376" } as any);
});

describe("StartSessionModal · scope verifikasi", () => {
  it("prefill dari Setting global dan mengirim verifyScope", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Scope verifikasi")).toHaveValue("changed"));
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-376", verifyScope: "changed" })));
  });

  it("memilih full mengirim verifyScope full", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Scope verifikasi")).toHaveValue("changed"));
    fireEvent.change(screen.getByLabelText("Scope verifikasi"), { target: { value: "full" } });
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ verifyScope: "full" })));
  });

  // Respons yang di-cache dari server sebelum SPEC-376 tak punya kunci ini; picker tak boleh kosong.
  it("setelan tanpa verifyScope jatuh ke changed", async () => {
    const s: any = settings("changed"); delete s.verifyScope;
    vi.mocked(api.getSettings).mockResolvedValue(s);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Scope verifikasi")).toHaveValue("changed"));
  });
});
