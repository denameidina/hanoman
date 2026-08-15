import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listSessionHistory = vi.fn();
const sessionTranscript = vi.fn();
const startSession = vi.fn();
const createShell = vi.fn();
const createTerminal = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listTerminals: vi.fn(async () => []),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 0 })),
    listSessionHistory: (...a: unknown[]) => listSessionHistory(...a),
    sessionTranscript: (...a: unknown[]) => sessionTranscript(...a),
    startSession: (...a: unknown[]) => startSession(...a),
    createShell: (...a: unknown[]) => createShell(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    deleteTerminal: vi.fn(async () => {}),
    getTerminalWorkspace: vi.fn(async () => ({ workspace: null, revision: 0, updatedAt: null })),
    putTerminalWorkspace: vi.fn(async (input: { baseRevision: number; workspace: unknown }) => ({
      workspace: input.workspace, revision: input.baseRevision + 1, updatedAt: "2026-08-15T00:00:00.000Z",
    })),
  },
  ApiError: class extends Error { status = 0; detail: unknown = null; },
}));
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));
vi.mock("../src/screens/TerminalPane", () => ({ TerminalPane: () => <div data-testid="pane" /> }));
import { TerminalScreen } from "../src/screens/TerminalScreen";

const row = (over: Record<string, unknown> = {}) => ({
  id: "h1", sessionId: "spec-362", projectId: "p1", specId: "SPEC-362", title: "History session terminal",
  kind: "spec", flow: "feature", agent: "claude", model: null, effort: null, branch: null,
  cwd: "/r", startedAt: "2026-07-28T01:00:00.000Z", endedAt: "2026-07-28T02:00:00.000Z",
  exitCode: 0, transcriptBytes: null, ...over,
});

beforeEach(() => {
  [listSessionHistory, sessionTranscript, startSession, createShell, createTerminal].forEach((m) => m.mockReset());
  startSession.mockResolvedValue({ id: "spec-362" });
  createShell.mockResolvedValue({ id: "sh1" });
  createTerminal.mockResolvedValue({ id: "t1" });
});

const projects = [{ id: "p1", name: "hanoman" }];

describe("Riwayat di Terminal (SPEC-362)", () => {
  it("riwayat TIDAK dirender sebelum diminta — grid terminal tak terhalangi", async () => {
    render(<TerminalScreen projects={projects} backlog={[]} />);
    await waitFor(() => expect(screen.getByTestId("terminal-root")).toBeTruthy());
    expect(screen.queryByText("Riwayat sesi")).toBeNull();
    expect(listSessionHistory).not.toHaveBeenCalled();
  });

  it("tombol Riwayat membuka modal & memuat halaman pertama", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    expect(await screen.findByText("Riwayat sesi")).toBeTruthy();
    await waitFor(() => expect(listSessionHistory).toHaveBeenCalled());
  });

  it("Mulai lagi sesi backlog memanggil startSession dengan spec + flow tersimpan", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    fireEvent.click(await screen.findByText("History session terminal"));
    fireEvent.click(await screen.findByText("Mulai lagi"));
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ spec: "SPEC-362", flow: "feature" }));
  });

  // SPEC-517 · "Mulai lagi" = sesi BARU dengan konteks yang sama. Sejak runtime bisa dipilih,
  // "konteks yang sama" termasuk agen/model/effort yang tercatat di baris riwayat itu.
  it("Mulai lagi terminal agen membawa runtime baris riwayatnya", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ kind: "terminal", specId: null, title: null, flow: null,
        agent: "codex", model: "gpt-5.6-terra", effort: "low" })],
      total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    await waitFor(() => expect(screen.getAllByText("hanoman").some((el) => el.closest("button"))).toBe(true));
    fireEvent.click(screen.getAllByText("hanoman").find((el) => el.closest("button"))!);
    fireEvent.click(await screen.findByText("Mulai lagi"));
    await waitFor(() => expect(createTerminal).toHaveBeenCalledWith(
      "p1", { agent: "codex", model: "gpt-5.6-terra", effort: "low" }));
  });

  it("Mulai lagi terminal biasa memanggil createShell dengan projectnya", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ kind: "shell", specId: null, title: null, flow: null })], total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    // "hanoman" juga jadi <option> di picker project toolbar — baris riwayat adalah yang di dalam
    // <button>. Sesi shell tak punya judul/spec, jadi nama project memang label barisnya.
    await waitFor(() => expect(screen.getAllByText("hanoman").some((el) => el.closest("button"))).toBe(true));
    fireEvent.click(screen.getAllByText("hanoman").find((el) => el.closest("button"))!);
    fireEvent.click(await screen.findByText("Mulai lagi"));
    await waitFor(() => expect(createShell).toHaveBeenCalledWith("p1"));
  });
});
