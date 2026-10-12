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
    expect(ideCss).toMatch(/\.hn-git-main > button\.hn-git-subject\s*\{\s*min-height:\s*24px/);
    expect(ideCss).toMatch(/\.hn-git-main > button\.hn-git-subject\s*\{\s*min-height:\s*var\(--touch-target\)/);
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
