import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const PROJECT = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: "/repo/arta",
  binding: null, gitRemote: null, stack: "ts", docStatus: "ok", coverage: 100,
  createdAt: "2026-07-10T00:00:00.000Z", backlog: 1, topStage: "planned", activity: "idle",
  commit: "belum ada commit", session: { status: "idle", phase: null, flow: null },
};

// AutoMergeCard (SPEC-486) self-fetch `listBranches` saat detail project di-mount dan
// membawa tombol "Simpan"-nya sendiri — dua alasan berbeda kenapa berkas ini merah tanpa
// ada hubungannya dengan subjeknya. Ia bukan subjek di sini, jadi di-noop.
vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    // SPEC-884 · App memuat status setup begitu auth diketahui; mock `api` parsial tanpa ini
    // melempar di efek dan terbaca seperti App-nya yang rusak (jebakan yang sama SPEC-739/786).
    setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
      hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
    listProjects: vi.fn(async () => ({ items: [PROJECT], total: 1, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    updateProject: vi.fn(async (_id: string, b: any) => ({ ...PROJECT, ...b })),
    getProject: vi.fn(async () => ({ ...PROJECT, gitRemote: "https://github.com/org/repo.git" })),
    putBinding: vi.fn(async () => ({ repoDir: "/tmp/x" })),
    deleteBinding: vi.fn(async () => {}),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

async function openEdit() {
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByText("Projects")[0]!);
  fireEvent.click(screen.getAllByText("arta")[0]!);
  fireEvent.click(await screen.findByText("Edit project"));
}

describe("edit project git remote (SPEC-218)", () => {
  it("menyimpan gitRemote lewat updateProject", async () => {
    const { api } = await import("../src/api/client");
    await openEdit();
    fireEvent.change(await screen.findByPlaceholderText("https://github.com/org/repo.git"),
      { target: { value: "https://github.com/org/repo.git" } });
    fireEvent.click(screen.getByText("Simpan"));
    await waitFor(() => expect((api.updateProject as any)).toHaveBeenCalledWith("arta",
      expect.objectContaining({ gitRemote: "https://github.com/org/repo.git" })));
  });

  it("detail project menampilkan gitRemote", async () => {
    const { api } = await import("../src/api/client");
    (api.listProjects as any).mockResolvedValueOnce(
      { items: [{ ...PROJECT, gitRemote: "https://github.com/org/repo.git" }], total: 1, page: 1, pageSize: 20 });
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click(screen.getAllByText("arta")[0]!);
    expect(await screen.findByText("Git remote")).toBeInTheDocument();
    expect(await screen.findByText("https://github.com/org/repo.git")).toBeInTheDocument();
  });
});
