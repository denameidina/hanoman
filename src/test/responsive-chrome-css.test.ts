// @vitest-environment node
// QA visual 2026-10 · P2/P1 (header ponsel, fokus palet, target sentuh checkbox/radio/file). jsdom tak
// memuat stylesheet dan tak menghitung tata letak, jadi yang diikat di sini adalah deklarasi CSS-nya.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(import.meta.dirname, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const css = read("../src/app.css");
const palette = read("../src/palette/palette.css");

// Isi blok aturan pertama yang selektornya tepat `selector` (tanpa kurung kurawal pembuka/penutup).
const body = (source: string, selector: string): string => {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`selektor tak ditemukan: ${selector}`);
  return source.slice(start + selector.length + 2, source.indexOf("}", start));
};

describe("header ponsel: dua baris, crumb satu baris", () => {
  const mobile = css.slice(css.indexOf("@media (max-width: 767px) {\n  .hn-shell-menu"));

  it("crumb dan judul dipotong satu baris dengan elipsis", () => {
    expect(mobile).toMatch(/\.hn-shell-crumb,\s*\.hn-shell-title \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  });

  it("pilihan project dan kotak cari layar turun ke baris sendiri, di atas barisan ikon", () => {
    expect(mobile).toMatch(/\.hn-shell-scope \{ flex: 1 1 100%; order: 1; \}/);
    expect(mobile).toMatch(/\.hn-shell-search \{ flex: 1 1 100%; width: 100%; order: 1; \}/);
  });

  it("judul di baris pertama bersama tombol menu (heading sisa lebar, bukan baris penuh)", () => {
    expect(mobile).toMatch(/\.hn-shell-heading \{ flex: 1 1 calc\(100% - 54px\); align-self: center; \}/);
  });
});

describe("fokus palet: satu indikator (pembungkus), tanpa outline ganda", () => {
  it("outline input di dalam kotak cari dimatikan dengan spesifisitas yang mengalahkan aturan global", () => {
    expect(palette).toMatch(/\.hn-palette-search input:focus-visible,\s*\.hn-palette-input:focus-visible \{ outline: none; \}/);
  });

  it("pembungkus memberi batas --border-focus dan ring saat fokus", () => {
    expect(palette).toMatch(/\.hn-palette-search:focus-within \{ border-color: var\(--border-focus\); box-shadow: var\(--ring\); \}/);
  });

  it("input teks lain (.hn-input-core) sudah mematikan outline-nya sendiri", () => {
    expect(css).toMatch(/\.hn-input-core:focus-visible,\s*\.hn-textarea-core:focus-visible \{\s*outline: none;\s*\}/);
  });
});

describe("checkbox dan radio mentah: kotak 16 px, area klik 24 px (desktop) dan 44 px (pointer kasar)", () => {
  const base = body(css, 'input[type="checkbox"],\ninput[type="radio"]');

  it("kotak digambar sendiri: appearance none, 16 px, padding 4 px sebagai area klik", () => {
    expect(base).toMatch(/appearance:\s*none/);
    expect(base).toMatch(/width:\s*16px/);
    expect(base).toMatch(/height:\s*16px/);
    expect(base).toMatch(/padding:\s*4px/);
  });

  it("padding transparan: latar dipotong ke content-box, jadi tak ada blok warna yang melebar", () => {
    expect(base).toMatch(/background-clip:\s*content-box/);
    expect(base).toMatch(/background-origin:\s*content-box/);
    expect(base).toMatch(/background-color:\s*transparent/);
  });

  it("terpilih: isi --accent dengan tanda centang/titik, bukan warna baru", () => {
    expect(css).toMatch(/input\[type="checkbox"\]:checked \{\s*background-image:/);
    expect(css).toMatch(/input\[type="radio"\]:checked \{\s*background-image:/);
    expect(css).toMatch(/linear-gradient\(var\(--accent\), var\(--accent\)\)/);
  });

  it("pointer kasar/ponsel: padding 14 px per sisi = 44 px", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse), (max-width: 767px) {\n  button:not"));
    expect(coarse).toMatch(/input\[type="checkbox"\], input\[type="radio"\] \{ padding: 14px; \}/);
  });

  it("tak lagi memakai min-width 24 px lama, yang tak membesarkan kontrol native", () => {
    expect(css).not.toMatch(/input\[type="checkbox"\], input\[type="radio"\] \{ min-width: 24px; min-height: 24px; \}/);
  });
});

describe("input file: tinggi tap minimum 24 px, 44 px di pointer kasar", () => {
  it("aturan dasar input[type=file] 24 px untuk semua pointer (batas WCAG 2.5.8)", () => {
    expect(css).toMatch(/input\[type="file"\] \{ min-height: 24px; \}/);
  });

  it("blok coarse menaikkannya ke 44 px", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse), (max-width: 767px) {\n  button:not"));
    expect(coarse).toMatch(/input\[type="file"\] \{ min-height: var\(--touch-target\); \}/);
  });
});
