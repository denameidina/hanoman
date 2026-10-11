// QA visual 2026-10 · P1: pet Hanoman menutupi kontrol di tepi bawah. Lajur pet kini memesan ruangnya
// sendiri: HanomanPet menerbitkan `--pet-h` di <html>, dan `.hn-shell-main` memakai variabel itu sebagai
// padding-bawah, sehingga kontrol terbawah bisa digulir di atas pet. Test ini mengikat variabelnya (DOM)
// dan mekanisme CSS yang memakainya (stylesheet, karena jsdom tak memuat CSS dan tak menghitung tata letak).
import { eventsStub } from "./helpers/events-stub";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HanomanPet } from "../src/screens/HanomanPet";
import { PET_HIDDEN_KEY } from "../src/screens/pet-state";
import { PET_MANIFEST } from "../src/screens/pet-sprite";
import { MOBILE_QUERY } from "../src/ds/responsive";

vi.mock("../src/api/events", () => ({
  ...eventsStub,
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => { },
}));

// Tinggi sel = tinggi sprite pada tier, diskalakan dari character.h manifest (sama dengan HanomanPet).
const cellHFor = (characterHeight: number) =>
  Math.round(PET_MANIFEST.cell.h * (characterHeight / PET_MANIFEST.character.h));
const DESKTOP_H = `${cellHFor(112)}px`;   // tablet & desktop
const MOBILE_H = `${cellHFor(96)}px`;     // < 768 px
const REVEAL_H = "66px";                   // tombol bangkitkan: 22 px dari tepi + 44 px

function mockViewport(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: mobile && query === MOBILE_QUERY, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}

const reserved = () => document.documentElement.style.getPropertyValue("--pet-h");

beforeEach(() => {
  localStorage.clear();
  mockViewport(false);
  // Pet dipasang setelah idle; di test idle dijalankan langsung agar render sinkron.
  window.requestIdleCallback = ((cb: () => void) => { cb(); return 0; }) as unknown as typeof window.requestIdleCallback;
  document.documentElement.style.removeProperty("--pet-h");
});
afterEach(() => {
  document.documentElement.style.removeProperty("--pet-h");
});

describe("lajur pet memesan ruang di shell (--pet-h)", () => {
  it("tablet/desktop: tinggi sel sprite di <html>", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(reserved()).toBe(DESKTOP_H);
  });

  it("ponsel: sprite lebih kecil (96 px karakter), jadi ruang yang dipesan ikut mengecil", () => {
    mockViewport(true);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(reserved()).toBe(MOBILE_H);
    expect(MOBILE_H).not.toBe(DESKTOP_H);
  });

  it("pet disembunyikan: hanya tombol bangkitkan yang perlu ruang (66 px)", () => {
    localStorage.setItem(PET_HIDDEN_KEY, "1");
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(reserved()).toBe(REVEAL_H);
  });

  it("melepas pet mengembalikan variabel ke bawaan CSS (tak ada sisa)", () => {
    const view = render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(reserved()).toBe(DESKTOP_H);
    act(() => view.unmount());
    expect(reserved()).toBe("");
  });
});

describe("kontrak CSS: padding-bawah shell dan satu scroller", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector: string): string => {
    const at = css.indexOf(selector);
    if (at < 0) throw new Error(`selektor tak ada: ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };

  it("bawaan --pet-h nol di :root (layar tanpa pet tak memesan ruang)", () => {
    expect(block(":root {")).toMatch(/--pet-h:\s*0px/);
  });

  it(".hn-shell-main memesan --pet-h + safe-bottom di bawah scroller", () => {
    expect(block(".hn-shell-main {")).toMatch(/padding-bottom:\s*calc\(var\(--pet-h\)\s*\+\s*var\(--safe-bottom\)\)/);
  });

  it("bar keputusan sticky dan bar aksi QA ponsel ikut naik di atas lajur pet", () => {
    expect(css).toMatch(/\.hn-shell-main \.hn-review-decide,\s*\.hn-shell-main \.hn-triage-decision \{ bottom: calc\(var\(--pet-h\) \+ var\(--safe-bottom\)\)/);
    expect(css).toMatch(/\.hn-shell \.hn-qa-bar-actions \{ bottom: calc\(var\(--pet-h\) \+ var\(--safe-bottom\)\)/);
  });

  it("#root ber-position relative: elemen absolut tanpa induk ber-posisi tak lagi menambah tinggi dokumen", () => {
    expect(block("#root {")).toMatch(/position:\s*relative/);
  });

  it("dokumen tak ikut menggulir: satu-satunya scroller adalah .hn-shell-main", () => {
    expect(block("html, body {")).toMatch(/overflow:\s*hidden/);
  });
});
