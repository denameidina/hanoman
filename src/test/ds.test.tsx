import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Button, Checkbox, IconButton, Input, Radio, Select, StatusPill, Card, Modal, StateBlock, Switch, Tabs } from "../src/ds";
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
  it("marks interactive form primitives for the shared 44px touch target", () => {
    const { container } = render(<>
      <Button size="sm">Aksi</Button>
      <IconButton icon="x" label="Ikon" size="sm" />
      <Input aria-label="Cari" size="sm" />
      <Select aria-label="Pilih" size="sm" options={["satu"]} />
    </>);
    expect(container.querySelectorAll(".hn-touch-target")).toHaveLength(4);
    expect(screen.getByRole("textbox", { name: "Cari" })).toHaveStyle({ height: "100%" });
  });
  it("moves Tabs with Arrow, Home, and End while preserving tab semantics", () => {
    const onChange = vi.fn();
    render(<Tabs aria-label="Panel" tabs={["Daftar", "Detail", "Riwayat"]} value="Daftar" onChange={onChange} />);
    const first = screen.getByRole("tab", { name: "Daftar" });
    const last = screen.getByRole("tab", { name: "Riwayat" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(last).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("Riwayat");
    fireEvent.keyDown(first, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("Riwayat");
    fireEvent.keyDown(last, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("Daftar");
  });
  it("toggles custom choice controls from the keyboard", () => {
    const checkboxChange = vi.fn();
    const radioChange = vi.fn();
    const switchChange = vi.fn();
    render(<>
      <Checkbox label="Centang" onChange={checkboxChange} />
      <Radio label="Pilih" onChange={radioChange} />
      <Switch label="Aktif" onChange={switchChange} />
    </>);
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Centang" }), { key: " " });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Pilih" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("switch", { name: "Aktif" }), { key: " " });
    expect(checkboxChange).toHaveBeenCalledWith(true, expect.anything());
    expect(radioChange).toHaveBeenCalledOnce();
    expect(switchChange).toHaveBeenCalledWith(true, expect.anything());
    expect(screen.getByRole("checkbox")).toHaveClass("hn-choice-control");
    expect(screen.getByRole("radio")).toHaveClass("hn-choice-control");
    expect(screen.getByRole("switch")).toHaveClass("hn-choice-control");
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
