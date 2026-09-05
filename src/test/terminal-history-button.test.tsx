// Stub `../src/api/events` diimpor PALING DULU: factory `vi.mock` di bawah membacanya saat
// modul yang di-mock pertama kali dievaluasi — itu terjadi sebelum import di bawahnya selesai.
import { eventsStub } from "./helpers/events-stub";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listSessionHistory = vi.fn();
const sessionTranscript = vi.fn();
const startSession = vi.fn();
const createShell = vi.fn();
const createTerminal = vi.fn();
const createTerminalFlow = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listTerminals: vi.fn(async () => []),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 0 })),
    listSessionHistory: (...a: unknown[]) => listSessionHistory(...a),
    sessionTranscript: (...a: unknown[]) => sessionTranscript(...a),
    startSession: (...a: unknown[]) => startSession(...a),
    createShell: (...a: unknown[]) => createShell(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    createTerminalFlow: (...a: unknown[]) => createTerminalFlow(...a),
    deleteTerminal: vi.fn(async () => {}),
    getTerminalWorkspace: vi.fn(async () => ({ workspace: null, revision: 0, updatedAt: null })),
    putTerminalWorkspace: vi.fn(async (input: { baseRevision: number; workspace: unknown }) => ({
      workspace: input.workspace, revision: input.baseRevision + 1, updatedAt: "2026-08-15T00:00:00.000Z",
    })),
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string, public detail: unknown = null) { super(message); }
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
vi.mock("../src/screens/TerminalPane", () => ({ TerminalPane: () => <div data-testid="pane" /> }));
import { TerminalScreen } from "../src/screens/TerminalScreen";
import { ApiError } from "../src/api/client";

const row = (over: Record<string, unknown> = {}) => ({
  id: "h1", sessionId: "spec-362", projectId: "p1", specId: "SPEC-362", title: "History session terminal",
  kind: "spec", flow: "feature", agent: "claude", model: null, effort: null, branch: null,
  cwd: "/r", startedAt: "2026-07-28T01:00:00.000Z", endedAt: "2026-07-28T02:00:00.000Z",
  exitCode: 0, transcriptBytes: null, ...over,
});

beforeEach(() => {
  [listSessionHistory, sessionTranscript, startSession, createShell, createTerminal, createTerminalFlow].forEach((m) => m.mockReset());
  startSession.mockResolvedValue({ id: "spec-362" });
  createShell.mockResolvedValue({ id: "sh1" });
  createTerminal.mockResolvedValue({ id: "t1" });
});

const projects = [{ id: "p1", name: "hanoman" }];

describe("Riwayat di Terminal (SPEC-362)", () => {
  it.each(["spec", "reverse"])("shows rejection and manually retries %s history with the same context", async (kind) => {
    const start = kind === "spec" ? startSession : createTerminalFlow;
    start.mockRejectedValueOnce(new ApiError(409, "409", { error: "Host sibuk", kind: "host-load",
      admission: { enabled: true, liveCount: 3, liveAgentCount: 2, maxConcurrent: 6,
        loadPerCore: 3.75, maxLoadPerCore: 2.5, loadStatus: "available" },
    })).mockResolvedValueOnce({ id: "retry-session" });
    listSessionHistory.mockResolvedValue({ items: [row({ kind, ...(kind === "reverse" ? { specId: null, flow: "reverse" } : {}) })],
      total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    fireEvent.click(await screen.findByText("History session terminal"));
    fireEvent.click(await screen.findByText("Mulai lagi"));
    const alert = await screen.findByRole("alert", {}, { timeout: 1000 });
    expect(alert).toHaveTextContent("3 sesi hidup");
    expect(alert).toHaveTextContent("3.75");
    expect(start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Mulai tetap" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    if (kind === "spec") expect(start).toHaveBeenLastCalledWith({ spec: "SPEC-362", flow: "feature", force: true });
    else expect(start).toHaveBeenLastCalledWith("p1", "reverse", { force: true });
    await waitFor(() => expect(screen.queryByText("Riwayat sesi")).not.toBeInTheDocument());
  });

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
