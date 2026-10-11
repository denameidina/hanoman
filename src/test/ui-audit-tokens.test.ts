// @vitest-environment node
// Audit UI/UX 2026-10 · Fase 1A. Kontras dihitung dari nilai token yang BERLAKU (rantai `var()`
// diikuti sampai hex), bukan dari namanya. Rumus WCAG 2.x sama dengan nav-pending-badge.test.tsx.
// Bagian kedua mengunci kontrak CSS/HTML yang diubah: viewport, preconnect, input checkbox/radio,
// tombol primer, dan tombol keluar Dalang di ponsel.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(import.meta.dirname, rel), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const colorSrc = stripComments(read("../src/ds/tokens/colors.css"));
const tokenMap = new Map<string, string>();
for (const m of colorSrc.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokenMap.set(m[1]!, m[2]!.trim());

const color = (name: string, depth = 0): string => {
  const value = tokenMap.get(name);
  if (value === undefined) throw new Error(`token tak terdefinisi: ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (!ref) return value;
  if (depth > 5) throw new Error(`rantai token terlalu dalam: ${name}`);
  return color(ref[1]!, depth + 1);
};

const luminance = (hex: string): number => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const SURFACES = ["--surface-card", "--surface-page", "--surface-panel"];

describe("kontras teks: WCAG AA 1.4.3 (>= 4,5:1) di setiap permukaan terang", () => {
  for (const text of ["--text-strong", "--text-body", "--text-muted", "--text-subtle", "--text-link",
    "--status-ok", "--status-warn", "--status-err"]) {
    it(`${text} lolos di kartu, page, dan panel`, () => {
      for (const surface of SURFACES) {
        expect(contrast(color(text), color(surface)), `${text} di ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("teks warning lolos di atas tint warning (isi badge)", () => {
    expect(contrast(color("--status-warn"), color("--status-warn-tint"))).toBeGreaterThanOrEqual(4.5);
  });

  it("teks tombol primer (--accent-on) lolos di atas --accent", () => {
    expect(contrast(color("--accent-on"), color("--accent"))).toBeGreaterThanOrEqual(4.5);
  });

  // Kontrol negatif: nilai lama yang dikirim sebelum audit. Tanpa ini, lolosnya test di atas bisa
  // berarti rumusnya salah, bukan warnanya benar.
  it("nilai lama memang gagal gerbang yang sama", () => {
    expect(contrast("#90826c", color("--surface-card"))).toBeLessThan(4.5);   // ink-400 sebagai teks
    expect(contrast(color("--amber-600"), color("--surface-card"))).toBeLessThan(4.5);
  });
});

describe("kontras batas kontrol: WCAG 1.4.11 (>= 3:1)", () => {
  it("--border-strong (batas input, checkbox, tombol secondary) lolos di tiap permukaan", () => {
    for (const surface of SURFACES) {
      expect(contrast(color("--border-strong"), color(surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it("--border-focus lolos di permukaan terang dan panel Dalang gelap", () => {
    for (const surface of [...SURFACES, "--term-bg"]) {
      expect(contrast(color("--border-focus"), color(surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it("kontrol negatif: bone-400 lama memang di bawah 3:1", () => {
    expect(contrast(color("--bone-400"), color("--surface-card"))).toBeLessThan(3);
  });
});

describe("footer Dalang (.hn-dlg-foot) lolos 4,5:1 di kedua latar gelapnya", () => {
  const css = stripComments(read("../src/app.css"));
  const footColor = /\.hn-dlg-foot\s*\{[^}]*color:\s*var\((--[\w-]+)\)/.exec(css)?.[1];

  it("warna footer terbaca dari app.css", () => {
    expect(footColor).toBe("--brass-500");
  });

  it("rasio >= 4,5:1 di term-bg dan di #0d0b07", () => {
    for (const bg of [color("--term-bg"), "#0d0b07"]) {
      expect(contrast(color(footColor!), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("kontrak CSS dan HTML hasil audit", () => {
  const css = stripComments(read("../src/app.css"));
  const html = read("../index.html");

  it("viewport mengaktifkan safe-area (viewport-fit=cover) agar token --safe-* hidup", () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
  });

  it("font Google Fonts di-preconnect (origin CSS dan origin berkas font)", () => {
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" />');
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
  });

  it("aturan 44px pointer kasar tidak mengenai checkbox/radio mentah", () => {
    expect(css).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), select, textarea \{/);
    expect(css).not.toMatch(/(^|\n)\s*input, select, textarea \{/);
    expect(css).toMatch(/input\[type="checkbox"\], input\[type="radio"\] \{ min-width: 24px; min-height: 24px; \}/);
  });

  it("tombol primer tak lagi di-override putih (danger memberi #fff sendiri di inline style)", () => {
    expect(css).not.toMatch(/--accent-on:\s*#fff/);
  });

  it("Dalang: tombol keluar tetap tampil di ponsel; hanya chip tanggal/jam yang disembunyikan", () => {
    expect(css).not.toMatch(/\.hn-dlg-chips\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.hn-dlg-chip\s*\{\s*display:\s*none;?\s*\}/);
  });

  it("Dalang: tombol keluar 44×44 di pointer kasar dan di ponsel", () => {
    expect(css).toMatch(
      /@media \(pointer: coarse\), \(max-width: 767px\) \{\s*\.hn-dlg-exit \{ width: var\(--touch-target\); height: var\(--touch-target\); \}/,
    );
  });

  it("Dalang: tak ada teks di bawah 11px", () => {
    const sizes: number[] = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selector!.includes(".hn-dlg-")) continue;
      for (const m of body!.matchAll(/font-size:\s*([\d.]+)px/g)) sizes.push(Number(m[1]));
    }
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });
});
