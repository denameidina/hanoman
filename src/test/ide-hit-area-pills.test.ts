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
    expect(ideCss).toMatch(/\.hn-git-refs > button\.hn-git-ref,\s*\.hn-git-refs > button\.hn-git-tag\s*\{[^}]*height:\s*16px/s);
    expect(ideCss).toMatch(/\.hn-git-refs > button\.hn-git-ref::after,\s*\.hn-git-refs > button\.hn-git-tag::after\s*\{[^}]*height:\s*24px/s);
  });

  it("pointer kasar/ponsel: area sentuh pil 44 px lewat ::after, tanpa membesarkan pil itu sendiri", () => {
    expect(ideCss).toMatch(/@media \(pointer: coarse\), \(max-width: 767px\)\s*\{[^}]*\.hn-git-refs > button\.hn-git-ref::after[^}]*height:\s*var\(--touch-target\)/s);
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

// P2-3 · subjek di 390 px hanya 103 px (terukur) saat pil ref, merge, dan subjek berbagi satu baris. Di ≤640 px
// susunannya kini dua baris: subjek + tanggal (18 px), lalu pil ref + merge (26 px) = 44 px = --row-h. Subjek tak
// lagi berbagi lebar dengan pil. Lebar ≥140 px di 390 px dengan dua/tiga ref, merge atau tidak, terukur di Chrome
// headless (fixture build); di sini dikunci mekanismenya. Subjek membawa `title` berisi teks penuh.
describe("P2-3 · Riwayat ≤640 px: subjek di baris 1, pil di baris 2, tanggal tetap terlihat", () => {
  it("subjek dan tanggal kecil dibungkus satu kolom teks (tanggal tak dibuang)", () => {
    expect(gitGraph).toMatch(/<span className="hn-git-text">\s*<button[\s\S]*?<span className="hn-git-date-under">\{rel\(c\.at\)\}<\/span>\s*<\/span>/);
  });

  it("pil ref, tag, dan merge dibungkus satu `.hn-git-refs` yang tertutup sebelum kolom teks subjek", () => {
    const open = gitGraph.indexOf('<span className="hn-git-refs">');
    const textAt = gitGraph.indexOf('<span className="hn-git-text">');
    expect(open).toBeGreaterThan(-1);
    expect(textAt).toBeGreaterThan(open);
    const refs = gitGraph.slice(open, textAt);
    expect(refs).toMatch(/className=\{isHead && ref === current \? "hn-git-ref hn-git-ref--head" : "hn-git-ref"\}/);
    expect(refs).toMatch(/className="hn-git-tag"/);
    expect(refs).toMatch(/className="hn-git-merge">merge<\/span>\}\s*<\/span>\s*\{\/\*/);
  });

  it("subjek membawa title berisi teks yang tampil (sumber potong ellipsis)", () => {
    expect(gitGraph).toMatch(/const subject = msgOpts\.emoji \? emojify\(c\.subject\) : c\.subject;/);
    expect(gitGraph).toMatch(/title=\{subject\}/);
  });

  it("di ≤640 px: baris kolom 18 px (subjek + tanggal), baris pil 26 px, dan tanpa lantai 160/44 px", () => {
    const narrow = ideCss.slice(ideCss.indexOf(".hn-git-wt-gap"), ideCss.indexOf(".hn-git-uncommitted {"));
    expect(narrow).toMatch(/\.hn-git-main\s*\{\s*flex-direction:\s*column;\s*align-items:\s*stretch/);
    expect(narrow).toMatch(/\.hn-git-text\s*\{\s*display:\s*flex;[^}]*height:\s*18px;[^}]*order:\s*-1/);
    expect(narrow).toMatch(/\.hn-git-main > \.hn-git-text > button\.hn-git-subject\s*\{\s*flex:\s*1 1 0%;\s*min-width:\s*0;\s*min-height:\s*0;\s*height:\s*18px/);
    expect(narrow).toMatch(/\.hn-git-refs\s*\{\s*display:\s*flex;[^}]*height:\s*26px/);
    // Blok pil ≤640 (72 px, boleh menyusut) ada di bawah aturan pil dasar, jadi dicek di seluruh berkas.
    expect(ideCss).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.hn-git-refs > button\.hn-git-ref,\s*\.hn-git-refs > button\.hn-git-tag\s*\{\s*max-width:\s*72px;\s*flex:\s*0 1 auto/);
  });

  it("desktop tak berubah: kolom teks dan pembungkus pil tak membuat kotak (display: contents), tanggal kecil tersembunyi", () => {
    expect(ideCss).toMatch(/\.hn-git-text\s*\{\s*display:\s*contents/);
    expect(ideCss).toMatch(/\.hn-git-refs\s*\{\s*display:\s*contents/);
    expect(ideCss).toMatch(/\.hn-git-date-under\s*\{\s*display:\s*none/);
  });

  it("tak ada !important baru di graf Riwayat (ide.css dan ui.css)", () => {
    expect(ideCss).not.toMatch(/!important/);
    expect(read("src/ds/components/ui.css")).not.toMatch(/!important/);
  });
});
