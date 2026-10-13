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

// QA Chrome (P2) · baris Klien di ponsel: `.kl-row` menjadi kolom, jadi basis 200px jatuh ke TINGGI teks
// dan menyisakan celah kosong antara deskripsi dan toggle. Basis itu hanya boleh di layar lebar.
describe("Klien · baris izin di ponsel tak membawa basis 200px sebagai tinggi (QA P2)", () => {
  const css = read("screens/styles/clients.css");

  it("teks baris mengikuti isinya di ponsel (basis auto)", () => {
    expect(decl(css, ".kl-row-text")).toMatch(/flex:\s*1 1 auto/);
    expect(decl(css, ".kl-row-text")).not.toMatch(/200px/);
  });

  it("basis 200px hanya berlaku mulai 768px, tempat baris tetap mendatar", () => {
    expect(decl(atBlock(css, "@media (min-width: 768px)"), ".kl-row-text")).toMatch(/flex-basis:\s*200px/);
  });
});

// QA Chrome (P3) · 'Perlu perhatian' di Overview ponsel: nama project memotong jadi "repo…" dan alasan
// memanjang tiga baris. Nama kini turun dua baris di barisnya sendiri, alasan terpotong dua baris.
describe("Overview · Perlu perhatian di ponsel: nama wrap dua baris, alasan clamp dua baris (QA P3)", () => {
  const css = read("screens/styles/overview.css");
  const mobile = atBlock(css, "@media (max-width: 767px)");

  it("daftar memakai kelas yang dikunci CSS-nya (bukan daftar umum)", () => {
    // ADR-0220 · "Perlu perhatian" kini kotak Koreksi di berkasnya sendiri; kelas CSS-nya tetap.
    expect(read("screens/overview/Koreksi.tsx")).toContain('className="hn-ov-attn"');
  });

  it("nama project di barisnya sendiri dan boleh turun dua baris", () => {
    const rule = decl(mobile, ".hn-ov-attn .hn-ov-name");
    expect(rule).toMatch(/flex:\s*1 1 100%/);
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).toMatch(/-webkit-line-clamp:\s*2/);
  });

  it("alasan di bawah nama terpotong dua baris, tak lagi tiga", () => {
    const rule = decl(mobile, ".hn-ov-attn .hn-ov-meta");
    expect(rule).toMatch(/-webkit-line-clamp:\s*2/);
    expect(rule).toMatch(/overflow:\s*hidden/);
  });

  it("daftar project di luar 'Perlu perhatian' tetap satu baris berelipsis", () => {
    expect(decl(css, ".hn-ov-name")).toMatch(/white-space:\s*nowrap/);
    expect(decl(css, ".hn-ov-name")).toMatch(/text-overflow:\s*ellipsis/);
  });
});

// QA Chrome (P3) · Help Center publik: input berkas native bergaya 'Choose Files'. Kini input disembunyikan
// tetap fokusabel, dan tombol DS "Pilih berkas" (label yang menunjuknya) yang tampak.
describe("Help Center publik · pilih berkas bergaya DS dan tetap fokusabel (QA P3)", () => {
  const css = read("portal/portal.css");
  const coarse = atBlock(css, "@media (pointer: coarse), (max-width: 767px)");

  it("input berkas disembunyikan secara visual tetapi tidak display:none (tetap bisa difokus)", () => {
    const rule = css.slice(css.indexOf('.hn-public-file > input[type="file"].hn-public-file-input'));
    const body = rule.slice(rule.indexOf("{") + 1, rule.indexOf("}"));
    expect(body).toMatch(/opacity:\s*0/);
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(body).not.toMatch(/display:\s*none/);
  });

  it("fokus keyboard memberi cincin pada tombol tampak lewat sibling input", () => {
    expect(css).toMatch(/\.hn-public-file-input:focus-visible \+ \.hn-public-file-btn \{[^}]*outline:\s*2px solid var\(--border-focus\)/);
  });

  it("tombol tampak setinggi 36 px di desktop dan kontrol sentuh 44 px di pointer kasar", () => {
    expect(decl(css, ".hn-public-file-btn")).toMatch(/min-height:\s*36px/);
    expect(coarse).toMatch(/\.hn-public-file-btn \{ min-height: var\(--touch-target\); \}/);
  });

  it("judul tiket di Portal punya tinggi area klik 24 px (padding), bukan baris teks 19 px", () => {
    const idx = css.lastIndexOf(".hn-portal-case-title {");
    const body = css.slice(idx, css.indexOf("}", idx));
    expect(body).toMatch(/min-height:\s*24px/);
    expect(body).toMatch(/padding:\s*3px 0/);
  });
});
