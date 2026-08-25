import { describe, it, expect, vi, beforeEach } from "vitest";
// Catatan: AgentAccessPanel ikut merender <McpPanel/>, yang punya tombol "Tampilkan tool
// berbahaya". Query header kolom karena itu dipersempit ke <div> ber-teks PERSIS "berbahaya" —
// findByText yang longgar akan cocok dua elemen dan gagal karena ambigu, bukan karena kode salah.
import { render, screen } from "@testing-library/react";
import { CAPABILITIES } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    getSettings: vi.fn(), putSettings: vi.fn(),
    getAgentCapabilities: vi.fn(), listAgentTokens: vi.fn(),
    createAgentToken: vi.fn(), revokeAgentToken: vi.fn(), patchAgentToken: vi.fn(),
    agentDoc: vi.fn().mockResolvedValue("# doc"),
  },
  ApiError: class extends Error { status = 0 },
}));

import { AgentAccessPanel } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const token = (over: object = {}) => ({
  id: "t1", name: "bot lama", tokenPrefix: "hnm_agt_ab", capabilities: [] as string[],
  enabled: true, createdBy: null, createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null, revokedAt: null, ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue({ agentAccessEnabled: true } as any);
  vi.mocked(api.getAgentCapabilities).mockResolvedValue({ capabilities: CAPABILITIES } as any);
  vi.mocked(api.listAgentTokens).mockResolvedValue({ items: [] } as any);
});

// ADR-0155 · akses KETIGA di grid. Dua hal yang dijaga di sini: kotaknya ADA (tanpa itu manusia
// tak punya cara memberi capability berbahaya sama sekali), dan token yang HAKNYA MENYEMPIT
// mengatakannya dengan kalimat — checkbox kosong baru tak berbicara apa-apa kepada orang yang tak
// membaca release note.
describe("grid capability — kolom berbahaya", () => {
  it("kolomnya ada, dengan checkbox terpisah per capability danger", async () => {
    render(<AgentAccessPanel />);
    expect(await screen.findByText((t, el) => el?.tagName === "DIV" && t === "berbahaya")).toBeInTheDocument();
    for (const id of ["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"])
      expect(screen.getByLabelText(id), id).toBeInTheDocument();
  });

  it("domain tanpa capability danger tak mendapat checkbox liar di kolom itu", async () => {
    render(<AgentAccessPanel />);
    await screen.findByText((t, el) => el?.tagName === "DIV" && t === "berbahaya");
    const danger = CAPABILITIES.filter((c) => c.access === "danger").map((c) => c.id);
    expect(danger).toHaveLength(4);
    expect(screen.queryByLabelText("docs:danger")).toBeNull();
    expect(screen.queryByLabelText("support:danger")).toBeNull();
  });

  it("token ber-sessions:write tanpa spawn menyebut hak yang HILANG", async () => {
    vi.mocked(api.listAgentTokens).mockResolvedValue(
      { items: [token({ capabilities: ["sessions:read", "sessions:write"] })] } as any);
    render(<AgentAccessPanel />);
    expect(await screen.findByText(/dulu bisa membuka sesi baru/i)).toBeInTheDocument();
  });

  it("token yang sudah dicentang spawn TIDAK diperingatkan", async () => {
    vi.mocked(api.listAgentTokens).mockResolvedValue(
      { items: [token({ capabilities: ["sessions:write", "sessions:spawn"] })] } as any);
    render(<AgentAccessPanel />);
    await screen.findByText((t, el) => el?.tagName === "DIV" && t === "berbahaya");
    expect(screen.queryByText(/dulu bisa membuka sesi baru/i)).toBeNull();
  });

  it("token yang kehilangan BEBERAPA hak menyebut semuanya dalam satu kalimat", async () => {
    vi.mocked(api.listAgentTokens).mockResolvedValue(
      { items: [token({ capabilities: ["sessions:write", "ide:write", "vps:write"] })] } as any);
    render(<AgentAccessPanel />);
    const el = await screen.findByText(/dulu bisa membuka sesi baru/i);
    expect(el.textContent).toMatch(/merge\/rebase/i);
    expect(el.textContent).toMatch(/perintah di VPS/i);
  });
});
