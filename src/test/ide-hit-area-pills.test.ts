// QA Chrome (#14, #15) · pil ref/tag Riwayat dan area sentuh IDE/Review. jsdom tak memuat stylesheet, jadi
// yang diikat di sini MEKANISME-nya (aturan CSS dan kelas di JSX), bukan piksel. Piksel dicek lewat Chrome
// headless: pil ref 16 px dengan ::after 24 px (44 px di pointer kasar), bukan bulatan 44 px seperti sebelumnya.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(import.meta.dirname, "..", rel), "utf8");
const ideCss = read("src/screens/styles/ide.css");
const fileTreeCss = read("src/screens/styles/file-tree.css");
const gitGraph = read("src/screens/GitGraph.tsx");

describe("pil ref & tag Riwayat: compact dengan elipsis, bukan bulatan 44 px", () => {
  it("setiap label ref dan tag dibungkus span yang memotong dengan elipsis", () => {
    expect(gitGraph).toMatch(/"hn-git-ref"\}>\s*<span className="hn-git-ref-text">\{ref\}<\/span>/);
    expect(gitGraph).toMatch(/className="hn-git-tag"><span className="hn-git-ref-text">⌂\{t\}<\/span>/);
    expect(ideCss).toMatch(/\.hn-git-ref-text\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  });

  it("pil memakai selector berspesifisitas (0,2,1) agar menang atas `button:not(…)` app.css di pointer kasar", () => {
    expect(ideCss).toMatch(/\.hn-git-main > button\.hn-git-ref,\s*\.hn-git-main > button\.hn-git-tag\s*\{[^}]*height:\s*16px/s);
    expect(ideCss).toMatch(/\.hn-git-main > button\.hn-git-ref::after,\s*\.hn-git-main > button\.hn-git-tag::after\s*\{[^}]*height:\s*24px/s);
  });

  it("pointer kasar/ponsel: area sentuh pil 44 px lewat ::after, tanpa membesarkan pil itu sendiri", () => {
    expect(ideCss).toMatch(/@media \(pointer: coarse\), \(max-width: 767px\)\s*\{[^}]*\.hn-git-main > button\.hn-git-ref::after[^}]*height:\s*var\(--touch-target\)/s);
  });
});

describe("target ≥24 px di pointer halus (WCAG 2.5.8)", () => {
  it('"Buka commit" (subject) ≥24 px, dan 44 px di pointer kasar', () => {
    // Subjek kini berada di `.hn-git-text` (display: contents di desktop), jadi selector-nya turunan, bukan anak langsung.
    expect(ideCss).toMatch(/\.hn-git-main \.hn-git-subject\s*\{\s*min-height:\s*24px/);
    expect(ideCss).toMatch(/\.hn-git-main \.hn-git-subject\s*\{\s*min-height:\s*var\(--touch-target\)/);
  });

  it("toggle List | Tree di IDE ≥24 px (ide.css) dan toggle Review + chip berkas ≥24 px (file-tree.css)", () => {
    expect(ideCss).toMatch(/\.hn-ide-view-toggle\s*\{[^}]*min-width:\s*24px[^}]*min-height:\s*24px/);
    expect(fileTreeCss).toMatch(/\.hn-ide-view-btn\s*\{[^}]*min-width:\s*24px[^}]*min-height:\s*24px/);
    expect(fileTreeCss).toMatch(/\.hn-ide-changed-row\s*\{\s*min-height:\s*24px/);
  });

  it("aturan baru tak memakai !important", () => {
    const added = ideCss.slice(ideCss.indexOf("Pil ref & target sentuh desktop")) + fileTreeCss.slice(fileTreeCss.indexOf("Target sentuh ≥24 px di pointer halus"));
    expect(added).not.toMatch(/!important/);
  });
});

// P2-3 · subjek di 390 px hanya 103 px (terukur): tanggal dipindah ke baris kecil di bawah subjek, dalam kolom
// teks yang sama, dan subjek membawa `title` berisi teks penuh. Lebar 140+ px terukur di Chrome headless
// (fixture build, 390 px, satu pil ref: 103 → 153 px); di sini dikunci mekanismenya.
describe("P2-3 · subjek Riwayat ≤640 px: kolom teks dan title penuh", () => {
  it("subjek dan tanggal kecil dibungkus satu kolom teks (tanggal tak dibuang)", () => {
    expect(gitGraph).toMatch(/<span className="hn-git-text">\s*<button[\s\S]*?<span className="hn-git-date-under">\{rel\(c\.at\)\}<\/span>\s*<\/span>/);
  });

  it("subjek membawa title berisi teks yang tampil (sumber potong ellipsis)", () => {
    expect(gitGraph).toMatch(/const subject = msgOpts\.emoji \? emojify\(c\.subject\) : c\.subject;/);
    expect(gitGraph).toMatch(/title=\{subject\}/);
  });

  it("di ≤640 px kolom teks mengisi sisa baris, subjek 24 px tinggi dan tanpa lantai 160/44 px", () => {
    expect(ideCss).toMatch(/\.hn-git-text\s*\{\s*display:\s*flex;\s*flex:\s*1 1 0%;\s*min-width:\s*0/);
    expect(ideCss).toMatch(/\.hn-git-main > \.hn-git-text > button\.hn-git-subject\s*\{\s*min-width:\s*0;\s*min-height:\s*24px/);
  });

  it("desktop tak berubah: kolom teks tak membuat kotak (display: contents) dan tanggal kecil tersembunyi", () => {
    expect(ideCss).toMatch(/\.hn-git-text\s*\{\s*display:\s*contents/);
    expect(ideCss).toMatch(/\.hn-git-date-under\s*\{\s*display:\s*none/);
  });
});
