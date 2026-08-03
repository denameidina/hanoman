import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const PROJECT = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: "/repo/arta",
  binding: null, repoUrl: null, stack: "ts", docStatus: "ok", coverage: 100, createdAt: "2026-07-10T00:00:00.000Z",
  backlog: 1, topStage: "planned", activity: "idle", commit: "belum ada commit",
  session: { status: "idle", phase: null, flow: null },
};

// AutoMergeCard (SPEC-486) self-fetch `listBranches` saat detail project di-mount dan
// membawa tombol "Simpan"-nya sendiri — dua alasan berbeda kenapa berkas ini merah tanpa
// ada hubungannya dengan subjeknya. Ia bukan subjek di sini, jadi di-noop.
vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => ({ items: [PROJECT], total: 1, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    updateProject: vi.fn(async (_id: string, b: { name?: string }) => ({ ...PROJECT, ...b })),
    getProject: vi.fn(async () => ({ ...PROJECT, binding: "/tmp/x" })),
    putBinding: vi.fn(async () => ({ repoDir: "/tmp/x" })),
    deleteBinding: vi.fn(async () => {}),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

describe("detail project (SPEC-146)", () => {
  it("klik baris project membuka detail project, bukan Docs", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);   // sidebar
    fireEvent.click(screen.getAllByText("arta")[0]!);       // baris project
    // Layar detail punya "Edit project"; layar Docs punya tombol "Muat ulang" (rescan tree,
    // unik untuk DocsWorkspace — "Source of Truth" sendiri juga jadi label pintu di detail).
    expect(await screen.findByText("Edit project")).toBeInTheDocument();
    expect(screen.queryByText("Muat ulang")).toBeNull();
  });

  it("edit project bisa menyetel path per-mesin (binding)", async () => {
    const { api } = await import("../src/api/client");
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click(screen.getAllByText("arta")[0]!);
    fireEvent.click(await screen.findByText("Edit project"));
    const input = await screen.findByPlaceholderText("/path/ke/repo (mesin ini)");
    fireEvent.change(input, { target: { value: "/tmp/x" } });
    fireEvent.click(screen.getByText("Simpan"));
    await act(async () => { await Promise.resolve(); });
    expect((api.putBinding as any)).toHaveBeenCalledWith("arta", "/tmp/x");
  });

  it("tombol terminal di detail membuka layar Terminal", async () => {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click(screen.getAllByText("arta")[0]!);
    fireEvent.click(await screen.findByText("Buka terminal"));
    expect(await screen.findByText("Belum ada sesi terminal")).toBeInTheDocument();
  });
});
