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

// QA visual 2026-10 · P2 (header ponsel terlalu tinggi: 161–211 px). Kontrak baru: SATU baris 44 px di dalam
// padding 6 px atas-bawah (topbar 56 px), dan baris kedua 40 px hanya bila layar memakainya.
describe("header ponsel: satu baris 56 px, baris kedua 40 px hanya bila dipakai", () => {
  const mobile = css.slice(css.indexOf("@media (max-width: 767px) {\n  .hn-shell-menu"));

  it("topbar tak punya min-height dan padding bawah 6 px: satu baris 44 px di dalam 56 px", () => {
    expect(mobile).toMatch(/\.hn-shell-topbar \{[^}]*min-height: 0;[^}]*padding: calc\(6px \+ var\(--safe-top\)\) var\(--page-gutter-x\) 6px;/);
  });

  it("urutan satu baris: menu, judul (sisa lebar), alat; baris kedua di urutan terakhir", () => {
    expect(mobile).toMatch(/\.hn-shell-menu \{ order: 0; \}/);
    expect(mobile).toMatch(/\.hn-shell-heading \{ order: 1; flex: 1 1 0;/);
    expect(mobile).toMatch(/\.hn-shell-tools \{ order: 2; flex: 0 0 auto;/);
    expect(mobile).toMatch(/\.hn-shell-subrow \{\s*order: 3; flex: 0 0 100%;[^}]*height: 40px;/);
  });

  it("alat ponsel: lencana sekunder disembunyikan, kotak cari jadi ikon 44 px tanpa petunjuk ⌘K", () => {
    expect(mobile).toMatch(/\.hn-topbar-extra \{ display: none; \}/);
    expect(mobile).toMatch(/\.hn-shell \.hn-shell-cmdk \{ width: var\(--touch-target\);/);
    expect(mobile).toMatch(/\.hn-shell \.hn-shell-cmdk \.hn-kbd \{ display: none; \}/);
  });

  it("breadcrumb (deskripsi layar) disembunyikan di ponsel; judul dipotong satu baris dengan elipsis", () => {
    expect(mobile).toMatch(/\.hn-shell-crumb \{ display: none; \}/);
    expect(mobile).toMatch(/\.hn-shell-title \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  });

  it("desktop: baris kedua duduk di kiri kluster alat tanpa mengubah urutan kluster", () => {
    expect(css).toMatch(/\.hn-shell-subrow \{ display: flex; align-items: center; gap: 10px; min-width: 0; margin-left: auto; \}/);
    expect(css).toMatch(/\.hn-shell-subrow \+ \.hn-shell-tools \{ margin-left: 0; \}/);
  });

  it("tab hub satu baris yang menggulir: wadahnya tak lebih lebar dari kolom", () => {
    expect(css).toMatch(/\.hn-section-tabs \{ min-width: 0; max-width: 100%;/);
    expect(css).toMatch(/\.hn-section-tabs > \.hn-tabs \{ max-width: 100%; \}/);
  });
});

// C · rail tablet: badge hitungan di nav tak boleh membuat ikon menyusut (svg 17 → 7 px).
describe("rail tablet: ikon nav tak menyusut, badge absolut di pojok ikon", () => {
  const rail = css.slice(css.indexOf("@media (min-width: 768px) and (max-width: 1199px) {"));

  it("svg ikon nav tidak menyusut sebagai flex item", () => {
    expect(css).toMatch(/\.hn-shell-nav svg \{ flex: 0 0 auto; \}/);
  });

  it("badge di rail absolut di pojok kanan-atas tombol, bukan flex item", () => {
    expect(rail).toMatch(/\.hn-shell-sidebar \.hn-nav-badge \{\s*position: absolute;/);
    expect(rail).toMatch(/\.hn-shell-sidebar \.hn-nav-item \{ position: relative; \}/);
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
