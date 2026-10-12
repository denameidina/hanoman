// QA visual 2026-10 · P2: strip tab yang meluap terpotong tanpa tanda bahwa ia bisa digeser. Tabs kini
// menandai tepi yang masih menyimpan tab (`data-fade-start` / `data-fade-end`), dan app.css menggambar
// gradasi di tepi itu. jsdom tak menghitung tata letak, jadi ukuran dan posisi gulir diberikan langsung.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, TabPanel } from "../src/ds/components/ui";

const TABS = ["Semua", "Brainstorm", "Spec", "Dikerjakan", "Selesai"];

// Ukuran fisik kotak dan isi strip, plus posisi gulir yang bisa diubah test.
function layout(el: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft = 0) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(el, "scrollLeft", { configurable: true, writable: true, value: scrollLeft });
}

describe("Tabs · penanda tepi saat strip meluap", () => {
  it("tak meluap: tak ada penanda tepi sama sekali", () => {
    render(<Tabs tabs={TABS} value="Semua" onChange={() => {}} />);
    const list = screen.getByRole("tablist");
    layout(list, 360, 360);
    fireEvent.scroll(list);
    expect(list).not.toHaveAttribute("data-fade-start");
    expect(list).not.toHaveAttribute("data-fade-end");
  });

  it("meluap dan di awal: hanya tepi kanan yang diberi penanda", () => {
    render(<Tabs tabs={TABS} value="Semua" onChange={() => {}} />);
    const list = screen.getByRole("tablist");
    layout(list, 600, 360, 0);
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-fade-end", "true");
    expect(list).not.toHaveAttribute("data-fade-start");
  });

  it("digulir ke tengah: kedua tepi punya penanda", () => {
    render(<Tabs tabs={TABS} value="Spec" onChange={() => {}} />);
    const list = screen.getByRole("tablist");
    layout(list, 600, 360, 120);
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-fade-start", "true");
    expect(list).toHaveAttribute("data-fade-end", "true");
  });

  it("digulir sampai ujung: penanda kanan hilang, kiri tetap", () => {
    render(<Tabs tabs={TABS} value="Selesai" onChange={() => {}} />);
    const list = screen.getByRole("tablist");
    layout(list, 600, 360, 240);
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-fade-start", "true");
    expect(list).not.toHaveAttribute("data-fade-end");
  });

  it("strip yang membungkus (overflow visible, mis. Scheduler ≤420 px) tak diberi penanda meski ukurannya meluap", () => {
    render(<Tabs tabs={TABS} value="Semua" onChange={() => {}} style={{ overflowX: "visible" }} />);
    const list = screen.getByRole("tablist");
    layout(list, 600, 360, 0);
    fireEvent.scroll(list);
    expect(list).not.toHaveAttribute("data-fade-end");
    expect(list).not.toHaveAttribute("data-fade-start");
  });

  it("tetap aksesibel lewat keyboard: panah kiri/kanan tetap memilih tab", () => {
    const picked: string[] = [];
    render(<Tabs tabs={TABS} value="Semua" onChange={(v) => picked.push(v)} />);
    const first = screen.getByRole("tab", { name: "Semua" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(picked).toEqual(["Brainstorm"]);
  });

  it("dengan panel: tab dan panelnya tetap terhubung seperti sebelumnya", () => {
    render(
      <Tabs tabs={["a", "b"]} value="a" onChange={() => {}}>
        <TabPanel value="a">isi a</TabPanel>
        <TabPanel value="b">isi b</TabPanel>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "a" });
    expect(tab).toHaveAttribute("aria-controls");
  });
});

describe("Tabs · kontrak CSS scroll-snap dan gradasi tepi", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("strip tab memakai scroll-snap per tab", () => {
    expect(css).toMatch(/\.hn-tabs \{[^}]*scroll-snap-type:\s*x proximity/);
    expect(css).toMatch(/\.hn-tabs > \[role="tab"\] \{ scroll-snap-align: start; \}/);
  });

  it("gradasi lewat mask di kedua tepi, hanya bila penanda tepi aktif", () => {
    expect(css).toMatch(/\.hn-tabs\[data-fade-start="true"\],\s*\.hn-tabs\[data-fade-end="true"\] \{[^}]*mask-image:\s*linear-gradient\(to right, transparent 0,/);
    expect(css).toMatch(/\.hn-tabs\[data-fade-start="true"\] \{ --hn-fade-l: 24px; \}/);
    expect(css).toMatch(/\.hn-tabs\[data-fade-end="true"\] \{ --hn-fade-r: 24px; \}/);
  });

  it("scroll-padding 24 px di strip tab: tab yang di-snap tak tertutup gradasi, dan tab pertama tak menggeser strip", () => {
    expect(css).toMatch(/\.hn-tabs \{[^}]*scroll-padding-inline:\s*24px/);
  });

  it("papan tombol terminal memakai gradasi, snap, dan scroll-padding yang sama dengan strip tab", () => {
    expect(css).toMatch(/\.hn-terminal-keys\[data-fade-start="true"\],\s*\.hn-terminal-keys\[data-fade-end="true"\] \{[^}]*mask-image:\s*linear-gradient\(to right, transparent 0,/);
    expect(css).toMatch(/\.hn-terminal-keys\[data-fade-start="true"\] \{ --hn-fade-l: 24px; \}/);
    expect(css).toMatch(/\.hn-terminal-keys\[data-fade-end="true"\] \{ --hn-fade-r: 24px; \}/);
    expect(css).toMatch(/\.hn-terminal-keys \{[^}]*scroll-snap-type:\s*x proximity/);
    expect(css).toMatch(/\.hn-terminal-keys \{[^}]*scroll-padding-inline:\s*24px/);
    expect(css).toMatch(/\.hn-terminal-key \{[^}]*scroll-snap-align:\s*start/);
  });
});

// Tab terpilih harus terlihat: lewat panah, URL, atau tab di luar layar. jsdom tak menghitung tata letak,
// jadi kotak tiap tab dipasang sebagai fungsi posisi gulir strip (kotak strip di x=0, tab di x=offset).
describe("Tabs · tab terpilih digulir masuk strip", () => {
  const OFFSETS = [0, 100, 200, 300, 400];
  const place = (list: HTMLElement) => {
    layout(list, 500, 292, list.scrollLeft);
    list.getBoundingClientRect = () => ({ left: 0, right: 292, top: 0, bottom: 40, width: 292, height: 40, x: 0, y: 0, toJSON() {} });
    [...list.querySelectorAll<HTMLElement>('[role="tab"]')].forEach((tab, i) => {
      tab.getBoundingClientRect = () => ({ left: OFFSETS[i]! - list.scrollLeft, right: OFFSETS[i]! + 100 - list.scrollLeft,
        width: 100, top: 0, bottom: 40, height: 40, x: 0, y: 0, toJSON() {} });
    });
  };

  it("tab di kanan yang tertutup digulir hingga utuh, dengan 24 px lapang dari tepi", () => {
    const { rerender } = render(<Tabs tabs={TABS} value="Semua" onChange={() => {}} />);
    place(screen.getByRole("tablist"));
    rerender(<Tabs tabs={TABS} value="Spec" onChange={() => {}} />);
    // Spec ada di 200..300; kotak 292 px dan lapang 24 px → 300 > 268, jadi strip digeser ke 176.
    expect(screen.getByRole("tablist")).toHaveProperty("scrollLeft", 176);
  });

  it("tab terakhir (400..500) pun dibawa ke dalam kotak, tak tertinggal di luar", () => {
    const { rerender } = render(<Tabs tabs={TABS} value="Semua" onChange={() => {}} />);
    place(screen.getByRole("tablist"));
    rerender(<Tabs tabs={TABS} value="Selesai" onChange={() => {}} />);
    expect(screen.getByRole("tablist")).toHaveProperty("scrollLeft", 376);
  });

  it("tab di kiri yang tertutup digulir ke tepi dengan lapang 24 px", () => {
    const { rerender } = render(<Tabs tabs={TABS} value="Spec" onChange={() => {}} />);
    place(screen.getByRole("tablist"));
    layout(screen.getByRole("tablist"), 500, 292, 150);
    rerender(<Tabs tabs={TABS} value="Semua" onChange={() => {}} />);
    expect(screen.getByRole("tablist")).toHaveProperty("scrollLeft", 0);
  });

  it("tab yang sudah utuh terlihat tak menggeser strip", () => {
    const { rerender } = render(<Tabs tabs={TABS} value="Semua" onChange={() => {}} />);
    place(screen.getByRole("tablist"));
    layout(screen.getByRole("tablist"), 500, 292, 50);
    rerender(<Tabs tabs={TABS} value="Brainstorm" onChange={() => {}} />);
    // Brainstorm 100..200 ada di dalam 50..342 dengan lapang 24 px di tiap sisi: tak perlu digeser.
    expect(screen.getByRole("tablist")).toHaveProperty("scrollLeft", 50);
  });
});
