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

describe("rail tablet: nama hub tampil di bawah ikon, item hub tanpa inline style", () => {
  const rail = css.slice(css.indexOf("@media (min-width: 768px) and (max-width: 1199px) {"));

  it("label hub tampil (block, teks kecil) di rail, bukan display:none", () => {
    expect(rail).toMatch(/\.hn-shell-sidebar \.hn-nav-label \{\s*display: block;/);
    expect(rail).not.toMatch(/\.hn-shell-sidebar \.hn-nav-label,\s*\.hn-shell-sidebar \.hn-nav-group-label/);
  });

  it("ikon di atas label; tinggi 44px tetap dari kelas dasar; lebar rail tetap dari --sidebar-w", () => {
    expect(rail).toMatch(/\.hn-shell-sidebar \.hn-nav-item \{ flex-direction: column;/);
    expect(css).toMatch(/\.hn-nav-item \{[^}]*min-height: 44px;/);
    expect(rail).toMatch(/\.hn-shell-sidebar \{ width: var\(--sidebar-w\);/);
  });

  it("hover lewat :hover dan tak menimpa item aktif (aria-current menang)", () => {
    expect(css).toMatch(/\.hn-nav-item\[data-interactive="true"\]:not\(\[aria-current="page"\]\):hover/);
    expect(css).toMatch(/\.hn-nav-item\[aria-current="page"\] \{[^}]*background: var\(--brass-100\)/);
  });

  it("HnHubItem tanpa inline style dan tanpa state hover React", () => {
    const shell = readFileSync(resolve(import.meta.dirname, "../src/ds/shell.tsx"), "utf8");
    const start = shell.indexOf("function HnHubItem(");
    const end = shell.indexOf("\n}\n", start);
    const fn = shell.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(fn).not.toMatch(/style=\{/);
    expect(fn).not.toMatch(/useState/);
    expect(fn).toMatch(/data-interactive=/);
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

// QA run3 · P2: desktop 1280×661 — "Pengaturan" tak terlihat, daftar hub meluap tanpa cue gulir (pet memakan ±147 px
// di footer sidebar). Ambang 760 px sama dengan PET_COMPACT_QUERY di HanomanPet.tsx (pet jadi chip di bawahnya).
describe("desktop pendek (≤ 760 px): sidebar muat 8 hub + footer; daftar yang meluap bercue", () => {
  const SHORT = "@media (min-width: 1200px) and (max-height: 760px) {";
  const short = css.slice(css.indexOf(SHORT), css.indexOf("\n}", css.indexOf(SHORT)));

  it("media query tepat di ambang 760 px dan lebar desktop 1200 px", () => {
    expect(css).toContain(SHORT);
  });

  it("jarak sidebar dirapatkan di rentang yang sama: wordmark, grup hub, dan footer pet", () => {
    expect(short).toMatch(/\.hn-shell-wordmark \{ padding-bottom: 12px; \}/);
    expect(short).toMatch(/\.hn-nav-group \+ \.hn-nav-group \{ margin-top: 10px; \}/);
    expect(short).toMatch(/\.hn-shell-dock \{ padding-top: 4px; \}/);
  });

  it("cue gulir daftar hub: gradasi mask di tepi yang masih menyimpan hub, hanya saat daftar meluap", () => {
    expect(css).toMatch(/\.hn-shell-nav\[data-cue-start="true"\],\s*\.hn-shell-nav\[data-cue-end="true"\] \{/);
    expect(css).toMatch(/mask-image: linear-gradient\(to bottom, transparent 0, #000 var\(--hn-cue-t\), #000 calc\(100% - var\(--hn-cue-b\)\), transparent 100%\);/);
    expect(css).toMatch(/\.hn-shell-nav\[data-cue-start="true"\] \{ --hn-cue-t: 16px; \}/);
    expect(css).toMatch(/\.hn-shell-nav\[data-cue-end="true"\] \{ --hn-cue-b: 16px; \}/);
  });

  it("footer sidebar (slot pet) tak pernah position: fixed — pet duduk di alur sidebar", () => {
    expect(body(css, ".hn-shell-dock")).not.toMatch(/fixed/);
    expect(short).not.toMatch(/fixed/);
  });
});

// QA run3 · P2 tablet 820 px: topbar /docs 207 px (crumb 4 baris), /overview /backlog /team 99 px (pil turun baris).
// Kontrak: judul+alat satu baris, crumb dan judul satu baris dengan elipsis, lencana memakai bentuk pendek.
describe("topbar tablet: satu baris judul+alat, crumb dan judul tak membungkus", () => {
  const TABLET = "@media (min-width: 768px) and (max-width: 1199px) {";
  const tablet = css.slice(css.indexOf(TABLET), css.indexOf("\n}\n", css.indexOf(TABLET)));

  it("crumb dan judul satu baris di semua tier: nowrap + elipsis, bukan membungkus", () => {
    expect(body(css, ".hn-shell-crumb")).toMatch(/white-space: nowrap;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
    expect(body(css, ".hn-shell-title")).toMatch(/white-space: nowrap;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
  });

  it("alat topbar tak membungkus: barisnya satu, dan topbar hanya menambah baris untuk baris kedua", () => {
    expect(tablet).toMatch(/\.hn-shell-topbar \{ flex-wrap: wrap; gap: 6px 16px; min-height: 0; padding-block: 8px; \}/);
    expect(tablet).toMatch(/\.hn-shell-tools \{ flex: 0 0 auto; flex-wrap: nowrap; gap: 6px; \}/);
    expect(tablet).toMatch(/\.hn-shell-heading \{ flex: 1 1 0; \}/);
  });

  it("baris kedua (project, cari, aksi) turun sendiri setinggi 40 px dan menggulir mendatar, bukan membungkus", () => {
    expect(tablet).toMatch(/\.hn-shell-subrow \{ order: 3; flex: 0 0 100%; height: 40px; margin: 0; min-width: 0; overflow-x: auto; \}/);
  });

  it("pilihan project di baris kedua dibatasi kolom dan namanya terpotong elipsis, bukan terpotong di tengah kata", () => {
    expect(tablet).toMatch(/\.hn-shell \.hn-shell-subrow \.hn-shell-scope \{ max-width: 100%; min-width: 0; \}/);
    expect(tablet).toMatch(/\.hn-shell \.hn-shell-subrow \.hn-shell-scope select \{[^}]*text-overflow: ellipsis;[^}]*\}/);
  });

  it("lencana update dan batas memakai bentuk pendek di tablet; kbd ⌘K disembunyikan (tombol ikon)", () => {
    expect(tablet).toMatch(/\.hn-topbar-label \{ display: none; \}/);
    expect(tablet).toMatch(/\.hn-topbar-label-short \{ display: inline; \}/);
    expect(tablet).toMatch(/\.hn-shell \.hn-shell-cmdk \.hn-kbd \{ display: none; \}/);
  });
});

// QA Chrome run4 · P2 desktop 1280: /review memuat select project + "Kembali" di baris judul, alat topbar membungkus
// (avatar turun ke y=44) dan topbar jadi 79 px, sedangkan layar lain 56 px. Kontrak: alat tak pernah membungkus di tier
// mana pun; yang menyusut adalah judul dan baris kedua, dengan elipsis.
describe("topbar desktop: alat tak membungkus di tier mana pun, topbar tetap 56 px", () => {
  const toolRules = [...css.matchAll(/^\s*\.hn-shell-tools \{([^}]*)\}/gm)].map((m) => m[1]);

  it("aturan alat ada di tiap tier (desktop, tablet, ponsel)", () => {
    expect(toolRules.length).toBeGreaterThanOrEqual(3);
  });

  it("tak satu pun aturan alat memuat flex-wrap: wrap", () => {
    for (const rule of toolRules) expect(rule).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it("bawaan desktop: alat nowrap dan tak menyusut (lebarnya isi), judul/baris kedua yang menyusut", () => {
    expect(toolRules[0]).toMatch(/flex:\s*0 0 auto;/);
    expect(toolRules[0]).toMatch(/flex-wrap:\s*nowrap;/);
    expect(body(css, ".hn-shell-topbar")).not.toMatch(/flex-wrap:\s*wrap/);
    expect(body(css, ".hn-shell-subrow")).toMatch(/min-width: 0;/);
    expect(css).toMatch(/\.hn-shell-subrow > button \{ flex: 0 0 auto; white-space: nowrap; \}/);
  });
});
