import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-848 · CTA "Tambah/Clone → reverse-engineer docs" menjanjikan sesi reverse; sampai spec ini
// ia hanya membuat project lalu membuka Docs yang masih kosong. Berkas ini mengunci janji itu.
const CREATED = {
  id: "repo", name: "repo", desc: "", kind: "existing", repoDir: null, binding: null,
  gitRemote: "", stack: "", docStatus: "broken", coverage: 0,
  createdAt: "", backlog: 0, topStage: "spec", activity: "idle", commit: "",
  session: { status: "idle", phase: null, flow: null },
};

const { FakeApiError, createProject, cloneProject, getProject, reverseDocs } = vi.hoisted(() => ({
  FakeApiError: class extends Error {
    constructor(public status: number, msg: string, public detail: unknown = null) { super(msg); }
  },
  createProject: vi.fn(), cloneProject: vi.fn(), getProject: vi.fn(), reverseDocs: vi.fn(),
}));

// Subjeknya alur App (mulai sesi + tujuan navigasi), bukan isi layar Terminal — TerminalScreen
// self-fetch workspace/riwayat dan hanya menambah mock yang tak menjawab pertanyaan apa pun.
vi.mock("../src/screens/TerminalScreen", () => ({
  TerminalScreen: ({ focusSession }: { focusSession: string | null }) =>
    <div data-testid="terminal-screen">{focusSession ?? "tanpa fokus"}</div>,
}));
// AutoMergeCard (SPEC-486) self-fetch `listBranches` saat detail project di-mount — bukan subjek.
vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ autoScaffold: true })),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    createProject, cloneProject, getProject, reverseDocs,
    getDocs: vi.fn(async () => ({ coverage: 0, tree: [] })),
  },
  ApiError: FakeApiError,
}));
import App from "../src/App";

async function openNewProjectExisting() {
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByText("Projects")[0]!);
  fireEvent.click((await screen.findAllByText("Project baru"))[0]!);
  fireEvent.click(await screen.findByText("Existing codebase"));
}

async function submitClone() {
  fireEvent.click(await screen.findByText("Clone dari URL git"));
  fireEvent.change(screen.getByPlaceholderText("https://github.com/org/repo.git"),
    { target: { value: "https://github.com/org/repo.git" } });
  fireEvent.change(screen.getByPlaceholderText("/path/ke/repo"), { target: { value: "/tmp/clone" } });
  fireEvent.click(screen.getByText("Clone → reverse-engineer docs"));
}

describe("existing project → reverse docs auto-start (SPEC-848)", () => {
  beforeEach(() => {
    createProject.mockReset().mockResolvedValue({ ...CREATED, repoDir: "/repo/ada" });
    cloneProject.mockReset().mockResolvedValue({ repoDir: "/tmp/clone" });
    getProject.mockReset().mockResolvedValue({ ...CREATED, binding: "/tmp/clone" });
    reverseDocs.mockReset().mockResolvedValue({ id: "reverse-repo" });
  });

  // AC-1
  it("mode folder lokal memulai tepat satu sesi reverse lalu membuka Terminal", async () => {
    await openNewProjectExisting();
    fireEvent.change(screen.getByPlaceholderText("/path/ke/repo"), { target: { value: "/repo/ada" } });
    fireEvent.click(screen.getByText("Tambah → reverse-engineer docs"));

    await waitFor(() => expect(reverseDocs).toHaveBeenCalledWith("repo"));
    expect(reverseDocs).toHaveBeenCalledTimes(1);
    expect((await screen.findByTestId("terminal-screen")).textContent).toBe("reverse-repo");
  });

  // AC-2
  it("mode clone memulai reverse tepat sekali sesudah binding hasil clone tersedia", async () => {
    createProject.mockResolvedValue({ ...CREATED, gitRemote: "https://github.com/org/repo.git" });
    await openNewProjectExisting();
    await submitClone();

    await waitFor(() => expect(reverseDocs).toHaveBeenCalledWith("repo"));
    expect(reverseDocs).toHaveBeenCalledTimes(1);
    expect(cloneProject).toHaveBeenCalledWith("repo", "/tmp/clone");
    // Binding hasil clone dulu (getProject), baru sesi — sesi tanpa checkout pasti 400 needsBind.
    expect(getProject.mock.invocationCallOrder[0]!).toBeLessThan(reverseDocs.mock.invocationCallOrder[0]!);
    expect((await screen.findByTestId("terminal-screen")).textContent).toBe("reverse-repo");
  });

  // AC-3
  it("gagal mulai reverse mempertahankan project + menyediakan pintu ulang, tanpa project ganda", async () => {
    reverseDocs.mockRejectedValue(new FakeApiError(422, "POST /api/terminal/sessions → 422",
      { error: "gagal membuat worktree: not a git repository" }));
    await openNewProjectExisting();
    fireEvent.change(screen.getByPlaceholderText("/path/ke/repo"), { target: { value: "/repo/ada" } });
    fireEvent.click(screen.getByText("Tambah → reverse-engineer docs"));

    await waitFor(() => expect(reverseDocs).toHaveBeenCalledTimes(1));
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/gagal membuat worktree/)).toBeTruthy();
    // Project tetap ada dan mendarat di layar detail, tempat pintu "Reverse docs" jadi retry-nya.
    const retry = await screen.findByText("Reverse docs");

    reverseDocs.mockResolvedValue({ id: "reverse-repo" });
    fireEvent.click(retry);
    await waitFor(() => expect(reverseDocs).toHaveBeenCalledTimes(2));
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  // Retry AC-3 tak terjangkau bila pintunya digerbangi `repoDir` saja: project hasil clone
  // di-bind per-mesin (SPEC-213/217) dan `Project.repoDir`-nya tetap null.
  it("project existing yang hanya punya binding tetap punya pintu Reverse docs", async () => {
    createProject.mockResolvedValue({ ...CREATED, gitRemote: "https://github.com/org/repo.git" });
    reverseDocs.mockRejectedValue(new FakeApiError(422, "POST /api/terminal/sessions → 422",
      { error: "gagal membuat worktree" }));
    await openNewProjectExisting();
    await submitClone();

    await waitFor(() => expect(reverseDocs).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Reverse docs")).toBeTruthy();
  });
});
