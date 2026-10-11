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

// SPEC-847 · ADR-0127 · dampak berbaris-baris tak boleh dipadatkan jadi satu string, dan aksi
// yang bukan hapus tak boleh dipaksa memakai ikon trash.
describe("ConfirmDialog impact & icon (SPEC-847)", () => {
  it("merender daftar dampak terstruktur, bukan satu paragraf", () => {
    render(<ConfirmDialog open title="Ganti ID?" message="Dampaknya:"
      impact={["Link Help publik berubah.", "Perubahan dirambatkan ke hub."]}
      onConfirm={() => {}} onCancel={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Link Help publik berubah.", "Perubahan dirambatkan ke hub.",
    ]);
  });

  it("tanpa impact tak ada list sama sekali", () => {
    render(<ConfirmDialog open title="Hapus?" message="pesan" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("icon menimpa trash-2 di header dan di tombol konfirmasi", () => {
    const { container } = render(<ConfirmDialog open title="Cabut token?" icon="key-round"
      confirmLabel="Cabut" onConfirm={() => {}} onCancel={() => {}} />);
    expect(container.querySelector('[data-icon="trash-2"]')).toBeNull();
    expect(container.querySelectorAll('[data-icon="key-round"]').length).toBe(2);
  });

  it("tone danger memberi tombol konfirmasi varian danger", () => {
    render(<ConfirmDialog open title="Hapus?" confirmLabel="Hapus" onConfirm={() => {}} onCancel={() => {}} />);
    const btn = screen.getByRole("button", { name: "Hapus" });
    // Warna varian danger ada di forms.css (`.hn-btn-danger`), bukan inline.
    expect(btn).toHaveClass("hn-btn-danger");
  });
});

// Audit UI/UX 2026-10 · Fase 2B · aksi destruktif mulai dari "Batal"; Enter tak mengonfirmasi.
describe("ConfirmDialog · fokus, Enter, dan busy (Fase 2B)", () => {
  it("tone danger: fokus awal di Batal, bukan konfirmasi", () => {
    render(<ConfirmDialog open title="Hapus?" confirmLabel="Hapus" onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Batal" }));
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Hapus" }));
  });

  it("tone default: fokus awal di konfirmasi", () => {
    render(<ConfirmDialog open tone="default" title="Simpan?" confirmLabel="Simpan" onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Simpan" }));
  });

  it("dengan requireText, fokus awal jatuh ke isiannya", () => {
    render(<ConfirmDialog open title="Hapus folder" requireText="src" onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Ketik src untuk konfirmasi"));
  });

  it("busy mematikan Escape, klik latar, tombol ×, dan isian ketik-ulang", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open busy title="Hapus folder" requireText="src" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-panel").parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Tutup")).toBeDisabled();
    expect(screen.getByLabelText("Ketik src untuk konfirmasi")).toBeDisabled();
  });

  it("tidak busy: Escape membatalkan dialog danger", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Hapus?" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("impact dirender sebagai <ul> berisi <li>", () => {
    const { container } = render(<ConfirmDialog open title="Hapus?" impact={["satu", "dua"]} onConfirm={() => {}} onCancel={() => {}} />);
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll("li")).toHaveLength(2);
  });
});
