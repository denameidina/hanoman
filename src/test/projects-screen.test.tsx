import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-198 · ProjectsScreen: default lewat API (search+paginasi, galat/muat ulang Fase 1); chip aktif
// memakai daftar penuh. Redesign 3P: StatStrip dibuang (hitungan di chip). ADR-0212: urutan perhatian
// dikerjakan server (sort=attention), klien menampilkan urutan balasan apa adanya.
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
// Nama tombol pembuka baris: nama aksesibel DenseRow diawali nama project.
const opener = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}\\b`) });
beforeEach(() => { localStorage.clear(); vi.mocked(api.listProjects).mockReset(); });

describe("ProjectsScreen via API (SPEC-198)", () => {
  it("pembuka baris adalah tombol baris (hn-row-main) yang namanya diawali nama project", () => {
    render(<ProjectsScreen projects={[P()] as never} onOpen={() => {}} />);
    expect(opener("arta")).toHaveClass("hn-row-main");
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

  it("baris memuat nama, jenis + deskripsi, status, dokumen, dan backlog terbuka; hapus ada di ⋯", () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(<ProjectsScreen projects={[P({ desc: "ERP toko", kind: "existing" })] as never}
      onOpen={onOpen} onDelete={onDelete} />);
    const row = opener("arta").closest("li")!;
    expect(row).toHaveClass("hn-row");
    expect(within(row).getByText(/ERP toko/)).toBeInTheDocument();
    expect(within(row).getByText("Repo sudah ada · ERP toko")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText(/terbuka/)).toBeInTheDocument();
    // Hapus bukan tombol baris: ia di menu ⋯, dan klik di dalam menu tak ikut membuka project.
    fireEvent.click(screen.getByRole("button", { name: "Aksi untuk project arta" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Hapus project/ }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(opener("arta"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("daftar memakai RowList (role list), bukan tabel kolom lama", () => {
    render(<ProjectsScreen projects={[P()] as never} onOpen={() => {}} />);
    expect(screen.getByRole("list", { name: "Daftar project" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Ditangani oleh")).toBeNull();   // kolom lama dibuang dari baris
  });

  it("jenis project ditampilkan sebagai label Indonesia, bukan nilai mentah", () => {
    render(<ProjectsScreen projects={[P({ kind: "from-scratch" }), P({ id: "b", name: "beta", kind: "existing" })] as never}
      onOpen={() => {}} />);
    expect(screen.getByText("Dari nol")).toBeInTheDocument();
    expect(screen.getByText("Repo sudah ada")).toBeInTheDocument();
    expect(screen.queryByText("from-scratch")).toBeNull();
  });
});

describe("chip, hitungan, dan urutan perhatian (redesign 3P)", () => {
  const mixed = [
    P({ id: "ok1", name: "ok1", docStatus: "ok" }),
    P({ id: "drift", name: "drift", docStatus: "drift" }),
    P({ id: "run", name: "run", docStatus: "ok", session: { status: "running", phase: "exec", flow: "feature" } }),
    P({ id: "broke", name: "broke", docStatus: "broken" }),
  ];

  it("StatStrip dibuang; chip menampilkan hitungan Semua · Perlu perhatian · Sesi berjalan", () => {
    render(<ProjectsScreen projects={mixed as never} onOpen={() => {}} />);
    expect(screen.queryByText("Sesi berjalan", { selector: "div" })).toBeNull();
    const group = screen.getByRole("group", { name: "Saring project" });
    expect(within(group).getByRole("button", { name: /Semua 4/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: /Perlu perhatian 2/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Sesi berjalan 1/ })).toBeInTheDocument();
  });

  const names = () => screen.getAllByRole("listitem").map((li) => li.querySelector(".hn-prj-name")?.textContent);

  // ADR-0212 · urutan perhatian dikerjakan SERVER (sort=attention, lintas seluruh hasil). Klien tak
  // menyusun ulang: balasan server, dalam urutan apa pun, ditampilkan apa adanya.
  it("urutan baris mengikuti balasan server apa adanya, dan default meminta sort=attention", async () => {
    vi.mocked(api.listProjects).mockResolvedValue(envelope([mixed[0], mixed[2], mixed[1], mixed[3]]));
    render(<ProjectsScreen projects={mixed as never} onOpen={() => {}} pageSize={20} />);
    await waitFor(() => expect(names()).toEqual(["ok1", "run", "drift", "broke"]));
    expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0]).toMatchObject({ sort: "attention" });
    expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0]).not.toHaveProperty("attention", true);
  });

  it("chip 'Perlu perhatian' meminta attention=true dan sort=attention, lalu menampilkan balasan server", async () => {
    vi.mocked(api.listProjects).mockResolvedValue(envelope([mixed[3], mixed[1]]));
    render(<ProjectsScreen projects={mixed as never} onOpen={() => {}} pageSize={20} />);
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Perlu perhatian 2/ }));
    expect(screen.getByRole("button", { name: /Perlu perhatian 2/ })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0])
      .toMatchObject({ sort: "attention", attention: true, page: 1 }));
    await waitFor(() => expect(names()).toEqual(["broke", "drift"]));
  });

  it("chip tanpa hasil memberi empty state yang menawarkan Tampilkan semua", () => {
    const sesat = [P({ id: "ok1", name: "ok1", docStatus: "ok" })];
    render(<ProjectsScreen projects={sesat as never} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Perlu perhatian 0/ }));
    expect(screen.getByText(/Tak ada project “perlu perhatian”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan semua" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("galat & empty state Projects (audit 2026-10)", () => {
  it("galat memuat daftar tampil sebagai blok error dengan Coba lagi, bukan daftar kosong", async () => {
    vi.mocked(api.listProjects)
      .mockRejectedValueOnce(new Error("GET /api/projects → 500"))
      .mockResolvedValueOnce(envelope([P({ id: "arta", name: "arta" })]));
    render(<ProjectsScreen projects={[] as never} pageSize={20} dataVersion={0} onOpen={() => {}} />);
    expect(await screen.findByText("Gagal memuat daftar project")).toBeInTheDocument();
    expect(screen.getByText(/GET \/api\/projects → 500/)).toBeInTheDocument();
    expect(screen.queryByText("Belum ada project")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("button", { name: /^arta\b/ })).toBeInTheDocument();
  });

  it("muat ulang yang gagal tak menghapus data lama — galat tampil di atas baris terakhir", async () => {
    vi.mocked(api.listProjects).mockResolvedValueOnce(envelope([P({ id: "arta", name: "arta" })]));
    const { rerender } = render(<ProjectsScreen projects={[P()] as never} search="" pageSize={20} dataVersion={0} onOpen={() => {}} />);
    expect(await screen.findByRole("button", { name: /^arta\b/ })).toBeInTheDocument();
    vi.mocked(api.listProjects).mockRejectedValueOnce(new Error("jaringan putus"));
    rerender(<ProjectsScreen projects={[P()] as never} search="x" pageSize={20} dataVersion={0} onOpen={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Gagal memuat ulang");
    expect(screen.getByRole("button", { name: /^arta\b/ })).toBeInTheDocument();
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
