import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentAccessPanel } from "../src/screens/SettingsScreen";

vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(),
    putSettings: vi.fn(),
    getAgentCapabilities: vi.fn(),
    listAgentTokens: vi.fn(),
    createAgentToken: vi.fn(),
    patchAgentToken: vi.fn(),
    revokeAgentToken: vi.fn(),
  },
}));
import { api } from "../src/api/client";

const SETTING = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: false,
};

const CAPS = [
  { id: "projects:read", domain: "projects", access: "read", label: "Projects — baca", desc: "" },
  { id: "projects:write", domain: "projects", access: "write", label: "Projects — tulis", desc: "" },
  { id: "sessions:write", domain: "sessions", access: "write", label: "Sesi — tulis", desc: "", risk: "rce" },
];

beforeEach(() => {
  (api.getSettings as any).mockResolvedValue({ ...SETTING });
  (api.putSettings as any).mockResolvedValue({ ...SETTING });
  (api.getAgentCapabilities as any).mockResolvedValue({ capabilities: CAPS });
  (api.listAgentTokens as any).mockResolvedValue({ items: [] });
  (api.createAgentToken as any).mockResolvedValue({ id: "t1", name: "ci", tokenPrefix: "hnm_agt_ab", capabilities: ["projects:read"], enabled: true, createdBy: null, createdAt: "2026-07-21T00:00:00Z", lastUsedAt: null, revokedAt: null, token: "hnm_agt_secret" });
});

describe("AgentAccessPanel", () => {
  it("creates a token and shows plaintext once", async () => {
    render(<AgentAccessPanel />);
    await waitFor(() => expect(api.listAgentTokens).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Nama token"), { target: { value: "ci" } });
    fireEvent.click(screen.getByLabelText("projects:read"));
    fireEvent.click(screen.getByRole("button", { name: /buat token/i }));
    await waitFor(() => expect(api.createAgentToken).toHaveBeenCalledWith({ name: "ci", capabilities: ["projects:read"] }));
    await waitFor(() => expect(screen.getByText("hnm_agt_secret")).toBeTruthy());
  });

  // SPEC-482 · ADR-0099 · panduan pemasangan MCP harus benar-benar TERPASANG di tab ini, bukan
  // sekadar ada sebagai komponen. `mcp-panel.test.tsx` merender McpPanel berdiri sendiri — dengan
  // itu saja, menghapus <McpPanel/> dari AgentAccessPanel tetap hijau dan panduannya lenyap dari
  // dashboard tanpa satu pun test merah. Ini call site-nya, dan inilah yang menjaganya.
  it("SPEC-482 · memuat panduan pemasangan MCP di tab yang sama dengan pengelolaan token", async () => {
    render(<AgentAccessPanel />);
    await waitFor(() => expect(api.listAgentTokens).toHaveBeenCalled());
    const snippet = screen.getByTestId("mcp-snippet").textContent ?? "";
    expect(snippet).toContain('"command": "hanoman"');
    expect(snippet).toContain("HANOMAN_AGENT_TOKEN");
    // Token nyata tak pernah masuk contoh pemasangan — hanya placeholder.
    expect(snippet).toContain("hnm_agt_…");
    expect(snippet).not.toContain("hnm_agt_secret");
    expect(screen.getByTestId("mcp-tools")).toBeTruthy();
  });

  it("toggles the master switch via putSettings", async () => {
    render(<AgentAccessPanel />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(expect.objectContaining({ agentAccessEnabled: true })));
  });
});
