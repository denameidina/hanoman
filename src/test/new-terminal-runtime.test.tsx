// Stub `../src/api/events` diimpor PALING DULU: factory `vi.mock` di bawah membacanya saat
// modul yang di-mock pertama kali dievaluasi — itu terjadi sebelum import di bawahnya selesai.
import { eventsStub } from "./helpers/events-stub";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listTerminals = vi.fn();
const createTerminal = vi.fn();
const getSettings = vi.fn();
const getCodexVersion = vi.fn();
const listBranches = vi.fn();
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } },
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    createShell: vi.fn(async () => ({ id: "sh1" })),
    deleteTerminal: vi.fn(async () => {}),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 0 })),
    getSettings: (...a: unknown[]) => getSettings(...a),
    getCodexVersion: (...a: unknown[]) => getCodexVersion(...a),
    listBranches: (...a: unknown[]) => listBranches(...a),
    getTerminalWorkspace: vi.fn(async () => ({ workspace: null, revision: 0, updatedAt: null })),
    putTerminalWorkspace: vi.fn(async (input: { baseRevision: number; workspace: unknown }) => ({
      workspace: input.workspace, revision: input.baseRevision + 1, updatedAt: "2026-08-15T00:00:00.000Z",
    })),
  },
}));

vi.mock("../src/api/events", () => ({
  // SPEC-908 · stub terpusat, bukan tiga ekspor tangan: modul ini kini juga punya
  // `subscribeTopic`/`eventsTopics`/`eventsHelloSeen`, dan ekspor yang hilang baru
  // meledak saat sebuah layar realtime kebetulan ikut ter-render.
  ...eventsStub,
  // SPEC-897 · HanomanPet membaca status koneksi dari socket `events` yang sama.
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid="pane">{sessionId}</div>,
}));

import { TerminalScreen } from "../src/screens/TerminalScreen";

const projects = [{ id: "p1", name: "hanoman" }];
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", agent: "claude",
  codex: { model: "gpt-5.6-sol", effort: "xhigh" }, ...over,
});

beforeEach(() => {
  localStorage.clear();
  [listTerminals, createTerminal, getSettings, getCodexVersion, listBranches].forEach((m) => m.mockReset());
  listBranches.mockResolvedValue({ branches: ["main", "dev"], remotes: ["main", "fitur-x"], defaultBranch: "main" });
  listTerminals.mockResolvedValue([]);
  createTerminal.mockResolvedValue({ id: "term1" });
  getSettings.mockResolvedValue(settings());
  getCodexVersion.mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true });
});

// SPEC-517 · "Sesi baru" tak lagi langsung men-spawn: operator memilih runtime dulu.
describe("Sesi baru · pemilih runtime (SPEC-517)", () => {
  it("membuka form, bukan langsung membuat sesi", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    expect(await screen.findByLabelText("Agen")).toBeInTheDocument();
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it("prefill dari setelan global", async () => {
    getSettings.mockResolvedValue(settings({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "low" } }));
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("codex"));
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-terra");
    expect(screen.getByLabelText("Effort")).toHaveValue("low");
  });

  it("menukar agen menukar katalog model & effort", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));
    const opts = [...screen.getByLabelText("Model").querySelectorAll("option")].map((o) => o.value);
    expect(opts).toContain("gpt-5.6-luna");
    expect(opts).not.toContain("claude-opus-5");
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(
      [...screen.getByLabelText("Effort").querySelectorAll("option")].map((o) => o.value),
    ).toEqual(["max", "xhigh", "high", "medium", "low"]));
  });

  it("mengirim pilihan ke createTerminal dan menaruh sesinya di grid", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));
    fireEvent.click(screen.getByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalledWith(
      "p1", { agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("term1"));
  });

  it("CLI codex terlalu tua → catatan lunak, tombol tetap hidup", async () => {
    getCodexVersion.mockResolvedValue({ version: "0.142.5", minRequired: "0.144.0", ok: false });
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("claude"));
    expect(screen.queryByTestId("codex-version-note")).toBeNull();
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    expect(await screen.findByTestId("codex-version-note")).toHaveTextContent("0.142.5");
    expect(screen.getByRole("button", { name: "Buka sesi" })).toBeEnabled();
  });

  it("GET /settings gagal → form tetap bisa dipakai dengan default bawaan", async () => {
    getSettings.mockRejectedValue(new Error("boom"));
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("claude"));
    fireEvent.click(screen.getByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalled());
  });
});

describe("Sesi baru · galat tak ditelan (audit UI/UX)", () => {
  it("GET /settings gagal tampil sebagai catatan, dan form tetap memakai default", async () => {
    getSettings.mockRejectedValue(new Error("boom"));
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    expect(await screen.findByText(/Gagal memuat pengaturan: boom/)).toBeInTheDocument();
    expect(screen.getByLabelText("Agen")).toHaveValue("claude");
  });

  it("gagal membuka sesi tampil alasannya dan modal tetap terbuka untuk dicoba lagi", async () => {
    createTerminal.mockRejectedValueOnce(new Error("project belum di-bind"));
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    fireEvent.click(await screen.findByRole("button", { name: "Buka sesi" }));
    expect(await screen.findByText(/Gagal membuka sesi: project belum di-bind/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buka sesi" })).toBeInTheDocument();
  });
});

 it("SPEC-1442 selects interactive Antigravity with its own defaults", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await screen.findByLabelText("Agen");
    expect(screen.getByRole("option", { name: "Antigravity CLI" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "antigravity" } });
    expect(screen.getByLabelText("Model")).toHaveValue("gemini-3.8-flash-high");
    expect(screen.getByLabelText("Effort")).toHaveValue("high");
  });

// ADR-0232 · worktree terpisah + branch asal dipilih per sesi.
describe("Sesi baru · worktree terpisah (ADR-0232)", () => {
  it("default tanpa worktree: body tak memuat worktree/branchFrom", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await screen.findByLabelText("Agen");
    expect(screen.queryByLabelText("Branch asal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalled());
    expect(createTerminal.mock.calls[0]![1]).not.toHaveProperty("worktree");
    expect(createTerminal.mock.calls[0]![1]).not.toHaveProperty("branchFrom");
    expect(listBranches).not.toHaveBeenCalled();
  });

  it("worktree + branch pilihan ikut ke body; branch remote-only diberi tanda origin", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await screen.findByLabelText("Agen");
    fireEvent.click(screen.getByText("Worktree terpisah"));
    const sel = await screen.findByLabelText("Branch asal");
    await screen.findByRole("option", { name: "fitur-x · origin" });
    fireEvent.change(sel, { target: { value: "dev" } });
    fireEvent.click(screen.getByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalled());
    expect(createTerminal.mock.calls[0]![1]).toMatchObject({ worktree: true, branchFrom: "dev" });
  });

  it("worktree tanpa memilih branch → HEAD (branchFrom tak dikirim)", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await screen.findByLabelText("Agen");
    fireEvent.click(screen.getByText("Worktree terpisah"));
    await screen.findByLabelText("Branch asal");
    fireEvent.click(screen.getByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalled());
    expect(createTerminal.mock.calls[0]![1]).toMatchObject({ worktree: true });
    expect(createTerminal.mock.calls[0]![1]).not.toHaveProperty("branchFrom");
  });
});
