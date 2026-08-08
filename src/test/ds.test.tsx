import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Button, StatusPill, Card, Modal, StateBlock } from "../src/ds";
describe("ds components", () => {
  it("button fires onClick", async () => {
    const fn = vi.fn(); render(<Button onClick={fn}>Go</Button>);
    screen.getByText("Go").click(); expect(fn).toHaveBeenCalled();
  });
  it("status pill shows label", () => { render(<StatusPill status="running">2 aktif</StatusPill>);
    expect(screen.getByText("2 aktif")).toBeInTheDocument(); });
  it("card renders children", () => { render(<Card>body</Card>); expect(screen.getByText("body")).toBeInTheDocument(); });
  it("state block can replace its icon tile with an illustration without losing its action", () => {
    const retry = vi.fn();
    render(<StateBlock kind="error" illustration="PST-006" action={retry} />);
    expect(screen.getByTestId("illustration-PST-006")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    screen.getByText("Coba lagi").click();
    expect(retry).toHaveBeenCalledOnce();
  });
  it("keeps existing state blocks icon-only unless an illustration is requested", () => {
    render(<StateBlock kind="empty" />);
    expect(screen.queryByTestId(/^illustration-/)).toBeNull();
    expect(screen.getByText("Belum ada data")).toBeInTheDocument();
  });
});

// SPEC-232 · modal yang memuat terminal harus membiarkan Escape ke TUI Claude Code.
describe("Modal closeOnEscape", () => {
  it("default: Escape memanggil onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose}>isi</Modal>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closeOnEscape=false: Escape TIDAK memanggil onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose} closeOnEscape={false}>isi</Modal>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closeOnEscape=false: tombol tutup tetap memanggil onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="X" onClose={onClose} closeOnEscape={false}>isi</Modal>);
    fireEvent.click(screen.getByLabelText("Tutup"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
