import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
const spec = { id: "SPEC-341", projectId: "arta", title: "Tetap di backlog", source: "qa",
  stage: "brainstorming", priority: "tinggi", author: "qa", objective: "o", payload: {},
  branchFrom: null, baseSha: null };
vi.mock("../src/screens/TerminalPane", () => ({ TerminalPane: () => null }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => ({ items: [{ id: "arta", name: "arta", desc: "", kind: "existing", stack: "Go",
      docStatus: "ok", coverage: 94, createdAt: "", backlog: 2, topStage: "execute",
      session: { status: "running", phase: "Execute", flow: "feature" }, activity: "x", commit: "y" }], total: 1, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [spec], total: 1, page: 1, pageSize: 20 })), listTerminals: vi.fn(async () => []),
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
});
