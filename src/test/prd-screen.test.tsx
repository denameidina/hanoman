import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    listPrds: vi.fn(async () => ({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false, projectId: "p1", projectName: "P1", status: "draft", specCount: 0, doneCount: 0 },
      { slug: "notifikasi", name: "notifikasi.md", path: "docs/prd/notifikasi.md", title: "Notifikasi Realtime", live: true, projectId: "p1", projectName: "P1", status: "dieskalasi", specCount: 3, doneCount: 1 },
      { slug: "arsip", name: "arsip.md", path: "docs/prd/arsip.md", title: "Arsip Dokumen", live: false, projectId: "p1", projectName: "P1", status: "terwujud", specCount: 2, doneCount: 2 },
    ] })),
    listAllPrds: vi.fn(async () => ({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false, projectId: "p1", projectName: "P1", status: "draft", specCount: 0, doneCount: 0 },
      { slug: "auth", name: "auth.md", path: "docs/prd/auth.md", title: "Auth Device", live: false, projectId: "p2", projectName: "Proyek B", status: "terwujud", specCount: 1, doneCount: 1 },
    ] })),
    getPrd: vi.fn(async () => ({ path: "docs/prd/jadwal-invoice.md", content: "# Jadwal Invoice\n\nRingkasan PRD" })),
    startPrd: vi.fn(),
    // SPEC-273 · default: belum ada manifest breakdown (panel review tak muncul).
    getBreakdown: vi.fn(async () => ({ items: [], live: false })),
    startBreakdown: vi.fn(),
    createSpecsBatch: vi.fn(async () => ({ created: [{ id: "SPEC-300" }, { id: "SPEC-301" }] })),
    // SPEC-361 · pane preview memasang tombol unduh
    prdDownloadUrl: (id: string, p: string, f: string) => `/api/projects/${id}/prds/${p}?download=${f}`,
  },
  ApiError: class extends Error {},
}));
import { PrdScreen } from "../src/screens/PrdScreen";
import { api } from "../src/api/client";

const projects = [{ id: "p1", name: "P1" }, { id: "p2", name: "Proyek B" }] as any;
// SPEC-273 · prop breakdown wajib; default no-op untuk test yang tak memakainya.
const base = { onStartBreakdown: () => {}, onMaterialize: async () => 0 };
beforeEach(() => vi.clearAllMocks());

describe("PrdScreen", () => {
  it("mendaftar PRD dari server", async () => {
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    expect(screen.getByText("Notifikasi Realtime")).toBeTruthy();
    expect(screen.getByText("sesi hidup")).toBeTruthy(); // notifikasi.live (SPEC-520 · ganti kata)
    expect(api.listPrds).toHaveBeenCalledWith("p1");
  });

  it("preview PRD lalu take ke backlog dengan prefill", async () => {
    const onTake = vi.fn();
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={onTake} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    fireEvent.click(screen.getByText("Jadwal Invoice"));
    await waitFor(() => expect(api.getPrd).toHaveBeenCalledWith("p1", "docs/prd/jadwal-invoice.md"));
    // SPEC-407 · tombolnya kini pemilih brief/goal — jalur brief adalah perilaku lama.
    fireEvent.click(await screen.findByRole("button", { name: /take ke backlog/i }));
    fireEvent.click(await screen.findByText("Sebagai feature brief"));
    expect(onTake).toHaveBeenCalledWith(expect.objectContaining({
      project: "p1", title: "Jadwal Invoice", prdPath: "docs/prd/jadwal-invoice.md",
    }));
  });

  it("New PRD: modal punya Select project (default = filter aktif), kirim project itu ke onNewPrd", async () => {
    const onNew = vi.fn();
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={onNew} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy()); // daftar termuat → hanya tombol header
    fireEvent.click(screen.getByRole("button", { name: /prd baru/i }));
    const projectSel = await screen.findByLabelText("Project untuk PRD baru");
    expect((projectSel as HTMLSelectElement).value).toBe("p1"); // default ikut filter aktif
    const title = await screen.findByPlaceholderText(/Jadwal Invoice Berulang/i);
    fireEvent.change(title, { target: { value: "Fitur Baru" } });
    fireEvent.click(screen.getByRole("button", { name: /brainstorm prd/i }));
    expect(onNew).toHaveBeenCalledWith("p1", expect.objectContaining({ title: "Fitur Baru" }));
  });

  it("mode 'Semua project': tombol PRD baru aktif; pilih project di modal tanpa filter list dulu", async () => {
    const onNew = vi.fn();
    render(<PrdScreen projects={projects} {...base} projectFilter="all" onProjectFilter={() => {}} onNewPrd={onNew} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(api.listAllPrds).toHaveBeenCalled());
    const btn = screen.getByRole("button", { name: /prd baru/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false); // tak lagi digate filter "Semua project"
    fireEvent.click(btn);
    const projectSel = await screen.findByLabelText("Project untuk PRD baru");
    fireEvent.change(projectSel, { target: { value: "p2" } }); // pilih project di dalam modal
    const title = await screen.findByPlaceholderText(/Jadwal Invoice Berulang/i);
    fireEvent.change(title, { target: { value: "Fitur Lintas" } });
    fireEvent.click(screen.getByRole("button", { name: /brainstorm prd/i }));
    expect(onNew).toHaveBeenCalledWith("p2", expect.objectContaining({ title: "Fitur Lintas" }));
  });

  it("mode 'Semua project' melist PRD lintas-project dikelompokkan per project", async () => {
    render(<PrdScreen projects={projects} {...base} projectFilter="all" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(api.listAllPrds).toHaveBeenCalled());
    expect(api.listPrds).not.toHaveBeenCalled();
    // item lintas-project
    expect(await screen.findByText("Jadwal Invoice")).toBeTruthy();
    expect(screen.getByText("Auth Device")).toBeTruthy();
    // header grup per project (di sidebar, bukan opsi dropdown yang juga bernama "Proyek B")
    const list = screen.getByLabelText("Daftar PRD");
    expect(within(list).getByText("Proyek B")).toBeTruthy();
  });

  it("mode 'Semua project': preview pakai projectId item, take prefill project item", async () => {
    const onTake = vi.fn();
    render(<PrdScreen projects={projects} {...base} projectFilter="all" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={onTake} />);
    fireEvent.click(await screen.findByText("Auth Device"));
    await waitFor(() => expect(api.getPrd).toHaveBeenCalledWith("p2", "docs/prd/auth.md"));
    fireEvent.click(await screen.findByRole("button", { name: /take ke backlog/i }));
    fireEvent.click(await screen.findByText("Sebagai feature brief"));   // SPEC-407 · lewat pemilih
    expect(onTake).toHaveBeenCalledWith(expect.objectContaining({ project: "p2", prdPath: "docs/prd/auth.md" }));
  });

  // SPEC-273 · breakdown: tombol memulai sesi; manifest yang ada → panel review → materialize.
  it("Breakdown ke backlog memulai sesi breakdown untuk PRD terpilih", async () => {
    const onStart = vi.fn();
    render(<PrdScreen projects={projects} {...base} onStartBreakdown={onStart} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    fireEvent.click(await screen.findByText("Jadwal Invoice"));
    fireEvent.click(await screen.findByRole("button", { name: /breakdown ke backlog/i }));
    expect(onStart).toHaveBeenCalledWith("p1", "docs/prd/jadwal-invoice.md");
  });

  it("manifest ada → panel usulan; Buat N backlog memanggil onMaterialize dgn item terpilih", async () => {
    (api.getBreakdown as any).mockResolvedValue({ live: false, items: [
      { title: "Endpoint jadwal", context: "a", outcome: "oa", priority: "tinggi" },
      { title: "UI daftar", context: "b", outcome: "ob", priority: "sedang" },
    ] });
    const onMat = vi.fn(async () => 2);
    render(<PrdScreen projects={projects} {...base} onMaterialize={onMat} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    fireEvent.click(await screen.findByText("Jadwal Invoice"));
    // panel review muncul + judul usulan
    expect(await screen.findByText("Endpoint jadwal")).toBeTruthy();
    expect(screen.getByText("UI daftar")).toBeTruthy();
    // materialize dua item
    fireEvent.click(screen.getByRole("button", { name: /buat 2 backlog/i }));
    await waitFor(() => expect(onMat).toHaveBeenCalledWith("p1", "docs/prd/jadwal-invoice.md",
      expect.arrayContaining([expect.objectContaining({ title: "Endpoint jadwal" })])));
  });

  // SPEC-520 · status PRD terlihat di daftar, dan kata "draft" tak lagi dipakai lencana live.
  // Assertion di-scope ke <aside aria-label="Daftar PRD">: Select filter merender
  // <option>draft</option> dkk, jadi getByText polos akan cocok GANDA.
  it("lencana status muncul dengan hitungan turunannya", async () => {
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    const list = within(screen.getByLabelText("Daftar PRD"));
    expect(list.getByText("draft")).toBeTruthy();          // specCount 0 → tanpa hitungan
    expect(list.getByText("dieskalasi 1/3")).toBeTruthy();
    expect(list.getByText("terwujud 2/2")).toBeTruthy();
  });

  it("lencana sesi hidup tak lagi berbunyi 'draft hidup'", async () => {
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Notifikasi Realtime")).toBeTruthy());
    expect(screen.getByText("sesi hidup")).toBeTruthy();
    expect(screen.queryByText("draft hidup")).toBeNull();
  });

  it("filter status menyempitkan daftar", async () => {
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Status PRD"), { target: { value: "draft" } });
    await waitFor(() => expect(screen.queryByText("Notifikasi Realtime")).toBeNull());
    expect(screen.getByText("Jadwal Invoice")).toBeTruthy();
    expect(screen.queryByText("Arsip Dokumen")).toBeNull();
  });

  it("filter tanpa hasil memberi empty state yang menyebut statusnya", async () => {
    (api.listPrds as any).mockResolvedValueOnce({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false, projectId: "p1", projectName: "P1", status: "draft", specCount: 0, doneCount: 0 },
    ] });
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Status PRD"), { target: { value: "terwujud" } });
    await waitFor(() => expect(screen.getByText(/berstatus .terwujud./i)).toBeTruthy());
    expect(screen.queryByText("Jadwal Invoice")).toBeNull();
  });
});

// SPEC-407 · ADR-0089 · satu PRD punya DUA jalur ke backlog, dan pilihannya eksplisit: keduanya
// melahirkan sesi berbentuk beda (pipeline perencanaan vs sesi goal dua fase).
describe("PRD → backlog: brief atau goal (SPEC-407)", () => {
  const openPreview = async (onTake: any) => {
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}}
      onNewPrd={() => {}} onTakeToBacklog={onTake} />);
    fireEvent.click(await screen.findByText("Jadwal Invoice"));
    fireEvent.click(await screen.findByText("Take ke backlog"));
  };

  it("pilihan goal mem-prefill kind goal + branch PRD-nya", async () => {
    const onTake = vi.fn();
    await openPreview(onTake);
    fireEvent.click(await screen.findByText("Sebagai goal"));
    await waitFor(() => expect(onTake).toHaveBeenCalledWith(expect.objectContaining({
      kind: "goal", project: "p1", title: "Jadwal Invoice",
      goal: expect.stringContaining("docs/prd/jadwal-invoice.md"),
      branchFrom: "prd/jadwal-invoice",
    })));
  });

  it("pilihan brief mempertahankan perilaku lama", async () => {
    const onTake = vi.fn();
    await openPreview(onTake);
    fireEvent.click(await screen.findByText("Sebagai feature brief"));
    await waitFor(() => expect(onTake).toHaveBeenCalledWith(expect.objectContaining({
      kind: "brief", context: "Dari PRD: docs/prd/jadwal-invoice.md",
      prdPath: "docs/prd/jadwal-invoice.md", branchFrom: "prd/jadwal-invoice",
    })));
  });

  it("membuka pemilih tak langsung memanggil onTake", async () => {
    const onTake = vi.fn();
    await openPreview(onTake);
    expect(onTake).not.toHaveBeenCalled();
  });
});
