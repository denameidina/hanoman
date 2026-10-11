// Audit UI/UX 2026-10 · Fase 2A — umpan balik, tab, dan menu aksi (ds/components/feedback.tsx, ui.tsx).
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Badge, Callout, ProgressBar, StatusPill, Tabs, TabPanel, OverflowActions } from "../src/ds";

afterEach(cleanup);

describe("Badge & StatusPill · varian dot", () => {
  it("Badge dot: titik dekoratif, teks tetap terbaca, tanpa latar", () => {
    const { container } = render(<Badge variant="dot" tone="ok">Tersambung</Badge>);
    const text = screen.getByText("Tersambung");
    expect(text).toBeInTheDocument();
    expect(text.style.background).toBe("");
    expect(container.querySelector(".hn-status-dot")).toHaveAttribute("aria-hidden", "true");
  });

  it("tone warn memakai token teks kontras (status-warn), bukan amber-600 fill", () => {
    render(<Badge tone="warn">Perlu cek</Badge>);
    expect(screen.getByText("Perlu cek")).toHaveStyle({ color: "var(--status-warn)" });
  });

  it("StatusPill dot: label tetap ada dan titik disembunyikan dari pembaca layar", () => {
    const { container } = render(<StatusPill status="running" variant="dot">Menjalankan</StatusPill>);
    expect(screen.getByText("Menjalankan")).toBeInTheDocument();
    expect(container.querySelector(".hn-status-dot")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".hn-status-dot-pulse")).not.toBeNull();
  });

  it("StatusPill running memakai brass-700 untuk teks, bukan brass-600 (3,96:1 di atas brass-100)", () => {
    render(<StatusPill status="running">2 aktif</StatusPill>);
    expect(screen.getByText("2 aktif")).toHaveStyle({ color: "var(--brass-700)" });
  });

  it("StatusPill tanpa label kustom tetap menampilkan label status", () => {
    render(<StatusPill status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});

describe("ProgressBar · nama aksesibel di elemen progressbar", () => {
  it("role progressbar ada di track (bukan pembungkus) dan membawa label string", () => {
    const { container } = render(<ProgressBar value={3} max={8} label="Tahap" valueText="3 dari 8 tahap" />);
    const bar = screen.getByRole("progressbar", { name: "Tahap" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuetext", "3 dari 8 tahap");
    expect(container.firstElementChild).not.toHaveAttribute("role", "progressbar");
  });

  it("aria-label diteruskan ke track, bukan ke pembungkus visual", () => {
    const { container } = render(<ProgressBar value={50} aria-label="Kuota minggu ini" />);
    expect(screen.getByRole("progressbar", { name: "Kuota minggu ini" })).toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveAttribute("aria-label");
  });

  it("label ReactNode tidak dipakai sebagai nama; persen terlihat disembunyikan dari pembaca layar", () => {
    const { container } = render(<ProgressBar value={25} showLabel label={<strong>Dokumen</strong>} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-label");
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("Callout · role mengikuti keparahan", () => {
  it("err menjadi alert, warn dan ok menjadi status, info dan brass menjadi note", () => {
    const { rerender } = render(<Callout tone="err">gagal</Callout>);
    expect(screen.getByRole("alert")).toHaveTextContent("gagal");
    rerender(<Callout tone="warn">hati-hati</Callout>);
    expect(screen.getByRole("status")).toHaveTextContent("hati-hati");
    rerender(<Callout tone="ok">beres</Callout>);
    expect(screen.getByRole("status")).toHaveTextContent("beres");
    rerender(<Callout tone="info">info</Callout>);
    expect(screen.getByRole("note")).toHaveTextContent("info");
    rerender(<Callout tone="brass">catatan</Callout>);
    expect(screen.getByRole("note")).toHaveTextContent("catatan");
  });

  it("prop role eksplisit tetap menang atas default tone (pemakai lama tak patah)", () => {
    render(<Callout tone="warn" role="alert">peringatan</Callout>);
    expect(screen.getByRole("alert")).toHaveTextContent("peringatan");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Tabs · aria-controls dan TabPanel", () => {
  const renderTabs = (value: string, onChange = vi.fn()) => render(
    <Tabs aria-label="Panel" tabs={["Daftar", "Detail", "Riwayat"]} value={value} onChange={onChange}>
      <TabPanel value="Daftar"><p>isi daftar</p></TabPanel>
      <TabPanel value="Detail"><p>isi detail</p></TabPanel>
      <TabPanel value="Riwayat"><p>isi riwayat</p></TabPanel>
    </Tabs>,
  );

  it("tab punya id dan aria-controls yang menunjuk ke panelnya; panel punya aria-labelledby balik", () => {
    renderTabs("Daftar");
    const tab = screen.getByRole("tab", { name: "Daftar" });
    const panelId = tab.getAttribute("aria-controls");
    expect(tab.id).toBeTruthy();
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId!);
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  });

  it("hanya panel yang aktif terlihat; yang lain tetap di DOM dengan hidden", () => {
    renderTabs("Detail");
    const panels = screen.getAllByRole("tabpanel", { hidden: true });
    expect(panels).toHaveLength(3);
    expect(panels.filter((p) => !p.hasAttribute("hidden"))).toHaveLength(1);
    expect(screen.getByText("isi detail")).toBeVisible();
    expect(screen.getByText("isi daftar")).not.toBeVisible();
  });

  it("keyboard tetap bekerja: ArrowRight, End, Home memanggil onChange", () => {
    const onChange = vi.fn();
    renderTabs("Daftar", onChange);
    const first = screen.getByRole("tab", { name: "Daftar" });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("Detail");
    fireEvent.keyDown(first, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("Riwayat");
    fireEvent.keyDown(first, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("Daftar");
  });

  it("tanpa TabPanel tak ada aria-controls yang menunjuk ke id kosong", () => {
    render(<Tabs aria-label="Tanpa panel" tabs={["Satu", "Dua"]} value="Satu" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Satu" })).not.toHaveAttribute("aria-controls");
  });
});

describe("OverflowActions · danger dan label", () => {
  it("item tone danger diberi kelas danger; item biasa tidak", () => {
    render(<OverflowActions label="Aksi sesi A" items={[
      { key: "lihat", label: "Lihat", onSelect: () => {} },
      { key: "hapus", label: "Hapus", tone: "danger", onSelect: () => {} },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Aksi sesi A" }));
    expect(screen.getByRole("menuitem", { name: "Hapus" })).toHaveClass("hn-overflow-item-danger");
    expect(screen.getByRole("menuitem", { name: "Lihat" })).not.toHaveClass("hn-overflow-item-danger");
  });

  it("label memberi nama pemicu dan dialog; title mengganti judul dialog saja", () => {
    render(<OverflowActions label="Aksi untuk SPEC-7" title="Aksi SPEC-7" items={[
      { key: "a", label: "Tandai selesai", onSelect: () => {} },
    ]} />);
    const trigger = screen.getByRole("button", { name: "Aksi untuk SPEC-7" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "Aksi SPEC-7" });
    expect(within(dialog).getByRole("menu", { name: "Aksi SPEC-7" })).toBeInTheDocument();
    expect(within(dialog).getByRole("menuitem", { name: "Tandai selesai" })).toBeInTheDocument();
  });

  it("tanpa title, dialog memakai label sebagai namanya", () => {
    render(<OverflowActions label="Aksi lain" items={[{ key: "a", label: "Satu", onSelect: () => {} }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    expect(screen.getByRole("dialog", { name: "Aksi lain" })).toBeInTheDocument();
  });
});
