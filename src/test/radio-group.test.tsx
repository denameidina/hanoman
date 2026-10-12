// Audit UI/UX 2026-10 · Fase 2B · RadioGroup: role=radiogroup, roving tabindex, panah/Home/End yang
// memindahkan fokus sekaligus memilih; Radio tanpa grup tetap bekerja; area sentuh Checkbox/Radio 24px.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { RadioGroup, Radio, Checkbox } from "../src/ds/components/forms";

function Harness({ initial = "b", disabledB = false, onChange = () => {} }:
  { initial?: string | null; disabledB?: boolean; onChange?: (v: string) => void }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <RadioGroup aria-label="Mode" value={value} onChange={(next) => { setValue(next); onChange(next); }}>
      <Radio value="a" label="A" />
      <Radio value="b" label="B" disabled={disabledB} />
      <Radio value="c" label="C" />
    </RadioGroup>
  );
}

const radios = () => screen.getAllByRole("radio");

describe("RadioGroup", () => {
  it("render sebagai role=radiogroup dengan nama dari aria-label", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Mode" });
    expect(group).toBeInTheDocument();
    expect(radios()).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("aria-checked", "true");
  });

  it("label terlihat menjadi nama grup lewat aria-labelledby", () => {
    render(<RadioGroup label="Tingkat akses" value="x" onChange={() => {}}><Radio value="x" label="Lihat" /></RadioGroup>);
    expect(screen.getByRole("radiogroup", { name: "Tingkat akses" })).toBeInTheDocument();
  });

  it("roving tabindex: hanya item terpilih yang tabbable", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "C" })).toHaveAttribute("tabindex", "-1");
  });

  it("tanpa pilihan, item enabled pertama yang tabbable (item disabled dilewati)", () => {
    render(<Harness initial={null} disabledB />);
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("tabindex", "-1");
  });

  it("panah bawah memindahkan fokus dan memilih item berikutnya", () => {
    const onChange = vi.fn();
    render(<Harness initial="a" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "A" }), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("aria-checked", "true");
  });

  it("panah berputar di ujung dan melewati item disabled", () => {
    const onChange = vi.fn();
    render(<Harness initial="c" disabledB onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "C" }), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "A" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "A" }), { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "C" }));
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("Home dan End ke item pertama dan terakhir", () => {
    render(<Harness initial="b" />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "B" }), { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "C" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "C" }), { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "A" }));
  });

  it("tombol Spasi atau Enter memilih item yang fokus", () => {
    const onChange = vi.fn();
    render(<Harness initial="a" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "C" }), { key: " " });
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("klik memilih item dan tidak memanggil onChange ulang untuk item yang sudah terpilih", () => {
    const onChange = vi.fn();
    render(<Harness initial="a" onChange={onChange} />);
    fireEvent.click(screen.getByText("A"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("C"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("Radio tanpa grup tetap memakai checked dan onChange seperti dulu", () => {
    const onChange = vi.fn();
    render(<Radio label="Sendiri" checked onChange={onChange} />);
    const radio = screen.getByRole("radio", { name: "Sendiri" });
    expect(radio).toHaveAttribute("aria-checked", "true");
    expect(radio).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(radio, { key: "Enter" });
    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe("area sentuh Checkbox dan Radio", () => {
  it("Checkbox dan Radio punya area 24×24 (kotak tampak tetap 18px di dalamnya)", () => {
    render(<><Checkbox label="Centang" /><Radio label="Pilih" /></>);
    expect(screen.getByRole("checkbox")).toHaveStyle({ width: "24px", height: "24px" });
    expect(screen.getByRole("radio")).toHaveStyle({ width: "24px", height: "24px" });
  });
});
