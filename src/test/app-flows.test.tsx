import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockViewport, resetViewport } from "./viewport";
const spec = { id: "SPEC-341", projectId: "arta", title: "Tetap di backlog", source: "qa",
  stage: "brainstorming", priority: "tinggi", author: "qa", objective: "o", payload: {},
  branchFrom: null, baseSha: null };
const { listSpecs, listTerminals } = vi.hoisted(() => ({
  listSpecs: vi.fn(), listTerminals: vi.fn(),
}));
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid={`pane-${sessionId}`}>{sessionId}</div>,
}));
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => ({ items: [{ id: "arta", name: "arta", desc: "", kind: "existing", stack: "Go",
      docStatus: "ok", coverage: 94, createdAt: "", backlog: 2, topStage: "execute",
      session: { status: "running", phase: "Execute", flow: "feature" }, activity: "x", commit: "y" }], total: 1, page: 1, pageSize: 20 })),
    listSpecs, listTerminals,
    getSettings: vi.fn(async () => ({ model: "claude-opus-5", effort: "xhigh", agent: "claude",
      codex: { model: "gpt-5.6-sol", effort: "xhigh" }, goal: { enabled: false, condition: "" } })),
    getCodexVersion: vi.fn(async () => ({ version: null, minRequired: "0.144.0", ok: true })),
    // SPEC-739 · picker Start menurunkan kesiapan metode saat modal terbuka; mock `api`
    // parsial WAJIB menyebutnya, kalau tidak efeknya melempar dan terbaca seperti regresi.
    getMethodStatus: vi.fn(async () => ({ methods: [] })),
    startSession: vi.fn(async () => ({ id: "spec-341" })), deleteSpec: vi.fn(), createSpec: vi.fn(),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })), // SPEC-180 · provider poll
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";
import { api } from "../src/api/client";
describe("app flows", () => {
  beforeEach(() => {
    localStorage.clear();
    listSpecs.mockReset().mockResolvedValue({ items: [spec], total: 1, page: 1, pageSize: 20 });
    listTerminals.mockReset().mockResolvedValue([]);
  });
  afterEach(resetViewport);

  it("loads projects from the api on mount", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/arta/i).length).toBeGreaterThan(0));
  });

  it("tetap di Backlog setelah sesi dimulai", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("arta").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Backlog")[0]!);
    await screen.findByText("Tetap di backlog");
    fireEvent.click(screen.getByRole("button", { name: "Mulai" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Mulai" }).at(-1)!);
    await waitFor(() => expect(api.startSession).toHaveBeenCalled());
    expect(screen.getByText("specs · brainstorm → execute")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-root")).toBeNull();
  });

  it("Buka sesi dari Backlog menampilkan sesi spec yang dipilih", async () => {
    mockViewport(390);
    listSpecs.mockResolvedValue({ items: [{ ...spec, stage: "executing" }], total: 1, page: 1, pageSize: 20 });
    listTerminals.mockResolvedValue([
      { id: "spec-341", projectId: "arta", specId: "SPEC-341", cwd: "/repo", exited: false },
    ]);
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/arta/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Backlog")[0]!);
    await screen.findByText("Tetap di backlog");

    fireEvent.click(screen.getByRole("button", { name: "Buka sesi" }));

    expect(await screen.findByTestId("pane-spec-341")).toBeInTheDocument();
  });
});
