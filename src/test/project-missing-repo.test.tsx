import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Project dari sync hub: repoDir TAK PERNAH menyeberang (services/sync.ts), jadi keduanya null.
const NO_DIR = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: null,
  binding: null, gitRemote: "https://github.com/org/arta.git", stack: "", docStatus: "broken",
  coverage: 0, createdAt: "2026-08-01T00:00:00.000Z", backlog: 0, topStage: "spec",
  activity: "idle", commit: "belum ada commit", session: { status: "idle", phase: null, flow: null },
};
const CLONED = { ...NO_DIR, binding: "/home/dena/code/arta" };

vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));
const { state } = vi.hoisted(() => ({ state: { project: null as any } }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    // SPEC-884 · App memuat status setup begitu auth diketahui; mock `api` parsial tanpa ini
    // melempar di efek dan terbaca seperti App-nya yang rusak (jebakan yang sama SPEC-739/786).
    setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
      hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
    listProjects: vi.fn(async () => ({ items: [state.project], total: 1, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    getProject: vi.fn(async () => CLONED),
    cloneProject: vi.fn(async () => ({ repoDir: "/home/dena/code/arta" })),
    putBinding: vi.fn(async () => ({ repoDir: "/home/dena/code/arta" })),
    browseFs: vi.fn(async (path?: string) => ({
      path: path ?? "/home/dena", parent: "/home",
      entries: [{ name: "code", path: `${path ?? "/home/dena"}/code` }],
    })),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

async function openDetail(project: any) {
  state.project = project;
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByText("Projects")[0]!);
  fireEvent.click((await screen.findAllByText(project.name))[0]!);
}

describe("project tanpa dir lokal (SPEC-867)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("menampilkan keadaan tanpa-dir beserta dua jalan keluarnya", async () => {
    await openDetail(NO_DIR);
    expect(await screen.findByText("Belum ada checkout di mesin ini")).toBeInTheDocument();
    expect(screen.getByText("Clone dari git remote")).toBeInTheDocument();
    expect(screen.getByText("Pilih folder di device")).toBeInTheDocument();
  });

  it("tak muncul saat project sudah punya checkout", async () => {
    await openDetail(CLONED);
    expect(await screen.findByText("Edit project")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada checkout di mesin ini")).toBeNull();
  });

  it("clone memakai folder pilihan sebagai INDUK lalu menyegarkan project", async () => {
    const { api } = await import("../src/api/client");
    await openDetail(NO_DIR);
    fireEvent.click(await screen.findByText("Clone dari git remote"));
    fireEvent.click(await screen.findByText("Pilih folder"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("code"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalledWith("/home/dena/code"));
    fireEvent.click(screen.getByText("Pilih folder ini"));
    expect((await screen.findByPlaceholderText("/path/ke/arta") as HTMLInputElement).value)
      .toBe("/home/dena/code/arta");
    fireEvent.click(screen.getByText("Clone"));
    // SPEC-847 · ADR-0127 · clone menulis ke disk → dikonfirmasi, dan dialognya menyebut targetnya.
    expect(await screen.findByText("Jalankan git clone di mesin ini?")).toBeInTheDocument();
    expect(screen.getAllByText("/home/dena/code/arta").length).toBeGreaterThan(0);
    expect((api.cloneProject as any)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Jalankan git clone"));
    await waitFor(() => expect((api.cloneProject as any))
      .toHaveBeenCalledWith("arta", "/home/dena/code/arta"));
    await waitFor(() => expect((api.getProject as any)).toHaveBeenCalledWith("arta"));
  });

  it("membatalkan konfirmasi tak menyentuh disk sama sekali", async () => {
    const { api } = await import("../src/api/client");
    await openDetail(NO_DIR);
    fireEvent.click(await screen.findByText("Clone dari git remote"));
    fireEvent.change(await screen.findByPlaceholderText("/path/ke/arta"),
      { target: { value: "/home/dena/code/arta" } });
    fireEvent.click(screen.getByText("Clone"));
    fireEvent.click(await screen.findByText("Batal"));
    await waitFor(() => expect(screen.queryByText("Jalankan git clone di mesin ini?")).toBeNull());
    expect((api.cloneProject as any)).not.toHaveBeenCalled();
    // Modal clone tetap terbuka dengan path yang sudah diisi — membatalkan bukan menutup pekerjaan.
    expect((screen.getByPlaceholderText("/path/ke/arta") as HTMLInputElement).value)
      .toBe("/home/dena/code/arta");
  });

  it("clone gagal menampilkan stderr endpoint, project tetap ada, dan bisa dicoba ulang", async () => {
    const { api } = await import("../src/api/client");
    (api.cloneProject as any).mockRejectedValueOnce(Object.assign(
      new Error("POST /api/projects/arta/clone → 409"),
      { detail: { error: "git clone gagal", detail: "fatal: repository 'x' not found" } }));
    await openDetail(NO_DIR);
    fireEvent.click(await screen.findByText("Clone dari git remote"));
    fireEvent.change(await screen.findByPlaceholderText("/path/ke/arta"),
      { target: { value: "/home/dena/code/arta" } });
    fireEvent.click(screen.getByText("Clone"));
    fireEvent.click(await screen.findByText("Jalankan git clone"));
    expect(await screen.findByText("git clone gagal")).toBeInTheDocument();
    expect(screen.getByText(/repository 'x' not found/)).toBeInTheDocument();
    expect(screen.getAllByText("arta").length).toBeGreaterThan(0);   // project tak terhapus
    // Dialog konfirmasi ikut tertutup oleh kegagalan — percobaan kedua dikonfirmasi ulang.
    fireEvent.click(screen.getByText("Coba lagi"));
    fireEvent.click(await screen.findByText("Jalankan git clone"));
    await waitFor(() => expect((api.cloneProject as any)).toHaveBeenCalledTimes(2));
  });

  it("tanpa gitRemote: tak menawarkan clone, mengantar mengisi remote", async () => {
    await openDetail({ ...NO_DIR, gitRemote: null });
    expect(await screen.findByText("Belum ada checkout di mesin ini")).toBeInTheDocument();
    expect(screen.queryByText("Clone dari git remote")).toBeNull();
    fireEvent.click(screen.getByText("Isi git remote"));
    expect(await screen.findByPlaceholderText("https://github.com/org/repo.git")).toBeInTheDocument();
  });

  it("pilih folder di device menyimpan binding lalu menyegarkan project", async () => {
    const { api } = await import("../src/api/client");
    await openDetail(NO_DIR);
    fireEvent.click(await screen.findByText("Pilih folder di device"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("code"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalledWith("/home/dena/code"));
    fireEvent.click(screen.getByText("Pilih folder ini"));
    await waitFor(() => expect((api.putBinding as any)).toHaveBeenCalledWith("arta", "/home/dena/code"));
    await waitFor(() => expect((api.getProject as any)).toHaveBeenCalledWith("arta"));
  });
});
