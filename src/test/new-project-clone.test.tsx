import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const CREATED = {
  id: "repo", name: "repo", desc: "", kind: "existing", repoDir: null, binding: null,
  gitRemote: "https://github.com/org/repo.git", stack: "", docStatus: "broken", coverage: 0,
  createdAt: "", backlog: 0, topStage: "spec", activity: "idle", commit: "",
  session: { status: "idle", phase: null, flow: null },
};

// SPEC-848 · CTA clone kini memulai sesi reverse lalu berpindah ke Terminal; layar itu self-fetch
// workspace/riwayat dan bukan subjek berkas ini.
vi.mock("../src/screens/TerminalScreen", () => ({ TerminalScreen: () => null }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    createProject: vi.fn(async () => CREATED),
    cloneProject: vi.fn(async () => ({ repoDir: "/tmp/clone" })),
    getProject: vi.fn(async () => ({ ...CREATED, binding: "/tmp/clone" })),
    reverseDocs: vi.fn(async () => ({ id: "reverse-repo" })),   // SPEC-848 · auto-start sesudah clone
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

describe("create existing via clone (SPEC-218)", () => {
  it("mode clone memanggil createProject(gitRemote, tanpa repoDir) lalu cloneProject(dir)", async () => {
    const { api } = await import("../src/api/client");
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click((await screen.findAllByText("Project baru"))[0]!);
    fireEvent.click(await screen.findByText("Existing codebase"));
    fireEvent.click(await screen.findByText("Clone dari URL git"));
    fireEvent.change(await screen.findByPlaceholderText("https://github.com/org/repo.git"),
      { target: { value: "https://github.com/org/repo.git" } });
    fireEvent.change(screen.getByPlaceholderText("/path/ke/repo"), { target: { value: "/tmp/clone" } });
    fireEvent.click(screen.getByText("Clone → reverse-engineer docs"));
    await waitFor(() => expect((api.cloneProject as any)).toHaveBeenCalledWith("repo", "/tmp/clone"));
    const arg = (api.createProject as any).mock.calls[0][0];
    expect(arg).toMatchObject({ kind: "existing", gitRemote: "https://github.com/org/repo.git" });
    expect(arg.repoDir).toBeUndefined();
  });
});
