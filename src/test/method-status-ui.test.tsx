import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { METHODS, methodSkills } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    getSettings: vi.fn(), putSettings: vi.fn(), startSession: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
    getMethodStatus: vi.fn(), listProjects: vi.fn(), createShell: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const settings = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  verifyScope: "changed", method: "superpowers", agent: "claude",
  codex: { model: "gpt-5.6-sol", effort: "xhigh" },
  conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
};

const status = () => ({
  agents: [
    { agent: "claude", home: "/h/.claude", roots: ["/h/.claude/skills"], skills: 14 },
    { agent: "codex", home: "/h/.codex", roots: [], skills: 0 },
  ],
  methods: [
    { method: "superpowers", label: "superpowers", agent: "claude", ready: true,
      missingPackages: [], missingSkills: [],
      install: ["claude plugin install superpowers@superpowers-marketplace"] },
    { method: "superpowers", label: "superpowers", agent: "codex", ready: false,
      missingPackages: ["superpowers"], missingSkills: methodSkills(METHODS.superpowers!),
      install: ["codex plugin add superpowers@openai-curated"] },
    { method: "matt", label: "mattpocock", agent: "claude", ready: false,
      missingPackages: ["mattpocock-skills"], missingSkills: ["mattpocock-skills:grilling"],
      install: ["claude plugin install mattpocock-skills"] },
    { method: "matt", label: "mattpocock", agent: "codex", ready: false,
      missingPackages: ["mattpocock-skills", "superpowers"], missingSkills: ["mattpocock-skills:grilling"],
      install: ["npx skills@latest add mattpocock/skills"] },
  ],
});

const me = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" } as never;
const openSesi = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Sesi" }));
};

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings as never);
  vi.mocked(api.putSettings).mockResolvedValue(settings as never);
  vi.mocked(api.getMethodStatus).mockResolvedValue(status() as never);
  vi.mocked(api.listProjects).mockResolvedValue(
    { items: [{ id: "hanoman", binding: "/repo" }], total: 1, page: 1, pageSize: 20 } as never);
  vi.mocked(api.createShell).mockResolvedValue({ id: "sh1" } as never);
});

describe("SettingsScreen · checklist kesiapan metode (SPEC-739)", () => {
  it("menampilkan satu baris per metode × agen", async () => {
    openSesi();
    await waitFor(() => expect(screen.getByTestId("method-status-superpowers-claude")).toBeInTheDocument());
    for (const id of ["superpowers", "matt"])
      for (const a of ["claude", "codex"])
        expect(screen.getByTestId(`method-status-${id}-${a}`)).toBeInTheDocument();
  });

  // Peringatan WAJIB menyebut agen: superpowers bisa siap untuk claude dan kosong untuk codex
  // di mesin yang sama.
  it("baris menyebut AGEN-nya, dan siap/belum siap berbeda per agen", async () => {
    openSesi();
    const ok = await screen.findByTestId("method-status-superpowers-claude");
    const bad = screen.getByTestId("method-status-superpowers-codex");
    expect(ok).toHaveTextContent("Claude Code");
    expect(ok).toHaveTextContent("siap");
    expect(bad).toHaveTextContent("Codex CLI");
    expect(bad).toHaveTextContent("belum siap");
  });

  it("sebabnya spesifik: paket kurang DAN id skill kurang", async () => {
    openSesi();
    const bad = await screen.findByTestId("method-status-superpowers-codex");
    expect(bad).toHaveTextContent("superpowers");
    expect(bad).toHaveTextContent("superpowers:verification-before-completion");
  });

  it("tombol Pasang melahirkan sesi terminal dengan metode & agen barisnya", async () => {
    openSesi();
    const bad = await screen.findByTestId("method-status-superpowers-codex");
    fireEvent.click(within(bad).getByRole("button", { name: /pasang/i }));
    await waitFor(() => expect(api.createShell).toHaveBeenCalledWith(
      "hanoman", { method: "superpowers", agent: "codex" }));
  });

  it("baris yang sudah siap tak menawarkan tombol Pasang", async () => {
    openSesi();
    const ok = await screen.findByTestId("method-status-superpowers-claude");
    expect(within(ok).queryByRole("button", { name: /pasang/i })).toBeNull();
  });

  // Endpoint gagal tak boleh mematikan kartu — ini observabilitas, bukan gerbang.
  it("status gagal dimuat → kartu tetap render tanpa checklist", async () => {
    vi.mocked(api.getMethodStatus).mockRejectedValue(new Error("boom"));
    openSesi();
    await waitFor(() => expect(screen.getByLabelText("Metode default")).toBeInTheDocument());
    expect(screen.queryByTestId("method-status-superpowers-claude")).toBeNull();
  });
});
