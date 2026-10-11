// Audit UI/UX 2026-10 · Fase 2A — primitif layout dan daftar (ds/components/layout.tsx, skeleton.tsx).
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { PageHeader, FilterBar, RowList, DenseRow, Stack, Inline, Text, Skeleton, SkeletonList } from "../src/ds";

afterEach(cleanup);

describe("PageHeader", () => {
  it("judul layar memakai h2 (shell sudah punya h1) dan tak ada h1 di dalamnya", () => {
    const { container } = render(
      <PageHeader eyebrow="Sesi" title="Terminal" description="Pantau sesi yang berjalan."
        actions={<button type="button">Sesi baru</button>} />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Terminal" })).toBeInTheDocument();
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByText("Sesi")).toBeInTheDocument();
    expect(screen.getByText("Pantau sesi yang berjalan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sesi baru" })).toBeInTheDocument();
    expect(container.querySelector("header.hn-page-header")).not.toBeNull();
  });

  it("tanpa eyebrow, deskripsi, dan aksi hanya merender judul", () => {
    const { container } = render(<PageHeader title="Backlog" />);
    expect(container.querySelector(".hn-eyebrow")).toBeNull();
    expect(container.querySelector(".hn-page-description")).toBeNull();
    expect(container.querySelector(".hn-page-actions")).toBeNull();
  });
});

describe("FilterBar", () => {
  it("pencarian memanggil onChange dan membawa label + placeholder berisi contoh", () => {
    const onChange = vi.fn();
    render(<FilterBar label="Filter backlog" search={{ value: "", onChange, label: "Cari backlog", placeholder: "mis. SPEC-12 atau judul" }} />);
    const box = screen.getByRole("searchbox", { name: "Cari backlog" });
    expect(box).toHaveAttribute("placeholder", "mis. SPEC-12 atau judul");
    fireEvent.change(box, { target: { value: "login" } });
    expect(onChange).toHaveBeenCalledWith("login");
  });

  it("setiap chip aktif bisa dilepas sendiri lewat tombol berlabel", () => {
    const remove = vi.fn();
    render(<FilterBar label="Filter" chips={[{ key: "prio", label: "Prioritas tinggi", onRemove: remove }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus filter Prioritas tinggi" }));
    expect(remove).toHaveBeenCalledOnce();
  });

  it("Reset hanya muncul ketika ada filter aktif, lalu memanggil onReset", () => {
    const reset = vi.fn();
    const { rerender } = render(<FilterBar label="Filter" onReset={reset} />);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    rerender(<FilterBar label="Filter" onReset={reset} chips={[{ key: "a", label: "Aktif", onRemove: () => {} }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("popover Filter membuka slot, menandai aria-expanded, dan Escape menutupnya", () => {
    render(<FilterBar label="Filter" chips={[{ key: "a", label: "A", onRemove: () => {} }]}
      filters={<label>Tanggal<input type="date" aria-label="Tanggal" /></label>} />);
    const trigger = screen.getByRole("button", { name: /Filter/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("dialog", { name: "Filter" });
    expect(within(panel).getByLabelText("Tanggal")).toBeInTheDocument();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

describe("RowList / DenseRow", () => {
  it("daftar memakai role list dan tiap baris listitem", () => {
    render(
      <RowList label="Spec">
        <DenseRow>Non-klik</DenseRow>
        <DenseRow onClick={() => {}}>Klik</DenseRow>
      </RowList>,
    );
    expect(screen.getByRole("list", { name: "Spec" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("baris klik adalah <button> sungguhan dan memanggil onClick", () => {
    const onClick = vi.fn();
    render(<RowList label="Spec"><DenseRow onClick={onClick}>SPEC-1 · Login</DenseRow></RowList>);
    const btn = screen.getByRole("button", { name: "SPEC-1 · Login" });
    expect(btn.tagName).toBe("BUTTON");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("baris non-klik tak punya tombol sama sekali", () => {
    const { container } = render(<RowList label="Spec"><DenseRow>Teks biasa</DenseRow></RowList>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".hn-row-interactive")).toBeNull();
  });

  it("href membuat tautan sungguhan", () => {
    render(<RowList label="Spec"><DenseRow href="/spec/1">Buka</DenseRow></RowList>);
    expect(screen.getByRole("link", { name: "Buka" })).toHaveAttribute("href", "/spec/1");
  });

  it("aksi sekunder berada di luar elemen klik, bukan tombol di dalam tombol", () => {
    render(<RowList label="Spec"><DenseRow onClick={() => {}}
      actions={<button type="button">Hapus</button>}>Judul</DenseRow></RowList>);
    const main = screen.getByRole("button", { name: "Judul" });
    expect(within(main).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Hapus" })).toBeInTheDocument();
  });

  it("baris terpilih menandai aria-current", () => {
    render(<RowList label="Spec"><DenseRow onClick={() => {}} selected>Aktif</DenseRow></RowList>);
    expect(screen.getByRole("button", { name: "Aktif" })).toHaveAttribute("aria-current", "true");
  });
});

describe("Stack / Inline / Text", () => {
  it("Stack memakai kelas flex-kolom dan gap dari token spacing", () => {
    const { container } = render(<Stack gap={4}><span>a</span></Stack>);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass("hn-stack");
    expect(el.style.gap).toBe("var(--space-4)");
  });

  it("Inline membungkus secara default dan bisa dikunci satu baris", () => {
    const { container, rerender } = render(<Inline><span>a</span></Inline>);
    expect(container.firstElementChild).toHaveClass("hn-inline");
    expect(container.firstElementChild).not.toHaveClass("hn-inline-nowrap");
    rerender(<Inline wrap={false}><span>a</span></Inline>);
    expect(container.firstElementChild).toHaveClass("hn-inline-nowrap");
  });

  it("Text memetakan ukuran ke skala token 11/12/13/14/16", () => {
    render(<>
      <Text size={11}>kecil</Text>
      <Text size={16} tone="strong">besar</Text>
    </>);
    expect(screen.getByText("kecil")).toHaveStyle({ fontSize: "var(--text-2xs)" });
    expect(screen.getByText("besar")).toHaveStyle({ fontSize: "var(--text-base)", color: "var(--text-strong)" });
  });

  it("Text bawaan memakai ukuran 14 dan tone body", () => {
    render(<Text>isi</Text>);
    expect(screen.getByText("isi")).toHaveStyle({ fontSize: "var(--text-md)", color: "var(--text-body)" });
  });
});

describe("Skeleton", () => {
  it("blok skeleton dekoratif (aria-hidden) dan bentuknya memakai radius token", () => {
    const { container } = render(<Skeleton height={20} radius="md" />);
    const el = container.querySelector(".hn-skeleton");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveClass("hn-skeleton-r-md");
  });

  it("SkeletonList mengumumkan 'Memuat…' sebagai status sibuk, sekali, bukan per baris", () => {
    const { container } = render(<SkeletonList rows={4} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByText("Memuat…")).toBeInTheDocument();
    expect(container.querySelectorAll(".hn-skeleton")).toHaveLength(4);
  });
});
