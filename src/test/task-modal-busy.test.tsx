import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Audit UI/UX 2026-10 · TaskModal: selama mutasi berjalan, Escape / overlay / tombol tutup mati.
const api = vi.hoisted(() => ({ createTask: vi.fn(), patchTask: vi.fn(), deleteTask: vi.fn() }));
vi.mock("../src/api/client", () => ({ api }));
import { TaskModal } from "../src/screens/TaskModal";

const props = () => ({
  open: true, task: null, projects: [] as never[], members: [] as never[], defaultProjectId: null,
  orderFor: () => 0, onClose: vi.fn(), onSaved: vi.fn(), onToast: vi.fn(),
});

const existing = {
  id: "T-1", title: "Rapikan halaman harga", detail: null, projectId: null, status: "backlog",
  priority: "sedang", memberId: null, startDate: null, dueDate: null,
} as never;

describe("TaskModal · tak bisa ditutup selama mutasi", () => {
  it("selama menyimpan, Escape, klik overlay, dan tombol tutup tak menutup modal", async () => {
    let finish!: () => void;
    api.createTask.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const p = props();
    render(<TaskModal {...p} />);
    fireEvent.change(screen.getByLabelText("Judul tugas"), { target: { value: "Rapikan halaman" } });
    fireEvent.click(screen.getByRole("button", { name: "Buat tugas" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledOnce());

    fireEvent.keyDown(screen.getByLabelText("Judul tugas"), { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-panel").parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Batal" })).toBeDisabled();

    finish();
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onToast).toHaveBeenCalledWith("Tugas dibuat", "ok", "check");
  });

  it("Escape menutup modal saat tak ada mutasi berjalan", () => {
    const p = props();
    render(<TaskModal {...p} />);
    fireEvent.keyDown(screen.getByLabelText("Judul tugas"), { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledOnce();
  });
});

describe("TaskModal · hapus tugas", () => {
  it("hapus lewat konfirmasi; galat ditoast dengan alasannya dan modal tetap terbuka", async () => {
    api.deleteTask.mockRejectedValueOnce(new Error("jaringan putus"));
    const p = props();
    render(<TaskModal {...p} task={existing} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    // Dua dialog terbuka (modal tugas + konfirmasi); konfirmasi dirender terakhir, jadi itu yang ambil.
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    const dialog = within(screen.getAllByRole("dialog").at(-1)!);
    expect(dialog.getByText("Kartu ini hilang dari papan di semua device yang tersinkron.")).toBeTruthy();
    expect(api.deleteTask).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Hapus tugas" }));
    await waitFor(() =>
      expect(p.onToast).toHaveBeenCalledWith("Gagal menghapus tugas: jaringan putus", "err", "x-circle"));
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Ubah tugas")).toBeTruthy();
  });

  it("hapus berhasil: tugas dihapus, daftar dimuat ulang, modal tutup", async () => {
    api.deleteTask.mockResolvedValueOnce(undefined);
    const p = props();
    render(<TaskModal {...p} task={existing} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name: "Hapus tugas" }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(api.deleteTask).toHaveBeenCalledWith("T-1");
    expect(p.onSaved).toHaveBeenCalledOnce();
    expect(p.onToast).toHaveBeenCalledWith("Tugas dihapus", "ok", "trash-2");
  });
});
