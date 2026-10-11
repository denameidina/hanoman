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
});
