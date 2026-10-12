// Audit UI/UX 2026-10 · slot aksi layar Source of Truth (App.tsx, section "docs"). Pemilih project
// punya nama aksesibel, dan "Hapus project" tak lagi tombol berdampingan dengan pemilih: ia pindah ke
// menu aksi (OverflowActions, tone danger) dan tetap lewat konfirmasi useConfirm.
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const PROJECT = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: "/repo/arta",
  binding: null, repoUrl: null, stack: "ts", docStatus: "ok", coverage: 100, createdAt: "2026-07-10T00:00:00.000Z",
  backlog: 1, topStage: "planned", activity: "idle", commit: "belum ada commit",
  session: { status: "idle", phase: null, flow: null },
};
const SECOND = { ...PROJECT, id: "beta", name: "beta" };

// AutoMergeCard self-fetch `listBranches`; bukan subjek berkas ini (pola project-detail.test.tsx).
vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));
const { deleteProject } = vi.hoisted(() => ({ deleteProject: vi.fn(async () => ({ ok: true })) }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
      hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
    listProjects: vi.fn(async () => ({ items: [PROJECT, SECOND], total: 2, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    getDocs: vi.fn(async () => ({ coverage: 100, tree: [] })),
    getDoc: vi.fn(async () => ({ path: "x.md", content: "# x" })),
    deleteProject,
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

beforeEach(() => {
  localStorage.clear();
  deleteProject.mockClear();
  window.history.replaceState(null, "", "/docs");
});

describe("Source of Truth · slot aksi (App.tsx)", () => {
  it("pemilih project di /docs punya nama aksesibel 'Pilih project'", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    const picker = await screen.findByRole("combobox", { name: "Pilih project" });
    expect(picker).toBeInTheDocument();
  });

  it("'Hapus project' tak lagi tombol di slot aksi; ia ada di menu Aksi dan minta konfirmasi dulu", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    await screen.findByRole("combobox", { name: "Pilih project" });
    expect(screen.queryByRole("button", { name: "Hapus project" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Aksi untuk project / }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Hapus project/ }));

    expect(await screen.findByText(/Hapus project ".+"\?/)).toBeTruthy();
    expect(deleteProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteProject).not.toHaveBeenCalled();
  });
});
