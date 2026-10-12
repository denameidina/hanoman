import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { OverflowActions } from "../src/ds";

afterEach(cleanup);

// Menu dibuka lewat pemicu yang sudah difokuskan, seperti pengguna keyboard. fireEvent.click saja tak
// memindahkan fokus di jsdom, dan fokus kembali ke pemicu adalah yang diuji.
function openMenu(name: string) {
  const trigger = screen.getByRole("button", { name });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

const threeItems = () => [
  { key: "a", label: "Lihat dokumen", onSelect: () => {} },
  { key: "b", label: "Lepas dari grid", onSelect: () => {} },
  { key: "c", label: "Salin tautan", onSelect: () => {} },
];

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
    expect(screen.queryByRole("menuitem", { name: "Lihat dokumen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    expect(screen.getByRole("menuitem", { name: "Lepas dari grid" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Lihat dokumen" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("menutup panel sesudah sebuah aksi dipilih", () => {
    render(
      <OverflowActions label="Aksi lain" items={[
        { key: "a", label: "Lihat dokumen", onSelect: () => {} },
      ]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Lihat dokumen" }));
    expect(screen.queryByRole("menuitem", { name: "Lihat dokumen" })).toBeNull();
  });

  it("menghormati item nonaktif", () => {
    const run = vi.fn();
    render(
      <OverflowActions label="Aksi lain" items={[
        { key: "a", label: "Lepas dari grid", onSelect: run, disabled: true },
      ]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    const item = screen.getByRole("menuitem", { name: "Lepas dari grid" });
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

describe("OverflowActions · semantik menu ARIA", () => {
  it("pemicu menyatakan menu dan keadaannya; panel berisi role=menu dengan item menuitem", () => {
    render(<OverflowActions label="Aksi sesi A" title="Sesi A" items={threeItems()} />);
    const trigger = screen.getByRole("button", { name: "Aksi sesi A" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    openMenu("Aksi sesi A");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Sesi A" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    expect(within(menu).queryByRole("button")).toBeNull();
  });

  it("roving tabindex: hanya satu item tabbable, dan fokus awal ada di item itu", () => {
    render(<OverflowActions label="Aksi lain" items={threeItems()} />);
    openMenu("Aksi lain");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(document.activeElement).toBe(items[0]);
  });

  it("panah bawah dan atas memindahkan fokus dan berputar di ujung", () => {
    render(<OverflowActions label="Aksi lain" items={threeItems()} />);
    openMenu("Aksi lain");
    const [a, b, c] = screen.getAllByRole("menuitem");
    fireEvent.keyDown(a!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(b);
    expect(b).toHaveAttribute("tabindex", "0");
    expect(a).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(b!, { key: "ArrowDown" });
    fireEvent.keyDown(c!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(c);
  });

  it("panah melewati item nonaktif", () => {
    render(<OverflowActions label="Aksi lain" items={[
      { key: "a", label: "Satu", onSelect: () => {} },
      { key: "b", label: "Dua", onSelect: () => {}, disabled: true },
      { key: "c", label: "Tiga", onSelect: () => {} },
    ]} />);
    openMenu("Aksi lain");
    const [satu, , tiga] = screen.getAllByRole("menuitem");
    fireEvent.keyDown(satu!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(tiga);
  });

  it("Home dan End ke item pertama dan terakhir yang aktif", () => {
    render(<OverflowActions label="Aksi lain" items={threeItems()} />);
    openMenu("Aksi lain");
    const [a, , c] = screen.getAllByRole("menuitem");
    fireEvent.keyDown(a!, { key: "End" });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c!, { key: "Home" });
    expect(document.activeElement).toBe(a);
  });

  it("huruf pertama melompat ke item yang berawalan huruf itu, lalu berputar", () => {
    render(<OverflowActions label="Aksi lain" items={[
      { key: "a", label: "Hapus", onSelect: () => {} },
      { key: "b", label: "Salin", onSelect: () => {} },
      { key: "c", label: "Simpan", onSelect: () => {} },
    ]} />);
    openMenu("Aksi lain");
    const [hapus, salin, simpan] = screen.getAllByRole("menuitem");
    fireEvent.keyDown(hapus!, { key: "s" });
    expect(document.activeElement).toBe(salin);
    fireEvent.keyDown(salin!, { key: "s" });
    expect(document.activeElement).toBe(simpan);
    fireEvent.keyDown(simpan!, { key: "s" });
    expect(document.activeElement).toBe(salin);
  });

  it("Escape menutup panel dan mengembalikan fokus ke pemicu", () => {
    render(<OverflowActions label="Aksi lain" items={threeItems()} />);
    const trigger = openMenu("Aksi lain");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab dari item menutup panel dan mengembalikan fokus ke pemicu", () => {
    render(<OverflowActions label="Aksi lain" items={threeItems()} />);
    const trigger = openMenu("Aksi lain");
    fireEvent.keyDown(screen.getAllByRole("menuitem")[0]!, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Shift+Tab juga menutup bila panel tak punya kontrol lain", () => {
    render(<OverflowActions label="Aksi lain" items={threeItems()} />);
    const trigger = openMenu("Aksi lain");
    fireEvent.keyDown(screen.getAllByRole("menuitem")[0]!, { key: "Tab", shiftKey: true });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("memilih item dengan Enter (klik native) tidak mengembalikan fokus ke pemicu", () => {
    const run = vi.fn();
    render(<OverflowActions label="Aksi lain" items={[{ key: "a", label: "Lihat", onSelect: run }]} />);
    openMenu("Aksi lain");
    fireEvent.click(screen.getByRole("menuitem", { name: "Lihat" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("OverflowActions · tone danger dan children", () => {
  it("tone danger memakai kelas danger di item menu", () => {
    render(<OverflowActions label="Aksi lain" items={[
      { key: "lihat", label: "Lihat", onSelect: () => {} },
      { key: "hapus", label: "Hapus", tone: "danger", onSelect: () => {} },
    ]} />);
    openMenu("Aksi lain");
    expect(screen.getByRole("menuitem", { name: "Hapus" })).toHaveClass("hn-overflow-item", "hn-overflow-item-danger");
    expect(screen.getByRole("menuitem", { name: "Lihat" })).not.toHaveClass("hn-overflow-item-danger");
  });

  it("children tanpa item: pemicu berpopup dialog dan tak ada role=menu", () => {
    render(<OverflowActions label="Tampilan" items={[]}><label htmlFor="x">Ukuran</label></OverflowActions>);
    const trigger = screen.getByRole("button", { name: "Tampilan" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    openMenu("Tampilan");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByText("Ukuran")).toBeInTheDocument();
  });

  it("children berada di luar role=menu; Shift+Tab dari menu dibiarkan pindah ke kontrol itu, panel tetap terbuka", () => {
    render(
      <OverflowActions label="Menu laporan" title="Ekspor" items={[{ key: "a", label: "Hapus", onSelect: () => {} }]}>
        <button type="button">Unduh PDF</button>
      </OverflowActions>,
    );
    openMenu("Menu laporan");
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("button", { name: "Unduh PDF" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unduh PDF" })).toBeInTheDocument();
    // jsdom tak menjalankan Tab bawaan; yang diuji: handler tak membatalkan Shift+Tab (fireEvent → true)
    // dan tak menutup panel.
    const notPrevented = fireEvent.keyDown(screen.getByRole("menuitem", { name: "Hapus" }), { key: "Tab", shiftKey: true });
    expect(notPrevented).toBe(true);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
