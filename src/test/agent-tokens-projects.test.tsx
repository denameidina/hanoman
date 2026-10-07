import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AgentAccessPanel } from "../src/screens/SettingsScreen";

vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn(),
    getSettings: vi.fn(), putSettings: vi.fn(),
    getAgentCapabilities: vi.fn(), listAgentTokens: vi.fn(),
    createAgentToken: vi.fn(), patchAgentToken: vi.fn(), revokeAgentToken: vi.fn(),
  },
}));
import { api } from "../src/api/client";

const SETTING = { model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true };
const CAPS = [
  { id: "memory:read", domain: "memory", access: "read", label: "Memori — baca", desc: "" },
  { id: "memory:write", domain: "memory", access: "write", label: "Memori — tulis", desc: "" },
];
const token = (o: Record<string, unknown> = {}) => ({ id: "t1", name: "ci", tokenPrefix: "hnm_agt_ab", capabilities: ["memory:write"],
  projectIds: null, enabled: true, createdBy: null, createdAt: "2026-07-21T00:00:00Z", lastUsedAt: null, revokedAt: null, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  (api.getSettings as any).mockResolvedValue({ ...SETTING });
  (api.getAgentCapabilities as any).mockResolvedValue({ capabilities: CAPS });
  (api.listProjects as any).mockResolvedValue({ items: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }], total: 2, page: 1, pageSize: 200 });
  (api.listAgentTokens as any).mockResolvedValue({ items: [] });
  (api.createAgentToken as any).mockResolvedValue({ ...token(), token: "hnm_agt_secret" });
  (api.patchAgentToken as any).mockResolvedValue(token());
});

describe("ADR-0181 · allowlist project agent token", () => {
  it("membuat token dengan project terpilih mengirim projectIds", async () => {
    render(<AgentAccessPanel />);
    fireEvent.change(await screen.findByPlaceholderText("mis. agent-ci"), { target: { value: "ci" } });
    fireEvent.click(await screen.findByRole("button", { name: "Project yang diizinkan (memori)" }));
    fireEvent.click(await screen.findByRole("option", { name: /Alpha/ }));
    fireEvent.click(screen.getByRole("button", { name: "Buat token" }));
    await waitFor(() => expect(api.createAgentToken).toHaveBeenCalledWith({ name: "ci", capabilities: [], projectIds: ["alpha"] }));
  });

  it("tanpa pilihan project, projectIds tak dikirim", async () => {
    render(<AgentAccessPanel />);
    fireEvent.change(await screen.findByPlaceholderText("mis. agent-ci"), { target: { value: "ci" } });
    fireEvent.click(screen.getByRole("button", { name: "Buat token" }));
    await waitFor(() => expect(api.createAgentToken).toHaveBeenCalledWith({ name: "ci", capabilities: [] }));
  });

  it("baris token menampilkan allowlist dan editor memanggil PATCH; kosong → null", async () => {
    (api.listAgentTokens as any).mockResolvedValue({ items: [token({ projectIds: ["alpha"] })] });
    render(<AgentAccessPanel />);
    expect(await screen.findByText(/memori: Alpha/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Atur project" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Project yang diizinkan untuk ci" }));
    fireEvent.click(await within(dlg).findByRole("option", { name: /Beta/ }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(api.patchAgentToken).toHaveBeenCalledWith("t1", { projectIds: ["alpha", "beta"] }));
  });

  it("token tanpa allowlist diberi tahu bahwa memori tertutup", async () => {
    (api.listAgentTokens as any).mockResolvedValue({ items: [token()] });
    render(<AgentAccessPanel />);
    expect(await screen.findByText(/memori: tertutup/)).toBeInTheDocument();
  });
});
