import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

// Audit UI/UX 2026-10 · P0: hapus spec tak lagi langsung menghapus. Dialog menyebut ID & judul,
// dampaknya sebagai daftar, dan label aksinya eksplisit — bukan "OK".
const spec = {
  id: "SPEC-7", projectId: "p1", title: "Judul spec tujuh", source: "brief", stage: "brainstorming",
  priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
} as unknown as Spec;

function renderWith(onDelete: (s: Spec) => unknown, onToast = vi.fn()) {
  render(<BacklogScreen backlog={[spec]} projects={[{ id: "p1", name: "Proyek Satu" }] as never}
    projectFilter="all" onProjectFilter={() => {}} onDelete={onDelete as never} onToast={onToast} />);
  return onToast;
}

// Hapus kini aksi sekunder di menu ⋯ kartu, bukan tombol sejajar.
const openDeleteFromMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: "Aksi lain SPEC-7" }));
  fireEvent.click(screen.getByRole("button", { name: "Hapus spec" }));
};

describe("hapus spec wajib konfirmasi (audit UI/UX · P0)", () => {
  it("menu → dialog menyebut ID, judul, dan dampak; onDelete belum dipanggil", async () => {
    const onDelete = vi.fn(async () => {});
    renderWith(onDelete);
    openDeleteFromMenu();
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Hapus SPEC-7?")).toBeTruthy();
    expect(dialog.getByText(/"Judul spec tujuh" dihapus dari backlog Proyek Satu\./)).toBeTruthy();
    expect(dialog.getByText("Tindakan ini tidak bisa dibatalkan.")).toBeTruthy();
    expect(dialog.getByText("Lampiran item ini ikut dihapus dari disk.")).toBeTruthy();
    expect(dialog.getByText("Sesi yang masih berjalan untuk item ini tidak ikut dihentikan.")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("Batal tak menghapus apa pun", async () => {
    const onDelete = vi.fn(async () => {});
    renderWith(onDelete);
    openDeleteFromMenu();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("'Hapus spec' di dialog memanggil onDelete dengan spec-nya lalu menutup dialog", async () => {
    const onDelete = vi.fn(async (_s: Spec) => {});
    renderWith(onDelete);
    openDeleteFromMenu();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Hapus spec" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    expect(onDelete.mock.calls[0]![0].id).toBe("SPEC-7");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("galat hapus ditoast dengan APA yang gagal dan alasannya", async () => {
    const onDelete = vi.fn(async () => { throw new Error("404 not found"); });
    const onToast = renderWith(onDelete);
    openDeleteFromMenu();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Hapus spec" }));
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith("Gagal menghapus SPEC-7: 404 not found", "err", "x-circle"));
  });
});
