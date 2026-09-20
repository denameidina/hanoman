import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TerminalScreen } from "../src/screens/TerminalScreen";

// SPEC-1267 · Cell dimemo: render ulang layar dengan prop handler beridentitas baru (lambda inline
// milik App) tak boleh merender ulang pane.
const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: () => { renders.n += 1; return <div data-testid="pane" />; },
}));
vi.mock("../src/api/client", () => ({
  ApiError: class extends Error {},
  api: {
    listTerminals: vi.fn(async () => [{ id: "s1", projectId: "p1", cwd: "/repo", exited: false }]),
    getTerminalWorkspace: vi.fn(async () => ({
      workspace: { version: 1, groups: [{ id: "g", name: "G", layout: { rows: 1, cols: 1, cells: ["s1"] } }] },
      revision: 1, updatedAt: null,
    })),
    putTerminalWorkspace: vi.fn(),
    deleteTerminal: vi.fn(),
    listBranches: vi.fn(async () => ({ branches: [], remotes: [] })),
    getSettings: vi.fn(async () => ({ model: "m", effort: "e", agent: "claude", codex: { model: "m", effort: "e" } })),
    getCodexVersion: vi.fn(async () => ({ version: "1", minRequired: "1", ok: true })),
    listSpecs: vi.fn(),
  },
}));
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));

beforeEach(() => { localStorage.clear(); renders.n = 0; });

describe("TerminalScreen memo (SPEC-1267 · AC-S28)", () => {
  it("prop handler baru dengan perilaku sama tak merender ulang Cell", async () => {
    const projects = [{ id: "p1", name: "hanoman" }];
    const { rerender } = render(<TerminalScreen userId="u" projects={projects}
      onOpenReview={() => {}} titleOf={() => undefined} />);
    await screen.findByTestId("pane");
    const settled = renders.n;
    rerender(<TerminalScreen userId="u" projects={projects}
      onOpenReview={() => {}} titleOf={() => undefined} />);
    rerender(<TerminalScreen userId="u" projects={projects}
      onOpenReview={() => {}} titleOf={() => undefined} />);
    expect(renders.n).toBe(settled);
  });
});
