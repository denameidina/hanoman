// Audit UI/UX 2026-10 · Fase 2A — kontrak statis untuk CSS dan teks DS. jsdom tak memuat stylesheet
// dan tak menghitung kontras, jadi yang diikat di sini adalah MEKANISMENYA: tak ada selektor atribut
// inline yang tersisa, utilitas `hn-grow` ada, dan warna teks DS tak memakai token fill.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src");
const css = readFileSync(join(SRC, "app.css"), "utf8");
// Komentar boleh menyebut selektornya (sebagai sejarah); yang diikat adalah kode CSS-nya.
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
const dsDir = join(SRC, "ds/components");

describe("app.css · layout tanpa selektor atribut inline", () => {
  it("tidak menyisakan [style*=…] di kode CSS — anak ber-flex ditandai kelas hn-grow", () => {
    expect(code).not.toMatch(/\[style\*=/);
  });

  it("aturan mobile untuk baris padat membaca kelas hn-grow", () => {
    expect(css).toMatch(/\.hn-dense-row > \.hn-grow\s*\{\s*min-width:\s*min\(220px,\s*100%\)/);
  });

  it("hn-grow setara inline flex: 1 (1 1 0%), jadi menambah kelas tak mengubah tampilan", () => {
    expect(css).toMatch(/\.hn-grow\s*\{\s*flex:\s*1 1 0%/);
  });

  it("skeleton tak beranimasi di prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.hn-skeleton\s*\{\s*animation:\s*none/);
  });

  it("kelas pulse titik status juga dimatikan di prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.hn-status-dot-pulse\s*\{\s*animation:\s*none/);
  });

  it("header Card tak lagi memakai !important untuk align-items (susunan dasar di kelas)", () => {
    expect(css).not.toMatch(/\.hn-card-header\s*\{[^}]*!important/);
  });
});

describe("komponen DS · warna teks tak memakai token fill", () => {
  // --amber-600 dan --brass-600 hanya lolos 3:1 di atas tint-nya. Keduanya boleh jadi fill titik/batas,
  // tak pernah warna teks.
  const FILL_AS_TEXT = /(?:color|text|fg)\s*:\s*"var\(--(?:amber|brass)-600\)"/;
  const files = readdirSync(dsDir).filter((f) => f.endsWith(".tsx"));

  it.each(files)("%s tidak memakai amber-600/brass-600 sebagai teks", (file) => {
    const src = readFileSync(join(dsDir, file), "utf8");
    expect(src).not.toMatch(FILL_AS_TEXT);
  });

  it("ui.tsx (tab count) memakai brass-700 sebagai teks di atas brass-100", () => {
    const src = readFileSync(join(dsDir, "ui.tsx"), "utf8");
    expect(src).toMatch(/color: on \? "var\(--brass-700\)"/);
    expect(src).not.toMatch(/color: on \? "var\(--accent-hover\)"/);
  });
});

describe("menu aksi (.hn-overflow-item*) · satu definisi, di ui.css", () => {
  // Blok duplikat di app.css sudah dicabut (Z11). Dua salinan berarti dua sumber kebenaran untuk fokus
  // dan hover, dan urutan pemuatan menentukan mana yang menang.
  it("app.css tak lagi mendefinisikan .hn-overflow-item", () => {
    expect(code).not.toMatch(/\.hn-overflow-item/);
  });

  it("ui.css mendefinisikannya dan ui.tsx mengimpor ui.css (satu-satunya jalur pemuatan)", () => {
    const uiCss = readFileSync(join(dsDir, "ui.css"), "utf8");
    expect(uiCss).toMatch(/\.hn-overflow-item\s*\{/);
    expect(uiCss).toMatch(/\.hn-overflow-item:focus-visible\s*\{\s*outline:\s*2px solid var\(--border-focus\)/);
    expect(readFileSync(join(dsDir, "ui.tsx"), "utf8")).toMatch(/import "\.\/ui\.css";/);
  });

  // Di subbaris ponsel app.css memberi tombol 40 px dengan (0,2,1), dan itu mengalahkan `.hn-overflow-item`
  // (0,1,0): item "Hapus project…" terukur 40 px di 390. Aturan penguncinya harus lebih spesifik: (0,3,0).
  it("item menu di subbaris ponsel tetap 44 px: (0,3,0) ui.css mengalahkan (0,2,1) app.css", () => {
    const uiCss = readFileSync(join(dsDir, "ui.css"), "utf8");
    expect(css).toMatch(/\.hn-shell \.hn-shell-subrow button,\s*\.hn-shell \.hn-shell-subrow input\s*\{\s*min-height:\s*40px/);
    expect(uiCss).toMatch(/\.hn-shell \.hn-shell-subrow \.hn-overflow-item\s*\{\s*min-height:\s*var\(--touch-target\)/);
    expect(uiCss).not.toMatch(/!important/);
  });
});
