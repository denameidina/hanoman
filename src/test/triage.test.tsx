import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockViewport, resetViewport } from "./viewport";

const TICKET: any = {
  id: "t1", projectId: "demo", number: 1, category: "bug", title: "Tak bisa login",
  reporterEmail: "r@e.co", status: "new", specId: null, attachmentCount: 0, createdAt: "2026-07-20T00:00:00Z",
};
const DETAIL: any = { ...TICKET, detail: "Detil keluhan", attachments: [], spec: null };
const defaultList = async () => ({ items: [TICKET], total: 1, page: 1, pageSize: 1, unreviewed: 1 });

const { listTickets, getTicket, acceptTicket, rejectTicket, editTicket, deleteTicket, unlinkTicket, listGithubIssues } = vi.hoisted(() => ({
  listTickets: vi.fn(),
  getTicket: vi.fn(async () => DETAIL),
  acceptTicket: vi.fn(async () => ({ spec: { id: "SPEC-300", projectId: "demo" } })),
  rejectTicket: vi.fn(async () => ({ id: "t1", status: "rejected" })),
  editTicket: vi.fn(async () => ({ ...DETAIL, title: "Judul baru" })),
  deleteTicket: vi.fn(async () => ({ ok: true })),
  unlinkTicket: vi.fn(async () => ({ id: "t1", status: "new", specId: null })),
  listGithubIssues: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
}));
vi.mock("../src/api/client", () => ({
  api: { listTickets, getTicket, acceptTicket, rejectTicket, editTicket, deleteTicket, unlinkTicket, listGithubIssues },
  ApiError: class extends Error {},
}));
import { TriageScreen } from "../src/screens/TriageScreen";

const projects: any = [{ id: "demo", name: "Demo" }];
const renderTriage = (onToast = vi.fn()) => render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={onToast} />);
// Aksi sekunder (Edit, Hapus, salin/lepas tautan) ada di menu ⋯ "Aksi lainnya" pada detail tiket.
async function pickMenu(item: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: "Aksi lainnya" }));
  fireEvent.click(screen.getByRole("button", { name: item }));
}

beforeEach(() => {
  localStorage.clear();
  listTickets.mockReset();
  listTickets.mockImplementation(defaultList);
  getTicket.mockClear();
  editTicket.mockClear();
  rejectTicket.mockClear();
  acceptTicket.mockClear();
  deleteTicket.mockClear();
  unlinkTicket.mockClear();
});
afterEach(() => resetViewport());

describe("SPEC-253 · TriageScreen", () => {
  it("render kotak masuk: segmented 'Belum ditinjau' dengan jumlah, dan baris tiket", async () => {
    renderTriage();
    expect(await screen.findByText("Tak bisa login")).toBeTruthy();
    const segment = within(screen.getByRole("group", { name: "Status keluhan dan issue" }));
    expect(segment.getByRole("button", { name: /Belum ditinjau/ }).getAttribute("aria-pressed")).toBe("true");
    expect(segment.getByRole("button", { name: /Belum ditinjau/ })).toHaveTextContent("1");
  });

  it("checkbox pilih dibungkus <label> (kotak sentuh ikut memilih) dan judul memakai kelas baris", async () => {
    renderTriage();
    await screen.findByText("Tak bisa login");
    const box = screen.getByRole("checkbox", { name: "Pilih tiket 1" });
    expect(box.closest("label")?.classList.contains("hn-triage-check")).toBe(true);
    expect(screen.getByText("Tak bisa login").classList.contains("hn-triage-title")).toBe(true);
  });

  it("buka detail lalu Terima → memanggil acceptTicket + onAccepted (perilaku detail: ke backlog)", async () => {
    const onAccepted = vi.fn();
    render(<TriageScreen projects={projects} onAccepted={onAccepted} onToast={() => {}} />);
    fireEvent.click(await screen.findByText("Tak bisa login"));
    await screen.findByText(/Detil keluhan/);
    fireEvent.click(screen.getByRole("button", { name: "Terima → backlog" }));
    await waitFor(() => expect(acceptTicket).toHaveBeenCalledWith("t1", "sedang"));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  });

  it("Terima inline pada baris tetap di kotak masuk: tak memanggil onAccepted, memberi toast", async () => {
    const onAccepted = vi.fn();
    const onToast = vi.fn();
    render(<TriageScreen projects={projects} onAccepted={onAccepted} onToast={onToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "Terima tiket 1" }));
    await waitFor(() => expect(acceptTicket).toHaveBeenCalledWith("t1", "sedang"));
    expect(await screen.findByText("Diterima → SPEC-300")).toBeTruthy();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("Edit → ubah judul → Simpan memanggil editTicket (SPEC-269)", async () => {
    renderTriage();
    fireEvent.click(await screen.findByText("Tak bisa login"));
    await pickMenu(/^edit$/i);
    const titleInput = await screen.findByDisplayValue("Tak bisa login");
    fireEvent.change(titleInput, { target: { value: "Judul baru" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(editTicket).toHaveBeenCalledWith("t1", expect.objectContaining({ title: "Judul baru" })));
  });

  it("judul kosong: Simpan nonaktif; Batal dengan isian kotor meminta konfirmasi dulu", async () => {
    renderTriage();
    fireEvent.click(await screen.findByText("Tak bisa login"));
    await pickMenu(/^edit$/i);
    const titleInput = await screen.findByDisplayValue("Tak bisa login");
    fireEvent.change(titleInput, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: /simpan/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(titleInput, { target: { value: "Judul lain" } });
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Perubahan pada tiket ini belum disimpan.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));   // tetap di mode edit
    expect(await screen.findByDisplayValue("Judul lain")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Buang perubahan" }));
    expect(await screen.findByRole("heading", { name: "Tak bisa login" })).toBeTruthy();
    expect(editTicket).not.toHaveBeenCalled();
  });

  it("tiket tertaut → Lepas tautan memanggil unlinkTicket lalu Terima → backlog muncul lagi (SPEC-271)", async () => {
    getTicket.mockResolvedValueOnce({ ...DETAIL, specId: "SPEC-300", status: "accepted", spec: { id: "SPEC-300", projectId: "demo" } });
    renderTriage();
    fireEvent.click(await screen.findByText("Tak bisa login"));
    await pickMenu(/lepas tautan/i);
    await waitFor(() => expect(unlinkTicket).toHaveBeenCalledWith("t1"));
    // status kembali "new" → aksi Terima muncul lagi di detail
    expect(await screen.findByRole("button", { name: "Terima → backlog" })).toBeTruthy();
  });

  it("tiket tertaut → status turunan backlog + buka backlog utama; salin & buka link publik lewat menu (SPEC-293)", async () => {
    getTicket.mockResolvedValueOnce({
      ...DETAIL, specId: "SPEC-9", status: "accepted",
      spec: { id: "SPEC-9", projectId: "demo", stage: "executing" },
      publicStatusUrl: "https://h.id/help/demo/status/hnm_shr_ab",
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    renderTriage();
    fireEvent.click(await screen.findByText("Tak bisa login"));
    // status turunan backlog (executing → "Sedang dikerjakan")
    expect(await screen.findByText("Sedang dikerjakan")).toBeTruthy();
    // buka backlog di tab baru → URL router /backlog/SPEC-9 (ADR-0160)
    fireEvent.click(screen.getByRole("button", { name: /buka backlog/i }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("/backlog/SPEC-9"), "_blank", "noreferrer");
    // salin link publik → clipboard menerima publicStatusUrl
    await pickMenu(/salin link publik/i);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://h.id/help/demo/status/hnm_shr_ab"));
    // buka status publik di tab baru
    await pickMenu(/buka status publik/i);
    expect(openSpy).toHaveBeenCalledWith("https://h.id/help/demo/status/hnm_shr_ab", "_blank", "noreferrer");
    openSpy.mockRestore();
  });

  it("salin link gagal → toast galat, bukan toast 'disalin'", async () => {
    getTicket.mockResolvedValueOnce({
      ...DETAIL, specId: "SPEC-9", status: "accepted", spec: { id: "SPEC-9", projectId: "demo", stage: "executing" },
      publicStatusUrl: "https://h.id/s/1",
    });
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error("ditolak browser"); }) } });
    const onToast = vi.fn();
    renderTriage(onToast);
    fireEvent.click(await screen.findByText("Tak bisa login"));
    await pickMenu(/salin link publik/i);
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Gagal menyalin link: ditolak browser", "err", "x-circle"));
    expect(onToast).not.toHaveBeenCalledWith("Link publik disalin", "ok", "copy");
  });

  it("Hapus → konfirmasi memanggil deleteTicket (SPEC-269)", async () => {
    renderTriage();
    fireEvent.click(await screen.findByText("Tak bisa login"));
    await pickMenu(/^hapus$/i);
    const confirmBtn = (await screen.findAllByRole("button", { name: /hapus/i })).pop()!;
    fireEvent.click(confirmBtn);                                              // konfirmasi
    await waitFor(() => expect(deleteTicket).toHaveBeenCalledWith("t1"));
  });

  // Tolak tiket = langsung (tanpa dialog) dengan toast "Urungkan" 6 dtk yang mengembalikan status.
  it("Tolak langsung menolak tiket dan toast 'Urungkan' mengembalikan status ke belum ditinjau", async () => {
    renderTriage();
    fireEvent.click(await screen.findByText("Tak bisa login"));
    fireEvent.click(await screen.findByRole("button", { name: "Tolak" }));
    await waitFor(() => expect(rejectTicket).toHaveBeenCalledWith("t1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Urungkan" }));
    await waitFor(() => expect(editTicket).toHaveBeenCalledWith("t1", { status: "new" }));
  });

  it("tombol Tolak pada baris juga langsung dengan Urungkan", async () => {
    renderTriage();
    fireEvent.click(await screen.findByRole("button", { name: "Tolak tiket 1" }));
    await waitFor(() => expect(rejectTicket).toHaveBeenCalledWith("t1"));
    expect(await screen.findByRole("button", { name: "Urungkan" })).toBeTruthy();
  });

  it("di layar sempit Escape kembali dari detail ke daftar", async () => {
    mockViewport(375);
    renderTriage();
    fireEvent.click(await screen.findByText("Tak bisa login"));
    expect(await screen.findByRole("heading", { name: "Tak bisa login" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Tak bisa login" })).toBeNull());
  });

  // Pintasan keyboard: J membuka baris pertama, lalu A menerima (tetap di kotak masuk).
  it("pintasan keyboard di daftar: J membuka baris, A menerima yang belum ditinjau", async () => {
    renderTriage();
    const list = await screen.findByRole("list", { name: "Keluhan dan issue" });
    fireEvent.keyDown(list, { key: "j" });
    expect(await screen.findByRole("heading", { name: "Tak bisa login" })).toBeTruthy();
    fireEvent.keyDown(list, { key: "a" });
    await waitFor(() => expect(acceptTicket).toHaveBeenCalledWith("t1", "sedang"));
  });

  // Pintasan tak aktif saat fokus di kolom isian.
  it("tombol huruf di dalam kolom cari tak memicu pintasan", async () => {
    renderTriage();
    const box = await screen.findByLabelText("Cari tiket");
    fireEvent.keyDown(box, { key: "a" });
    expect(acceptTicket).not.toHaveBeenCalled();
  });

  it("pencarian tanpa hasil menyebut 'Tak ada yang cocok' dan menawarkan Reset, bukan 'Belum ada keluhan'", async () => {
    listTickets.mockImplementation(async () => ({ items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 }));
    localStorage.setItem("hn.ui.v1.triage.q", JSON.stringify("zzz"));
    renderTriage();
    expect(await screen.findByText("Tak ada yang cocok")).toBeTruthy();
    expect(screen.queryByText("Belum ada keluhan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset penyaring" }));
    await waitFor(() => expect((screen.getByLabelText("Cari tiket") as HTMLInputElement).value).toBe(""));
    expect(await screen.findByText("Belum ada keluhan")).toBeTruthy();
  });

  it("segmented Diterima menyaring status=accepted", async () => {
    renderTriage();
    await screen.findByText("Tak bisa login");
    fireEvent.click(screen.getByRole("button", { name: /^Diterima/ }));
    await waitFor(() => expect(listTickets).toHaveBeenLastCalledWith(expect.objectContaining({ status: "accepted" })));
    expect(screen.getByRole("button", { name: /^Diterima/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("waktu baru saja ditulis 'baru saja' tanpa 'lalu' ganda", async () => {
    listTickets.mockImplementation(async () => ({ items: [{ ...TICKET, createdAt: new Date().toISOString() }], total: 1, page: 1, pageSize: 20, unreviewed: 0 }));
    renderTriage();
    expect(await screen.findByText(/baru saja$/)).toBeTruthy();
    expect(screen.queryByText(/baru saja lalu/)).toBeNull();
  });
});
