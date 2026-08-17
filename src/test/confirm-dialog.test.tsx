import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "../src/ds/ConfirmDialog";

describe("ConfirmDialog (SPEC-269)", () => {
  it("render judul & pesan saat open; tak render saat tutup", () => {
    const { rerender } = render(<ConfirmDialog open={false} title="Hapus?" message="pesan" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Hapus?")).toBeNull();
    rerender(<ConfirmDialog open title="Hapus?" message="pesan" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Hapus?")).toBeTruthy();
    expect(screen.getByText("pesan")).toBeTruthy();
  });

  it("Batal → onCancel; konfirmasi → onConfirm", () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    render(<ConfirmDialog open title="Hapus?" confirmLabel="Hapus" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Batal"));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Hapus"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("busy menonaktifkan tombol", () => {
    render(<ConfirmDialog open title="Hapus?" confirmLabel="Hapus" busy onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByText("Batal").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Hapus").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

// ADR-0121 · aksi yang tak bisa dibatalkan (hapus folder rekursif) menuntut nama diketik ulang.
describe("ConfirmDialog requireText (ADR-0121)", () => {
  it("mengunci konfirmasi sampai teksnya cocok", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Hapus folder" requireText="src"
      onConfirm={onConfirm} onCancel={() => {}} />);
    const tombol = screen.getByRole("button", { name: "Hapus" });
    expect(tombol).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ketik src untuk konfirmasi"), { target: { value: "sr" } });
    expect(tombol).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ketik src untuk konfirmasi"), { target: { value: "src" } });
    expect(tombol).toBeEnabled();
    fireEvent.click(tombol);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("tanpa requireText dialog lama tetap langsung bisa dikonfirmasi", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Hapus" onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
