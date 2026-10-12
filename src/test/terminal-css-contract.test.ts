// Audit UI/UX 2026-10 · Fase 3E+ — kontrak statis untuk tata letak terminal di ponsel. jsdom tak
// menghitung tinggi dan tak memuat stylesheet, jadi yang diikat di sini MEKANISMENYA: toolbar tak
// memotong label, pane punya lantai tinggi berbasis viewport, dan kontrol sentuh dock ringkas punya
// target 44px. Pengukuran nyata tetap milik verifikasi visual (QA) di 390×844.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src");
const raw = readFileSync(join(SRC, "screens/styles/terminal.css"), "utf8");
// Komentar boleh menyebut selektornya (sebagai sejarah); yang diikat adalah kode CSS-nya.
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const mobileBlock = /@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/.exec(code)?.[1] ?? "";

describe("terminal.css · toolbar tak memotong label", () => {
  it("setiap kontrol toolbar memakai lebar isinya dan tak dibungkus (Buka… tak jadi Buka...)", () => {
    expect(code).toMatch(/\.hn-terminal-toolbar > \*\s*\{[^}]*white-space:\s*nowrap/);
    expect(code).toMatch(/\.hn-terminal-toolbar > \*\s*\{[^}]*flex:\s*0 0 auto/);
  });

  it("di ponsel toolbar tetap satu baris", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-toolbar\s*\{\s*flex-wrap:\s*nowrap/);
  });
});

describe("terminal.css · tinggi pane ponsel (320×640: composer tanpa gulir)", () => {
  it("pane mengisi ruang gulir yang tersedia: tak ada lantai 55dvh, dan tak ada overflow hidden yang memotong", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-focus-main\s*\{[^}]*min-height:\s*0/);
    expect(mobileBlock).toMatch(/\.hn-terminal-focus-main\s*\{[^}]*overflow:\s*visible/);
    expect(mobileBlock).not.toMatch(/calc\(55d?vh \+ 168px\)/);
  });

  it("layar ponsel tak lagi dipatok 640px; xterm punya lantai 35dvh", () => {
    expect(code).toMatch(/@media \(max-width: 767px\)[\s\S]*\.hn-terminal-screen:not\(\.is-maxed\)\s*\{\s*min-height:\s*0/);
    expect(mobileBlock).toMatch(/\.hn-terminal-focus-body\s*\{\s*min-height:\s*35dvh/);
  });

  it("dock (composer) lengket di dasar gulir bila konten melebihi layar", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-dock\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/);
  });

  it("rail sesi jadi laci di ponsel, dan tombol 'Sesi · N' tak lagi disembunyikan oleh display:none", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-rail\s*\{\s*display:\s*none/);
    expect(code).not.toMatch(/\.hn-terminal-rail-toggle\s*\{[^}]*display:\s*none/);
  });
});

describe("terminal.css · ponsel 320×640: output dominan (≥ 55%), chrome di atasnya dipadatkan", () => {
  it("layar ponsel mengisi sisa ruang konten: margin bawah -32px mengembalikan padding bawah .hn-shell-content", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-screen:not\(\.is-maxed\)\s*\{[^}]*margin-bottom:\s*-32px/);
    const appCss = readFileSync(join(SRC, "app.css"), "utf8");
    expect(appCss).toMatch(/\.hn-shell-content \{[^}]*padding:\s*var\(--page-gutter-y\) var\(--page-gutter-x\) calc\(32px/);
  });

  it("jarak antar-baris ponsel 4px (--space-1), bukan 12px", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-screen:not\(\.is-maxed\)\s*\{[^}]*gap:\s*var\(--space-1\)/);
  });

  it("kepala sesi ponsel satu baris setinggi tinggi sentuh, tanpa padding vertikal", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-focus-head\s*\{[^}]*padding-top:\s*0[^}]*padding-bottom:\s*0[^}]*min-height:\s*var\(--touch-target\)/);
  });

  it("tak ada tinggi layar yang dihitung dari viewport di ponsel (overflow 47px dulu dari calc 100dvh)", () => {
    expect(mobileBlock).not.toMatch(/\.hn-terminal-screen:not\(\.is-maxed\)\s*\{[^}]*100dvh/);
  });
});

describe("terminal.css · dock ringkas di ponsel", () => {
  it("composer satu baris di ponsel", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-dock \.hn-terminal-composer\s*\{\s*flex-wrap:\s*nowrap/);
  });

  it("Esc, Tab, panah dan Kirim punya target sentuh minimal --touch-target di ponsel", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-keys-toggle,\s*\.hn-terminal-send\s*\{\s*min-height:\s*var\(--touch-target\)/);
  });

  it("warna tombol Kirim memakai pasangan solid --action-* (teks putih di atas brass-600), bukan warna baru", () => {
    expect(code).toMatch(/\.hn-terminal-send\s*\{[^}]*color:\s*var\(--action-on\)/);
    expect(code).toMatch(/\.hn-terminal-send\s*\{[^}]*background:\s*var\(--action-bg\)/);
  });
});

// Audit UI/UX 2026-10 (tinjauan segar) · menu "Buka…" sempit: ikon folder, teks "Buka…" dari 641px.
describe("terminal.css · menu Buka… sempit: teks hanya dari 641px, target sentuh 44px", () => {
  it("teks Buka… tersembunyi di bawah 641px dan tampil dari 641px", () => {
    expect(code).toMatch(/\.hn-terminal-open-text\s*\{\s*display:\s*none;?\s*\}/);
    expect(code).toMatch(/@media \(min-width: 641px\)\s*\{\s*\.hn-terminal-open-text\s*\{\s*display:\s*inline;?\s*\}/);
  });

  it("pemicu ikon punya target 44px di pointer kasar atau ponsel", () => {
    expect(code).toMatch(/@media \(pointer: coarse\), \(max-width: 767px\)\s*\{\s*\.hn-terminal-open-compact\s*\{[^}]*min-height:\s*var\(--touch-target\)/);
  });

  it("tak ada !important baru di berkas terminal", () => {
    expect(code).not.toMatch(/!important/);
  });
});

// Audit UI/UX 2026-10 · Fase 2E (Z1): deklarasi yang dulu inline di TerminalScreen, SessionHistoryModal,
// dan NewTerminalModal kini hidup di terminal.css. jsdom tak memuat stylesheet, jadi kontraknya dibaca
// dari CSS-nya sendiri. `ruleOf` mencocokkan selector persis (`selector {`), bukan regex longgar.
function ruleOf(selector: string): string {
  const start = code.indexOf(`${selector} {`);
  if (start < 0) return "";
  return code.slice(start, code.indexOf("}", start) + 1);
}
const tsx = (name: string) => readFileSync(join(SRC, name), "utf8");

describe("terminal.css · deklarasi yang dipindah dari inline (Z1)", () => {
  it("strip fase: scroller men-scroll mendatar, pembungkusnya tak jadi containing block", () => {
    expect(ruleOf(".hn-terminal-phase-scroller")).toMatch(/overflow-x:\s*auto/);
    expect(ruleOf(".hn-terminal-phase-scroller")).toMatch(/white-space:\s*nowrap/);
    expect(ruleOf(".hn-terminal-phase")).not.toMatch(/position|overflow/);
  });

  it("panel detail fase: absolute tanpa top, maxHeight relatif, scroll sendiri", () => {
    const panel = ruleOf(".hn-terminal-phase-panel");
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/max-height:\s*calc\(100% - 48px\)/);
    expect(panel).toMatch(/overflow-y:\s*auto/);
    expect(panel).not.toMatch(/(^|[\s{;])top:/);
  });

  it("nama fase dicat per state (dulu objek inline nameStyle)", () => {
    expect(ruleOf('.hn-terminal-phase-name[data-state="done"]')).toMatch(/color:\s*var\(--brass\)/);
    expect(ruleOf('.hn-terminal-phase-name[data-state="active"]')).toMatch(/font-weight:\s*600/);
    expect(ruleOf('.hn-terminal-phase-name[data-state="skipped"]')).toMatch(/line-through/);
    expect(ruleOf('.hn-terminal-phase-name[data-state="pending"]')).toMatch(/opacity:\s*0\.5/);
  });

  it("layar penuh: tata letak biasa 1 1 0 + min-height 640; is-maxed = fixed di atas shell", () => {
    expect(ruleOf(".hn-terminal-screen")).toMatch(/flex:\s*1 1 0;/);
    expect(ruleOf(".hn-terminal-screen")).toMatch(/min-height:\s*640px/);
    const maxed = ruleOf(".hn-terminal-screen.is-maxed");
    expect(maxed).toMatch(/position:\s*fixed/);
    expect(maxed).toMatch(/z-index:\s*100/);
    expect(maxed).toMatch(/inset:\s*0/);
  });

  it("badan sel adalah containing block panel fase (position: relative)", () => {
    expect(ruleOf(".hn-terminal-cell-body")).toMatch(/position:\s*relative/);
  });

  it("kontrol grup: ukuran dari --group-box, tab memilih lewat aria-selected", () => {
    expect(ruleOf(".hn-terminal-groups button.hn-terminal-group-tab")).toMatch(/min-height:\s*var\(--group-box\)/);
    expect(ruleOf(".hn-terminal-groups button.hn-terminal-group-action")).toMatch(/min-width:\s*var\(--group-box\)/);
    expect(ruleOf('.hn-terminal-groups button.hn-terminal-group-tab[aria-selected="true"]'))
      .toMatch(/background:\s*var\(--bone-200\)/);
  });

  it("tombol nama sesi yang belum di grid di-reset penuh (all: unset), dua tingkat agar menang atas button", () => {
    expect(ruleOf(".hn-terminal-unplaced-chip > .hn-terminal-unplaced-action")).toMatch(/all:\s*unset/);
  });

  it("gutter: redup saat disabled, font 11px menang atas font: inherit dari app.css", () => {
    expect(ruleOf("button.hn-terminal-gutter")).toMatch(/font-size:\s*11px/);
    expect(ruleOf("button.hn-terminal-gutter:disabled")).toMatch(/opacity:\s*0\.3/);
  });

  it("ilustrasi kepala sel: lebar 34px di pembungkus (img membawa width:100% inline)", () => {
    expect(ruleOf(".hn-terminal-cell-illus")).toMatch(/width:\s*34px/);
  });

  it("latar kepala sel mengikuti data-cell-tone (gagal > selesai > perhatian)", () => {
    expect(ruleOf('.hn-terminal-cell-header[data-cell-tone="failed"]')).toMatch(/var\(--status-err-tint\)/);
    expect(ruleOf('.hn-terminal-cell-header[data-cell-tone="done"]')).toMatch(/var\(--status-ok-tint\)/);
    expect(ruleOf('.hn-terminal-cell-header[data-cell-tone="attention"]')).toMatch(/var\(--status-warn-tint\)/);
  });

  it("daftar pemilih: baris tak menyusut (flex 0 0 auto) dan daftar ber-maxHeight", () => {
    expect(ruleOf(".hn-terminal-pick-row")).toMatch(/flex:\s*0 0 auto/);
    expect(ruleOf(".hn-terminal-pick-list")).toMatch(/max-height:\s*62vh/);
    expect(ruleOf(".hn-terminal-hist-list")).toMatch(/max-height:\s*60vh/);
    expect(ruleOf(".hn-terminal-hist-pre")).toMatch(/max-height:\s*52vh/);
  });

  it("setiap CSS variable dinamis dipakai CSS dan diisi TSX (tak ada variabel yatim)", () => {
    const terminal = tsx("screens/TerminalScreen.tsx");
    for (const v of ["--grid-cols", "--grid-rows", "--cell-col", "--cell-row", "--grid-col", "--grid-row", "--group-box"]) {
      expect(code, `css memakai ${v}`).toContain(`var(${v})`);
      expect(terminal, `tsx mengisi ${v}`).toContain(`"${v}"`);
    }
  });
});

// P2-2 · papan kunci di 320 px: tujuh kunci ≥44 px tak muat satu baris ("Enter" terpotong). ≤420 px kunci
// MEMBUNGKUS, tanpa gulir mendatar; di atasnya tetap satu baris yang bisa digeser, dengan fade. Aturannya ada di
// app.css (bukan terminal.css), jadi dibaca dari sana. Terukur di Chrome headless (fixture build, 320×640):
// sebelum 1 baris, kunci 349 px dalam kotak 320 px; sesudah 2 baris, Enter 2–59 px, dock 208 px, komposer terlihat.
describe("app.css · papan kunci terminal membungkus di ≤420 px", () => {
  const app = readFileSync(join(SRC, "app.css"), "utf8");
  const appCode = app.replace(/\/\*[\s\S]*?\*\//g, "");
  const keysWrap = /@media \(max-width: 420px\)\s*\{\s*\.hn-terminal-keys\s*\{([^}]*)\}\s*\}/.exec(appCode);

  it("≤420 px: kunci membungkus (flex-wrap) dan overflow visible, jadi tak ada gulir mendatar", () => {
    expect(keysWrap?.[1] ?? "").toMatch(/flex-wrap:\s*wrap/);
    expect(keysWrap?.[1] ?? "").toMatch(/overflow:\s*visible/);
  });

  it("aturan membungkus ditulis SESUDAH aturan dasar .hn-terminal-keys (urutan = menang atas overflow-x: auto)", () => {
    const base = appCode.indexOf(".hn-terminal-keys {");
    expect(base).toBeGreaterThan(-1);
    expect(keysWrap?.index ?? -1).toBeGreaterThan(base);
  });

  it("di atas 420 px papan tetap satu baris yang bisa digeser (aturan dasar overflow-x: auto, fade tetap)", () => {
    expect(ruleOfApp(".hn-terminal-keys")).toMatch(/overflow-x:\s*auto/);
    expect(appCode).toMatch(/\.hn-terminal-keys\[data-fade-end="true"\]\s*\{\s*--hn-fade-r:\s*24px;?\s*\}/);
  });

  it("target sentuh kunci tetap 44 px di pointer kasar atau ≤767 px", () => {
    expect(appCode).toMatch(/@media \(pointer: coarse\), \(max-width: 767px\)\s*\{\s*\.hn-graph-action,\s*\.hn-terminal-action,\s*\.hn-terminal-key,/);
  });

  it("tak ada !important baru di app.css (jumlah tetap ≤ 8)", () => {
    expect((app.match(/!important/g) ?? []).length).toBeLessThanOrEqual(8);
  });
});

function ruleOfApp(selector: string): string {
  const code = readFileSync(join(SRC, "app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const start = code.indexOf(`${selector} {`);
  return start < 0 ? "" : code.slice(start, code.indexOf("}", start) + 1);
}

describe("inline style yang tersisa (Z1)", () => {
  // Hanya nilai dinamis yang boleh tetap inline, dan itu harus berupa CSS variable (`"--x"`).
  // Dihitung dari literal `style={{` di sumbernya, sama dengan metrik audit.
  const inlineOf = (name: string) => tsx(name).match(/style=\{\{/g)?.length ?? 0;

  it("TerminalScreen: ≤ 10 (sisanya hanya CSS variable)", () => {
    const src = tsx("screens/TerminalScreen.tsx");
    expect(inlineOf("screens/TerminalScreen.tsx")).toBeLessThanOrEqual(10);
    // Setiap literal inline di sini harus membawa variabel (`"--`) dalam jendela pendek di depannya.
    const starts = [...src.matchAll(/style=\{\{/g)].map((m) => m.index ?? 0);
    for (const at of starts) expect(src.slice(at, at + 260)).toContain('"--');
  });

  it("SessionHistoryModal: ≤ 4", () => {
    expect(inlineOf("screens/SessionHistoryModal.tsx")).toBeLessThanOrEqual(4);
  });

  it("NewTerminalModal: ≤ 2", () => {
    expect(inlineOf("screens/NewTerminalModal.tsx")).toBeLessThanOrEqual(2);
  });
});
