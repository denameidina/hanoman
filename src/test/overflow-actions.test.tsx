import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { OverflowActions } from "../src/ds";

afterEach(cleanup);

describe("OverflowActions", () => {
  it("tak merender apa pun tanpa item — trigger kosong hanya menambah kepadatan", () => {
    const { container } = render(<OverflowActions label="Aksi lain" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("menyembunyikan aksinya sampai trigger ditekan, lalu menampilkannya semua", () => {
    const run = vi.fn();
    render(
      <OverflowActions label="Aksi lain" items={[
        { key: "a", label: "Lihat dokumen", onSelect: run },
        { key: "b", label: "Lepas dari grid", onSelect: () => {} },
      ]} />,
    );
    expect(screen.queryByRole("button", { name: "Lihat dokumen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    expect(screen.getByRole("button", { name: "Lepas dari grid" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lihat dokumen" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("menutup panel sesudah sebuah aksi dipilih", () => {
    render(
      <OverflowActions label="Aksi lain" items={[
        { key: "a", label: "Lihat dokumen", onSelect: () => {} },
      ]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    fireEvent.click(screen.getByRole("button", { name: "Lihat dokumen" }));
    expect(screen.queryByRole("button", { name: "Lihat dokumen" })).toBeNull();
  });

  it("menghormati item nonaktif", () => {
    const run = vi.fn();
    render(
      <OverflowActions label="Aksi lain" items={[
        { key: "a", label: "Lepas dari grid", onSelect: run, disabled: true },
      ]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    const item = screen.getByRole("button", { name: "Lepas dari grid" });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(run).not.toHaveBeenCalled();
  });

  it("merender children di dalam panel untuk kontrol yang bukan sekadar aksi", () => {
    render(
      <OverflowActions label="Aksi lain" items={[{ key: "a", label: "Lepas", onSelect: () => {} }]}>
        <label htmlFor="ukuran">Ukuran font</label>
      </OverflowActions>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    expect(screen.getByText("Ukuran font")).toBeInTheDocument();
  });
});
