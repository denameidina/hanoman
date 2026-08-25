import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemberView } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    listMembers: vi.fn(), createMember: vi.fn(), patchMember: vi.fn(), deleteMember: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { MembersPanel } from "../src/screens/MembersPanel";
import { api } from "../src/api/client";

const member = (over: Partial<MemberView> = {}): MemberView => ({
  id: "dena@x.id", name: "Dena", email: "dena@x.id", role: "desainer", active: true,
  createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z", ...over,
});
const page = (items: MemberView[]) => ({ items, total: items.length, page: 1, pageSize: items.length });

beforeEach(() => {
  vi.mocked(api.listMembers).mockResolvedValue(page([member()]));
  vi.mocked(api.createMember).mockResolvedValue(member({ id: "b@x.id", name: "Budi", email: "b@x.id" }));
  vi.mocked(api.patchMember).mockResolvedValue(member({ name: "Dena M" }));
  vi.mocked(api.deleteMember).mockResolvedValue(undefined);
});

const open = () => {
  const onChanged = vi.fn(), onToast = vi.fn();
  render(<MembersPanel open onClose={() => {}} onChanged={onChanged} onToast={onToast} />);
  return { onChanged, onToast };
};

describe("MembersPanel", () => {
  it("memuat & menampilkan anggota beserta perannya", async () => {
    open();
    expect(await screen.findByText("Dena")).toBeInTheDocument();
    expect(screen.getByText(/desainer/)).toBeInTheDocument();
  });

  it("menambah anggota lalu memuat ulang daftarnya", async () => {
    const { onChanged } = open();
    await screen.findByText("Dena");
    fireEvent.change(screen.getByLabelText("Nama anggota baru"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByLabelText("Email anggota baru"), { target: { value: "b@x.id" } });
    fireEvent.click(screen.getByRole("button", { name: /tambah anggota/i }));
    await waitFor(() => expect(api.createMember).toHaveBeenCalledWith({ name: "Budi", email: "b@x.id", role: null }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  /* ADR-0094/ADR-0150 · id anggota DITURUNKAN dari email dan changefeed tak punya operasi rename.
     Form yang menawarkan field email lalu membuangnya adalah kelas bug yang membuat lapis kedua
     penolakan di route ditulis — jadi field itu tak boleh ada sama sekali. */
  it("tidak menawarkan field email pada baris yang sudah ada", async () => {
    open();
    await screen.findByText("Dena");
    fireEvent.click(screen.getByRole("button", { name: "Ubah Dena" }));
    expect(screen.getByLabelText("Nama Dena")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email Dena")).toBeNull();
    expect(screen.getByText(/ganti email berarti hapus lalu buat baru/i)).toBeInTheDocument();
  });

  it("menyimpan nama & peran lewat patchMember", async () => {
    open();
    await screen.findByText("Dena");
    fireEvent.click(screen.getByRole("button", { name: "Ubah Dena" }));
    fireEvent.change(screen.getByLabelText("Nama Dena"), { target: { value: "Dena M" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(api.patchMember).toHaveBeenCalledWith("dena@x.id", { name: "Dena M", role: "desainer" }));
  });

  it("menonaktifkan anggota tanpa menghapusnya", async () => {
    open();
    await screen.findByText("Dena");
    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan Dena" }));
    await waitFor(() => expect(api.patchMember).toHaveBeenCalledWith("dena@x.id", { active: false }));
  });

  /* SPEC-847 · ADR-0127 · destruktif lewat useConfirm, bukan window.confirm (dijaga
     src/test/confirm-inventory.test.ts). Dialognya menyebut bahwa task-nya TIDAK ikut terhapus. */
  it("hapus meminta konfirmasi dan menyebut nasib task-nya", async () => {
    open();
    await screen.findByText("Dena");
    fireEvent.click(screen.getByRole("button", { name: "Hapus Dena" }));
    expect(await screen.findByText(/tugasnya tidak ikut terhapus/i)).toBeInTheDocument();
    expect(api.deleteMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /hapus anggota/i }));
    await waitFor(() => expect(api.deleteMember).toHaveBeenCalledWith("dena@x.id"));
  });
});
