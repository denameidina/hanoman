import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-198 · ProjectsScreen: baris via API (search+paginasi), StatStrip dari props penuh.
vi.mock("../src/api/client", () => ({
  api: { listProjects: vi.fn() },
  ApiError: class extends Error {},
}));
import { ProjectsScreen } from "../src/screens/ProjectsScreen";
import { api } from "../src/api/client";
import { uiKey, readUiState, writeUiState } from "../src/ui-state";

const P = (over: Record<string, unknown> = {}) => ({
  id: "arta", name: "arta", desc: "", kind: "existing", stack: "",
  docStatus: "ok", coverage: 90, createdAt: "", backlog: 3, topStage: "execute",
  session: { status: "idle", phase: "", flow: "feature" }, activity: "", commit: "", ...over,
});
const envelope = (items: unknown[]): any => ({ items, total: items.length, page: 1, pageSize: 20 });
beforeEach(() => { localStorage.clear(); vi.mocked(api.listProjects).mockReset(); });

describe("ProjectsScreen via API (SPEC-198)", () => {
  it("marks the project opener as a coarse-pointer touch target", () => {
    render(<ProjectsScreen projects={[P()] as never} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /Buka project/ })).toHaveClass("hn-project-open");
  });
  it("fetch baris dengan q; render item server (bukan prop penuh)", async () => {
    vi.mocked(api.listProjects).mockResolvedValue(envelope([P({ id: "beta", name: "beta" })]));
    const full = [P({ id: "arta", name: "arta" }), P({ id: "gamma", name: "gamma" }), P({ id: "beta", name: "beta" })];
    render(<ProjectsScreen projects={full as never} search="beta" pageSize={20} dataVersion={0} />);
    await waitFor(() => expect(screen.queryByText("gamma")).toBeNull()); // server menyaring
    expect(screen.getByText("beta")).toBeTruthy();
    const params = vi.mocked(api.listProjects).mock.calls.at(-1)![0];
    expect(params).toMatchObject({ q: "beta", page: 1, limit: 20 });
  });

  it("rows kosong + search → empty state 'tidak ada cocok'", async () => {
    vi.mocked(api.listProjects).mockResolvedValue(envelope([]));
    render(<ProjectsScreen projects={[P()] as never} search="zzz" pageSize={20} onClearSearch={() => {}} />);
    expect(await screen.findByText(/Tidak ada project cocok/)).toBeTruthy();
  });

  it("keeps every project field and action reachable in the responsive row", () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(<ProjectsScreen projects={[P({ desc: "ERP toko", kind: "existing", activity: "baru saja" })] as never}
      onOpen={onOpen} onDelete={onDelete} />);
    const open = screen.getByRole("button", { name: "Buka project arta" });
    const row = open.closest(".hn-project-row")!;
    expect(row).toHaveClass("hn-project-row");
    for (const label of ["Project", "Status", "Dokumen", "Backlog", "Aktivitas"]) {
      expect(row.querySelector(`[data-label="${label}"]`)).toBeInTheDocument();
    }
    expect(screen.getByText("ERP toko")).toBeInTheDocument();
    expect(screen.getByText("baru saja")).toBeInTheDocument();
    // Audit 2026-10: hapus tak lagi tombol di baris — ia di menu ⋯, dan klik di dalam menu
    // tak ikut membuka project (Modal menaikkan event lewat pohon React).
    fireEvent.click(screen.getByRole("button", { name: "Aksi untuk project arta" }));
    fireEvent.click(screen.getByRole("button", { name: /Hapus project/ }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("memakai semantik tabel: role table, header columnheader, baris row", () => {
    render(<ProjectsScreen projects={[P()] as never} onOpen={() => {}} />);
    expect(screen.getByRole("table", { name: "Daftar project" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.getAllByRole("row")).toHaveLength(2);   // header + satu project
  });

  it("kind enum ditampilkan sebagai label Indonesia, bukan nilai mentah", () => {
    render(<ProjectsScreen projects={[P({ kind: "from-scratch" }), P({ id: "b", name: "beta", kind: "existing" })] as never}
      onOpen={() => {}} />);
    expect(screen.getByText("Dari nol")).toBeInTheDocument();
    expect(screen.getByText("Repo sudah ada")).toBeInTheDocument();
    expect(screen.queryByText("from-scratch")).toBeNull();
  });
});

describe("galat & empty state Projects (audit 2026-10)", () => {
  it("galat memuat daftar tampil sebagai blok error dengan Coba lagi, bukan daftar kosong", async () => {
    vi.mocked(api.listProjects)
      .mockRejectedValueOnce(new Error("GET /api/projects → 500"))
      .mockResolvedValueOnce(envelope([P({ id: "arta", name: "arta" })]));
    render(<ProjectsScreen projects={[] as never} pageSize={20} dataVersion={0} />);
    expect(await screen.findByText("Gagal memuat daftar project")).toBeInTheDocument();
    expect(screen.getByText(/GET \/api\/projects → 500/)).toBeInTheDocument();
    expect(screen.queryByText("Belum ada project")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("button", { name: "Buka project arta" })).toBeInTheDocument();
  });

  it("muat ulang yang gagal tak menghapus data lama — galat tampil di atas baris terakhir", async () => {
    vi.mocked(api.listProjects).mockResolvedValueOnce(envelope([P({ id: "arta", name: "arta" })]));
    const { rerender } = render(<ProjectsScreen projects={[P()] as never} search="" pageSize={20} dataVersion={0} />);
    expect(await screen.findByRole("button", { name: "Buka project arta" })).toBeInTheDocument();
    vi.mocked(api.listProjects).mockRejectedValueOnce(new Error("jaringan putus"));
    rerender(<ProjectsScreen projects={[P()] as never} search="x" pageSize={20} dataVersion={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Gagal memuat ulang");
    expect(screen.getByRole("button", { name: "Buka project arta" })).toBeInTheDocument();
  });

  it("filter Ditangani oleh yang menyaring habis → pesan dan Reset filter", async () => {
    writeUiState(uiKey("projects", "handledBy"), "d9");
    vi.mocked(api.listProjects).mockResolvedValue(envelope([]));
    render(<ProjectsScreen projects={[P()] as never} pageSize={20} dataVersion={0} />);
    expect(await screen.findByText("Tak ada project yang ditangani perangkat ini")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    await waitFor(() => expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0])
      .toMatchObject({ handledBy: undefined, page: 1 }));
  });

  it("halaman yang sudah habis → kembali ke halaman 1", async () => {
    writeUiState(uiKey("projects", "page"), 3);
    vi.mocked(api.listProjects).mockResolvedValue({ items: [], total: 5, page: 3, pageSize: 20 } as never);
    render(<ProjectsScreen projects={[P()] as never} pageSize={20} dataVersion={0} />);
    expect(await screen.findByText("Halaman ini sudah kosong")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kembali ke halaman 1" }));
    await waitFor(() => expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0]).toMatchObject({ page: 1 }));
  });
});

describe("state tampilan Projects (SPEC-740 · ADR-0115)", () => {
  it("nomor halaman bertahan lintas remount — mount bukan ganti penyaring", async () => {
    vi.mocked(api.listProjects).mockResolvedValue(envelope([P()]));
    writeUiState(uiKey("projects", "page"), 2);
    render(<ProjectsScreen projects={[P()] as never} search="" pageSize={20} dataVersion={0} />);
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0]).toMatchObject({ page: 2 });
    expect(readUiState(uiKey("projects", "page"), 1)).toBe(2);
  });

  it("ganti pencarian TETAP mengembalikan daftar ke halaman 1 (AC-15)", async () => {
    vi.mocked(api.listProjects).mockResolvedValue(envelope([P()]));
    writeUiState(uiKey("projects", "page"), 2);
    const { rerender } = render(
      <ProjectsScreen projects={[P()] as never} search="" pageSize={20} dataVersion={0} />);
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    rerender(<ProjectsScreen projects={[P()] as never} search="beta" pageSize={20} dataVersion={0} />);
    await waitFor(() =>
      expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0]).toMatchObject({ q: "beta", page: 1 }));
  });
});
