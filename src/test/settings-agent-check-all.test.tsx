import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue({ agentAccessEnabled: true } as any);
  vi.mocked(api.getAgentCapabilities).mockResolvedValue({ capabilities: CAPABILITIES } as any);
  vi.mocked(api.listAgentTokens).mockResolvedValue({ items: [] } as any);
  vi.mocked(api.createAgentToken).mockResolvedValue({ name: "a", token: "hnm_agt_x" } as any);
});

const ids = (access: string) => CAPABILITIES.filter((c) => c.access === access).map((c) => c.id);
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

// Mencentang 30-an kotak satu per satu adalah alasan nyata orang memberi token capability
// seadanya. Yang dijaga: tiap "pilih semua" mengenai KOLOMNYA saja, dan capability yang benar-
// benar terkirim ke createAgentToken — bukan sekadar kotaknya terlihat tercentang.
describe("pilih semua capability", () => {
  it("kolom baca mencentang seluruh capability read dan tak menyentuh kolom lain", async () => {
    render(<AgentAccessPanel />);
    fireEvent.click(await screen.findByLabelText("pilih semua baca"));
    for (const id of ids("read")) expect(box(id).checked, id).toBe(true);
    for (const id of [...ids("write"), ...ids("danger")]) expect(box(id).checked, id).toBe(false);
  });

  it("kolom tulis dan berbahaya punya pilih-semua sendiri", async () => {
    render(<AgentAccessPanel />);
    fireEvent.click(await screen.findByLabelText("pilih semua tulis"));
    fireEvent.click(screen.getByLabelText("pilih semua berbahaya"));
    for (const id of [...ids("write"), ...ids("danger")]) expect(box(id).checked, id).toBe(true);
    for (const id of ids("read")) expect(box(id).checked, id).toBe(false);
  });

  it("pilih semua global mengirim SELURUH capability saat token dibuat", async () => {
    render(<AgentAccessPanel />);
    fireEvent.click(await screen.findByLabelText("pilih semua capability"));
    fireEvent.change(screen.getByLabelText("Nama token"), { target: { value: "bot" } });
    fireEvent.click(screen.getByRole("button", { name: /buat token/i }));
    await waitFor(() => expect(api.createAgentToken).toHaveBeenCalled());
    const sent = vi.mocked(api.createAgentToken).mock.calls[0]?.[0] as { capabilities: string[] };
    expect([...sent.capabilities].sort()).toEqual(CAPABILITIES.map((c) => c.id).sort());
  });

  it("klik kedua pada pilih semua global mengosongkan lagi", async () => {
    render(<AgentAccessPanel />);
    const all = await screen.findByLabelText("pilih semua capability");
    fireEvent.click(all);
    fireEvent.click(all);
    for (const c of CAPABILITIES) expect(box(c.id).checked, c.id).toBe(false);
  });

  it("kolom yang setengah terisi tampil indeterminate, bukan kosong", async () => {
    render(<AgentAccessPanel />);
    fireEvent.click(await screen.findByLabelText(ids("read")[0] as string));
    const head = box("pilih semua baca");
    expect(head.checked).toBe(false);
    expect(head.indeterminate).toBe(true);
  });
});
