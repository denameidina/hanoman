// Audit UI/UX 2026-10 · Fase 2B · Modal: judul <h2> dirujuk aria-labelledby; latar inert selama terbuka
// (bertumpuk aman); fokus kembali ke pemicu; `dismissible={false}` mematikan Escape, klik latar, dan ×.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "../src/ds/kit";

describe("Modal · nama dialog dan judul", () => {
  it("dialog dinamai oleh judul <h2>", () => {
    render(<Modal open title="Hapus spec?" onClose={() => {}}>isi</Modal>);
    const dialog = screen.getByRole("dialog", { name: "Hapus spec?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Hapus spec?" })).toBeInTheDocument();
  });
});

describe("Modal · latar inert", () => {
  function Page({ open }: { open: boolean }) {
    return (
      <>
        <main data-testid="page"><button>Latar</button></main>
        <Modal open={open} title="X" onClose={() => {}}>isi</Modal>
      </>
    );
  }

  it("saudara leluhur panel diberi inert saat terbuka dan dilepas saat tutup", () => {
    const { rerender } = render(<Page open />);
    expect(screen.getByTestId("page")).toHaveAttribute("inert");
    rerender(<Page open={false} />);
    expect(screen.getByTestId("page")).not.toHaveAttribute("inert");
  });

  it("tetap inert sampai modal bertumpuk yang terakhir tutup", () => {
    function Stacked({ outer, inner }: { outer: boolean; inner: boolean }) {
      return (
        <>
          <main data-testid="page" />
          <Modal open={outer} title="Luar" onClose={() => {}}>
            <Modal open={inner} title="Dalam" onClose={() => {}}>isi</Modal>
          </Modal>
        </>
      );
    }
    const { rerender } = render(<Stacked outer inner />);
    expect(screen.getByTestId("page")).toHaveAttribute("inert");
    rerender(<Stacked outer inner={false} />);
    expect(screen.getByTestId("page")).toHaveAttribute("inert");
    rerender(<Stacked outer={false} inner={false} />);
    expect(screen.getByTestId("page")).not.toHaveAttribute("inert");
  });

  it("wadah toast (data-hn-toast-host) tetap bisa diumumkan saat modal terbuka", () => {
    render(
      <>
        <div data-hn-toast-host="" role="status" data-testid="toasts" />
        <Modal open title="X" onClose={() => {}}>isi</Modal>
      </>,
    );
    expect(screen.getByTestId("toasts")).not.toHaveAttribute("inert");
  });
});

describe("Modal · fokus", () => {
  it("fokus kembali ke pemicu saat modal tutup", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Buka</button>
          <Modal open={open} title="X" onClose={() => setOpen(false)}>isi</Modal>
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Buka" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tutup" }));
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("data-initial-focus menentukan fokus awal di atas tombol pertama", () => {
    render(
      <Modal open title="X" onClose={() => {}} footer={<><button>Pertama</button><button data-initial-focus="true">Kedua</button></>}>isi</Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Kedua" }));
  });
});

describe("Modal · dismissible", () => {
  it("dismissible=false: Escape tak menutup dan tak memanggil onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose} dismissible={false}>isi</Modal>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismissible=false: klik latar tak menutup, dan × mati", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose} dismissible={false}>isi</Modal>);
    const overlay = screen.getByTestId("modal-panel").parentElement!;
    fireEvent.mouseDown(overlay);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Tutup")).toBeDisabled();
  });

  it("tanpa onClose, × disabled (tak ada yang bisa dipanggil)", () => {
    render(<Modal open title="X">isi</Modal>);
    expect(screen.getByLabelText("Tutup")).toBeDisabled();
  });

  it("dismissible default true: × dan Escape bekerja seperti sebelumnya", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose}>isi</Modal>);
    expect(screen.getByLabelText("Tutup")).toBeEnabled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Tutup"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
