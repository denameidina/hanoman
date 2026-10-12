// Audit UI/UX 2026-10 · Fase 2B · Field memisah label dan hint, dan menautkan keduanya ke kontrol:
// <label htmlFor> ke pemilik, aria-describedby untuk hint + error, role="alert" + aria-invalid untuk error.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { Field, HnTextarea } from "../src/ds/kit";
import { Input, Select, MultiSelect } from "../src/ds/components/forms";

describe("Field · label terpisah dari hint", () => {
  it("label menunjuk kontrol lewat htmlFor dan tidak membungkus isi Field", () => {
    render(<Field label="Nama project" hint="huruf kecil saja"><Input placeholder="mis. kirana" /></Field>);
    const input = screen.getByLabelText("Nama project");
    expect(input.tagName).toBe("INPUT");
    const label = screen.getByText("Nama project").closest("label")!;
    expect(label.contains(input)).toBe(false);
  });

  it("hint ditautkan ke kontrol lewat aria-describedby, tanpa masuk ke nama label", () => {
    render(<Field label="Nama project" hint="huruf kecil saja"><Input placeholder="mis. kirana" /></Field>);
    const input = screen.getByLabelText("Nama project");
    const hint = screen.getByText("huruf kecil saja");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(input).toHaveAccessibleName("Nama project");
    expect(input).toHaveAccessibleDescription("huruf kecil saja");
  });

  it("error: role=alert, aria-invalid pada kontrol, dan aria-describedby memuat id error", () => {
    render(<Field label="Port" error="Harus angka 1–65535"><Input placeholder="22" /></Field>);
    const input = screen.getByLabelText("Port");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Harus angka 1–65535");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")!.split(" ")).toContain(alert.id);
  });

  it("tanpa error tak ada role=alert dan aria-invalid tak diset", () => {
    render(<Field label="Port"><Input placeholder="22" /></Field>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Port")).not.toHaveAttribute("aria-invalid");
  });

  it("Select dan HnTextarea juga mengambil tautan Field", () => {
    const { unmount } = render(<Field label="Model"><Select options={["a", "b"]} /></Field>);
    expect(screen.getByLabelText("Model").tagName).toBe("SELECT");
    unmount();
    render(<Field label="Goal" hint="kondisi"><HnTextarea placeholder="mis. p95 < 200 ms" /></Field>);
    const area = screen.getByLabelText("Goal");
    expect(area.tagName).toBe("TEXTAREA");
    expect(area).toHaveAccessibleDescription("kondisi");
  });

  it("hanya kontrol pertama yang jadi pemilik; id tak pernah ganda", () => {
    render(<Field label="Dua"><Input aria-label="pertama" placeholder="a" /><Input aria-label="kedua" placeholder="b" /></Field>);
    const [first, second] = screen.getAllByRole("textbox");
    expect(first!.id).not.toBe("");
    expect(second!.id).toBe("");
    expect(screen.getByText("Dua").closest("label")!.getAttribute("for")).toBe(first!.id);
  });

  it("saat pemilik dilepas, kontrol berikutnya mengambil alih tautan", () => {
    function Harness({ first }: { first: boolean }) {
      return <Field label="Pilih">{first ? <Input placeholder="x" /> : <Select options={["a"]} />}</Field>;
    }
    const { rerender } = render(<Harness first />);
    expect(screen.getByLabelText("Pilih").tagName).toBe("INPUT");
    rerender(<Harness first={false} />);
    expect(screen.getByLabelText("Pilih").tagName).toBe("SELECT");
  });

  it("kolom cari MultiSelect tak merebut tautan Field dari pemicunya", () => {
    render(<Field label="Tools"><MultiSelect options={[{ value: "read", label: "Read" }]} value={[]} onChange={() => {}} aria-label="Pilih tools" /></Field>);
    const trigger = screen.getByRole("button", { name: "Pilih tools" });
    expect(trigger.id).not.toBe("");
    expect(screen.getByText("Tools").closest("label")!.getAttribute("for")).toBe(trigger.id);
    fireEvent.click(trigger);
    expect(screen.getByRole("searchbox").id).toBe("");
  });

  it("Field tanpa label tetap merender kontrolnya", () => {
    render(<Field><Input aria-label="Cari" placeholder="mis. kirana" /></Field>);
    expect(screen.getByRole("textbox", { name: "Cari" })).toBeInTheDocument();
  });
});

describe("Input · Select · HnTextarea · aria-invalid dan aria-describedby", () => {
  it("Input meneruskan aria-describedby eksplisit dan invalid menyalakan aria-invalid", () => {
    render(<Input aria-label="Host" aria-describedby="pesan-host" invalid />);
    const input = screen.getByRole("textbox", { name: "Host" });
    expect(input).toHaveAttribute("aria-describedby", "pesan-host");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.className).toContain("hn-input-core");
  });

  it("aria-invalid eksplisit juga dihormati tanpa prop invalid", () => {
    render(<Input aria-label="Host" aria-invalid="true" />);
    expect(screen.getByRole("textbox", { name: "Host" })).toHaveAttribute("aria-invalid", "true");
  });

  it("Select menerima invalid dan aria-describedby", () => {
    render(<Select aria-label="Mode" options={["a"]} invalid aria-describedby="pesan-mode" />);
    const select = screen.getByRole("combobox", { name: "Mode" });
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAttribute("aria-describedby", "pesan-mode");
  });

  it("HnTextarea menggabungkan onFocus dan onBlur pemanggil alih-alih menimpanya", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<HnTextarea aria-label="Goal" onFocus={onFocus} onBlur={onBlur} />);
    const area = screen.getByRole("textbox", { name: "Goal" });
    fireEvent.focus(area);
    fireEvent.blur(area);
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it("HnTextarea invalid menyalakan aria-invalid dan kelas fokus tunggal", () => {
    render(<HnTextarea aria-label="Detail" invalid />);
    const area = screen.getByRole("textbox", { name: "Detail" });
    expect(area).toHaveAttribute("aria-invalid", "true");
    expect(area.className).toContain("hn-textarea-core");
  });

  it("app.css mematikan outline ganda input & textarea DS (fokus digambar sekali oleh pembungkus)", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8");
    expect(css).toMatch(/\.hn-input-core:focus-visible,\s*\.hn-textarea-core:focus-visible \{ outline: none/);
  });
});
