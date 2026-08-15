import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TerminalScreen } from "../src/screens/TerminalScreen";

// SPEC-742 · ADR-0116 · sesi yang ditutup lepas dari layar SEKETIKA; yang masih berjalan cuma
// penghapusan byte worktree-nya di latar, dan itulah yang dilaporkan indikator ini.
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid="pane">{sessionId}</div>,
}));
const listTerminals = vi.fn();
const deleteTerminal = vi.fn();
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } },
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    deleteTerminal: (...a: unknown[]) => deleteTerminal(...a),
    listBranches: vi.fn(async () => ({ branches: [], remotes: [] })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
    getSettings: vi.fn(async () => ({ model: "claude-opus-5", effort: "xhigh", agent: "claude",
      codex: { model: "gpt-5.6-sol", effort: "xhigh" } })),
    getCodexVersion: vi.fn(async () => ({ version: "0.145.0", minRequired: "0.144.0", ok: true })),
    getTerminalWorkspace: vi.fn(async () => ({ workspace: null, revision: 0, updatedAt: null })),
    putTerminalWorkspace: vi.fn(async (input: { baseRevision: number; workspace: unknown }) => ({
      workspace: input.workspace, revision: input.baseRevision + 1, updatedAt: "2026-08-15T00:00:00.000Z",
    })),
  },
}));
const ev = vi.hoisted(() => ({ handler: undefined as ((m: unknown) => void) | undefined }));
vi.mock("../src/api/events", () => ({
  subscribe: (fn: (m: unknown) => void) => { ev.handler = fn; return () => { ev.handler = undefined; }; },
}));

const projects = [{ id: "p1", name: "hanoman" }];
const cleanup = (sessionId: string, error?: string) => ({
  sessionId, projectId: "p1", entry: `${sessionId}.abc`,
  since: "2026-08-13T00:00:00.000Z", state: error ? "failed" : "closing", ...(error ? { error } : {}),
});
const push = (m: unknown) => act(() => { ev.handler?.(m); });

beforeEach(() => {
  localStorage.clear();
  listTerminals.mockReset(); deleteTerminal.mockReset();
  listTerminals.mockResolvedValue([]);
});

describe("indikator pembersihan worktree (SPEC-742)", () => {
  it("tak ada indikator selama tak ada pembersihan tertunda", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    push({ t: "cleanups", cleanups: [] });
    expect(screen.queryByTestId("worktree-cleanups")).toBeNull();
  });

  it("muncul selagi menyapu, lalu hilang saat daftarnya kosong (closing → closed)", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");

    push({ t: "cleanups", cleanups: [cleanup("spec-742"), cleanup("spec-700")] });
    expect(screen.getByTestId("worktree-cleanups")).toHaveTextContent("membersihkan 2 worktree");

    push({ t: "cleanups", cleanups: [] });
    expect(screen.queryByTestId("worktree-cleanups")).toBeNull();
  });

  // Requirement 4: kegagalan pembersihan tak boleh hilang senyap.
  it("entri yang gagal dilaporkan sebagai kegagalan, bukan sebagai 'sedang membersihkan'", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");

    push({ t: "cleanups", cleanups: [cleanup("spec-742", "EACCES disk penuh")] });

    const el = screen.getByTestId("worktree-cleanups");
    expect(el).toHaveTextContent("1 worktree gagal dibersihkan");
    expect(el).toHaveAttribute("title", expect.stringContaining("EACCES disk penuh"));
  });
});

describe("menutup sesi (SPEC-742)", () => {
  // Inti keluhannya: operator menunggu. DELETE tak boleh lagi menahan layar sedetik pun.
  it("melepas sel SEBELUM respons DELETE datang", async () => {
    listTerminals.mockResolvedValue([{ id: "spec-742", projectId: "p1", cwd: "", exited: false }]);
    deleteTerminal.mockReturnValue(new Promise(() => {}));   // tak pernah selesai
    render(<TerminalScreen projects={projects} />);
    const tutup = await screen.findByLabelText("Tutup sesi spec-742");

    fireEvent.click(tutup);

    await waitFor(() => expect(screen.queryByLabelText("Tutup sesi spec-742")).toBeNull());
    expect(deleteTerminal).toHaveBeenCalledWith("spec-742");
  });
});
