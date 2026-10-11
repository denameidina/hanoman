import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Audit UI/UX 2026-10 · perbaikan QA mobile (Backlog, Triase, Help Center publik). jsdom tak memuat
// stylesheet, jadi kontraknya dikunci di sumber CSS: kelas, selektor, dan nilai yang menentukan layout.
// Bukti visual sungguhan tetap lewat screenshot QA.

const read = (rel: string) => readFileSync(resolve(import.meta.dirname, "../src", rel), "utf8");

/** Isi blok at-rule pertama yang diawali `head` (mis. `@media (max-width: 767px)`), brace-matched. */
function atBlock(src: string, head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`at-rule tak ditemukan: ${head}`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`at-rule tak tertutup: ${head}`);
}

/** Deklarasi satu selektor persis (bukan substring), di dalam sumber atau blok yang diberikan. */
function decl(src: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`selektor tak ditemukan: ${selector}`);
  return m[1]!.replace(/\s+/g, " ").trim();
}

describe("Backlog · mobile tanpa scroller bersarang (QA P1/P2)", () => {
  const css = read("screens/styles/backlog.css");
  const mobile = atBlock(css, "@media (max-width: 767px)");

  it("daftar di mobile tak membuat scroller sendiri: overflow visible, tanpa tinggi tetap", () => {
    const rule = decl(mobile, ".hn-bl-list-scroll");
    expect(rule).toMatch(/overflow:\s*visible/);
    expect(rule).toMatch(/min-height:\s*auto/);
    expect(rule).not.toMatch(/overflow-y:\s*auto/);
    expect(rule).not.toMatch(/height:\s*\d/);
  });

  it("body dan layar tak lagi menahan tinggi (min-height 0 hanya di desktop)", () => {
    expect(decl(mobile, ".hn-bl-body")).toMatch(/min-height:\s*auto/);
    expect(decl(mobile, ".hn-bl-screen")).toMatch(/min-height:\s*auto/);
  });

  it("desktop tetap memakai daftar yang menggulir sendiri", () => {
    expect(decl(css, ".hn-bl-list-scroll")).toMatch(/overflow-y:\s*auto/);
  });

  it("tab tahap membungkus di mobile, tidak digulir mendatar (tak ada 'Dikerja…' terpotong)", () => {
    const rule = decl(mobile, ".hn-bl-screen .hn-bl-stage-tabs");
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
    expect(rule).toMatch(/overflow:\s*visible/);
  });
});

describe("Triase · baris dua tingkat saat panel daftar sempit (QA P2)", () => {
  const css = read("screens/styles/triage.css");
  const mobile = atBlock(css, "@container triage-list (max-width: 899px)");

  it("panel daftar mendeklarasikan container yang diuji (lebar, bukan viewport)", () => {
    expect(decl(css, ".hn-triage-list-panel")).toMatch(/container:\s*triage-list\s*\/\s*inline-size/);
  });

  it("judul dan meta mengisi lebar penuh; judul clamp 2 baris", () => {
    expect(decl(mobile, ".hn-triage-scroll .hn-row-main")).toMatch(/flex-direction:\s*column/);
    const title = decl(mobile, ".hn-triage-scroll .hn-triage-title");
    expect(title).toMatch(/flex:\s*1 1 100%/);
    expect(title).toMatch(/white-space:\s*normal/);
    expect(title).toMatch(/-webkit-line-clamp:\s*2/);
    expect(decl(mobile, ".hn-triage-scroll .hn-triage-meta")).toMatch(/white-space:\s*normal/);
  });

  it("pil status dan judul membungkus; aksi Terima/Tolak punya baris sendiri, checkbox di kiri", () => {
    expect(decl(mobile, ".hn-triage-scroll .hn-triage-title-line")).toMatch(/flex-wrap:\s*wrap/);
    expect(decl(mobile, ".hn-triage-scroll .hn-row-actions")).toMatch(/width:\s*100%/);
    expect(decl(mobile, ".hn-triage-scroll .hn-triage-check")).toMatch(/margin-right:\s*auto/);
  });

  it("checkbox ber-hit-area kotak sentuh (pembungkus label, cursor pointer)", () => {
    expect(decl(css, ".hn-triage-check")).toMatch(/cursor:\s*pointer/);
  });
});

describe("Help Center publik · jarak label-kontrol dan kontrol berkas (QA P2)", () => {
  const css = read("portal/portal.css");
  const coarse = atBlock(css, "@media (pointer: coarse), (max-width: 767px)");

  it("label dan kontrol dipisah jarak 6px, konsisten dengan Field DS", () => {
    expect(decl(css, ".hn-public-field")).toMatch(/flex-direction:\s*column/);
    expect(decl(css, ".hn-public-field")).toMatch(/gap:\s*6px/);
    expect(decl(css, ".hn-public-label")).toMatch(/display:\s*block/);
  });

  it("input berkas setinggi kontrol sentuh (44px) dan tombol 'Pilih berkas' punya batas sendiri", () => {
    expect(decl(css, ".hn-portal-file")).toMatch(/min-height:\s*var\(--touch-target\)/);
    expect(decl(css, ".hn-portal-file::file-selector-button")).toMatch(/border:\s*1px solid/);
    expect(decl(coarse, ".hn-portal-file::file-selector-button")).toMatch(/min-height:\s*var\(--touch-target\)/);
  });
});
