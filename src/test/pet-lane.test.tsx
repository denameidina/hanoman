// QA visual 2026-10 · P1/P2: pet Hanoman menutupi kontrol di tepi bawah. Desain sekarang: pet duduk DI ALUR
// layout — footer sidebar di desktop, lajur di bawah <main> di tablet/ponsel — dan tak pernah melayang
// dengan `position: fixed`. `--pet-h` hanya dipublikasikan untuk bar fixed di ponsel (aksi QA). Test ini
// mengikat variabelnya (DOM), root-nya yang relatif, dan kontrak CSS yang menjaga tata letaknya (stylesheet,
// karena jsdom tak memuat CSS dan tak menghitung tata letak).
import { eventsStub } from "./helpers/events-stub";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HanomanPet } from "../src/screens/HanomanPet";
import { PET_HIDDEN_KEY } from "../src/screens/pet-state";
import { PET_MANIFEST } from "../src/screens/pet-sprite";
import { MOBILE_QUERY, TABLET_QUERY } from "../src/ds/responsive";

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

// Tier dari matchMedia (ds/responsive.tsx): tanpa query yang cocok = desktop.
function mockTier(tier: "mobile" | "tablet" | "desktop"): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: (tier === "mobile" && query === MOBILE_QUERY) || (tier === "tablet" && query === TABLET_QUERY),
      media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}

const reserved = () => document.documentElement.style.getPropertyValue("--pet-h");

beforeEach(() => {
  localStorage.clear();
  mockTier("desktop");
  // Pet dipasang setelah idle; di test idle dijalankan langsung agar render sinkron.
  window.requestIdleCallback = ((cb: () => void) => { cb(); return 0; }) as unknown as typeof window.requestIdleCallback;
  document.documentElement.style.removeProperty("--pet-h");
});
afterEach(() => {
  document.documentElement.style.removeProperty("--pet-h");
});

describe("--pet-h: tinggi lajur untuk bar fixed ponsel", () => {
  it("desktop: tinggi sel sprite di <html>", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(reserved()).toBe(DESKTOP_H);
  });

  it("ponsel: sprite lebih kecil (96 px karakter), jadi ruang yang dipesan ikut mengecil", () => {
    mockTier("mobile");
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

describe("root pet berada di alur layout, bukan overlay fixed", () => {
  it("root relatif, selebar slotnya, tak menangkap pointer; hanya tombol kaki yang aktif", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.getByTestId("pet-root")).toHaveStyle({ position: "relative", width: "100%", pointerEvents: "none" });
    expect(screen.getByTestId("pet-root").style.position).not.toBe("fixed");
  });

  it("pet disembunyikan: root setinggi chip (66 px), bukan sel sprite", () => {
    localStorage.setItem(PET_HIDDEN_KEY, "1");
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.getByTestId("pet-root")).toHaveStyle({ height: REVEAL_H });
  });
});

describe("kontrak CSS: lajur pet ada di alur layout dan area gulir berakhir di atasnya", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector: string): string => {
    const at = css.indexOf(selector);
    if (at < 0) throw new Error(`selektor tak ada: ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };

  it("bawaan --pet-h nol di :root (layar tanpa pet tak memesan ruang)", () => {
    expect(block(":root {")).toMatch(/--pet-h:\s*0px/);
  });

  it(".hn-shell-main tak lagi memesan ruang pet: pet berada di alur, bukan di atas scroller", () => {
    expect(block(".hn-shell-main {")).not.toMatch(/--pet-h/);
  });

  it("slot sidebar (desktop) dan lajur (tablet/ponsel) kosong = tak memesan ruang sama sekali", () => {
    expect(css).toMatch(/\.hn-shell-dock:empty \{ display: none; \}/);
    expect(css).toMatch(/\.hn-shell-lane:empty \{ display: none; \}/);
    expect(css).toMatch(/\.hn-shell-lane:not\(:empty\) \{ padding-bottom: var\(--safe-bottom\); \}/);
  });

  it("footer sidebar mendorong pet ke dasar lewat margin-top auto, di bawah daftar hub", () => {
    expect(block(".hn-shell-dock {")).toMatch(/margin-top:\s*auto/);
  });

  it("aksi QA ponsel (fixed) tetap naik di atas lajur pet lewat --pet-h", () => {
    expect(css).toMatch(/\.hn-shell \.hn-qa-bar-actions \{ bottom: calc\(var\(--pet-h\) \+ var\(--safe-bottom\)\)/);
  });

  it("#root ber-position relative: elemen absolut tanpa induk ber-posisi tak lagi menambah tinggi dokumen", () => {
    expect(block("#root {")).toMatch(/position:\s*relative/);
  });

  it("dokumen tak ikut menggulir: satu-satunya scroller adalah .hn-shell-main", () => {
    expect(block("html, body {")).toMatch(/overflow:\s*hidden/);
  });
});
