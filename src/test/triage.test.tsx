import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const TICKET: any = {
  id: "t1", projectId: "demo", number: 1, category: "bug", title: "Tak bisa login",
  reporterEmail: "r@e.co", status: "new", specId: null, attachmentCount: 0, createdAt: "2026-07-20T00:00:00Z",
};
const DETAIL: any = { ...TICKET, detail: "Detil keluhan", attachments: [], spec: null };

const { listTickets, getTicket, acceptTicket, rejectTicket, editTicket, deleteTicket, unlinkTicket } = vi.hoisted(() => ({
  listTickets: vi.fn(async () => ({ items: [TICKET], total: 1, page: 1, pageSize: 1, unreviewed: 1 })),
  getTicket: vi.fn(async () => DETAIL),
  acceptTicket: vi.fn(async () => ({ spec: { id: "SPEC-300", projectId: "demo" } })),
  rejectTicket: vi.fn(async () => ({ id: "t1", status: "rejected" })),
  editTicket: vi.fn(async () => ({ ...DETAIL, title: "Judul baru" })),
  deleteTicket: vi.fn(async () => ({ ok: true })),
  unlinkTicket: vi.fn(async () => ({ id: "t1", status: "new", specId: null })),
}));
vi.mock("../src/api/client", () => ({
  api: { listTickets, getTicket, acceptTicket, rejectTicket, editTicket, deleteTicket, unlinkTicket },
  ApiError: class extends Error {},
}));
import { TriageScreen } from "../src/screens/TriageScreen";

const projects: any = [{ id: "demo", name: "Demo" }];

describe("SPEC-253 · TriageScreen", () => {
  it("render daftar tiket + badge belum ditinjau", async () => {
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    expect(await screen.findByText("Tak bisa login")).toBeTruthy();
    expect(screen.getByText(/1 belum ditinjau/i)).toBeTruthy(); // badge (bukan opsi filter)
  });

  it("buka detail lalu Terima → memanggil acceptTicket + onAccepted", async () => {
    const onAccepted = vi.fn();
    render(<TriageScreen projects={projects} onAccepted={onAccepted} onToast={() => {}} />);
    fireEvent.click(await screen.findByText("Tak bisa login"));
    await screen.findByText(/Detil keluhan/);
    fireEvent.click(screen.getByRole("button", { name: /terima/i }));
    await waitFor(() => expect(acceptTicket).toHaveBeenCalledWith("t1", "sedang"));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  });

  it("Ubah → ubah judul → Simpan memanggil editTicket (SPEC-269)", async () => {
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByText("Tak bisa login"));
    fireEvent.click(await screen.findByRole("button", { name: /ubah/i }));
    const titleInput = await screen.findByDisplayValue("Tak bisa login");
    fireEvent.change(titleInput, { target: { value: "Judul baru" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(editTicket).toHaveBeenCalledWith("t1", expect.objectContaining({ title: "Judul baru" })));
  });

  it("tiket tertaut → Lepas tautan memanggil unlinkTicket lalu tombol Terima muncul lagi (SPEC-271)", async () => {
    getTicket.mockResolvedValueOnce({ ...DETAIL, specId: "SPEC-300", status: "accepted", spec: { id: "SPEC-300", projectId: "demo" } });
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByText("Tak bisa login"));
    fireEvent.click(await screen.findByRole("button", { name: /lepas tautan/i }));
    await waitFor(() => expect(unlinkTicket).toHaveBeenCalledWith("t1"));
    // status kembali "new" → aksi Terima muncul lagi
    expect(await screen.findByRole("button", { name: /terima/i })).toBeTruthy();
  });

  it("tiket tertaut → status turunan backlog + buka/salin link backlog & publik (SPEC-293)", async () => {
    getTicket.mockResolvedValueOnce({
      ...DETAIL, specId: "SPEC-9", status: "accepted",
      spec: { id: "SPEC-9", projectId: "demo", stage: "executing" },
      publicStatusUrl: "https://h.id/help/demo/status/hnm_shr_ab",
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByText("Tak bisa login"));
    // status turunan backlog (executing → "Sedang dikerjakan")
    expect(await screen.findByText("Sedang dikerjakan")).toBeTruthy();
    // buka backlog di tab baru → URL router /backlog/SPEC-9 (ADR-0160)
    fireEvent.click(screen.getByRole("button", { name: /buka backlog/i }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("/backlog/SPEC-9"), "_blank", "noreferrer");
    // salin link publik → clipboard menerima publicStatusUrl
    fireEvent.click(screen.getByRole("button", { name: /salin link publik/i }));
    expect(writeText).toHaveBeenCalledWith("https://h.id/help/demo/status/hnm_shr_ab");
    // buka status publik di tab baru
    fireEvent.click(screen.getByRole("button", { name: /buka status publik/i }));
    expect(openSpy).toHaveBeenCalledWith("https://h.id/help/demo/status/hnm_shr_ab", "_blank", "noreferrer");
    openSpy.mockRestore();
  });

  it("Hapus → konfirmasi memanggil deleteTicket (SPEC-269)", async () => {
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByText("Tak bisa login"));
    fireEvent.click(await screen.findByRole("button", { name: /hapus/i }));   // tombol aksi → buka modal
    const confirmBtn = screen.getAllByRole("button", { name: /hapus/i }).pop()!;
    fireEvent.click(confirmBtn);                                              // konfirmasi
    await waitFor(() => expect(deleteTicket).toHaveBeenCalledWith("t1"));
  });
});
