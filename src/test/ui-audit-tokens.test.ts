// @vitest-environment node
// Audit UI/UX 2026-10 · Fase 1A. Kontras dihitung dari nilai token yang BERLAKU (rantai `var()`
// diikuti sampai hex), bukan dari namanya. Rumus WCAG 2.x sama dengan nav-pending-badge.test.tsx.
// Bagian kedua mengunci kontrak CSS/HTML yang diubah: viewport, preconnect, input checkbox/radio,
// tombol primer, dan tombol keluar Dalang di ponsel.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(import.meta.dirname, rel), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const colorSrc = stripComments(read("../src/ds/tokens/colors.css"));
const tokenMap = new Map<string, string>();
for (const m of colorSrc.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokenMap.set(m[1]!, m[2]!.trim());

const color = (name: string, depth = 0): string => {
  const value = tokenMap.get(name);
  if (value === undefined) throw new Error(`token tak terdefinisi: ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (!ref) return value;
  if (depth > 5) throw new Error(`rantai token terlalu dalam: ${name}`);
  return color(ref[1]!, depth + 1);
};

const luminance = (hex: string): number => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const SURFACES = ["--surface-card", "--surface-page", "--surface-panel"];

describe("kontras teks: WCAG AA 1.4.3 (>= 4,5:1) di setiap permukaan terang", () => {
  for (const text of ["--text-strong", "--text-body", "--text-muted", "--text-subtle", "--text-link",
    "--status-ok", "--status-warn", "--status-err"]) {
    it(`${text} lolos di kartu, page, dan panel`, () => {
      for (const surface of SURFACES) {
        expect(contrast(color(text), color(surface)), `${text} di ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("teks warning lolos di atas tint warning (isi badge)", () => {
    expect(contrast(color("--status-warn"), color("--status-warn-tint"))).toBeGreaterThanOrEqual(4.5);
  });

  it("teks tombol primer (--accent-on) lolos di atas --accent", () => {
    expect(contrast(color("--accent-on"), color("--accent"))).toBeGreaterThanOrEqual(4.5);
  });

  // Kontrol negatif: nilai lama yang dikirim sebelum audit. Tanpa ini, lolosnya test di atas bisa
  // berarti rumusnya salah, bukan warnanya benar.
  it("nilai lama memang gagal gerbang yang sama", () => {
    expect(contrast("#90826c", color("--surface-card"))).toBeLessThan(4.5);   // ink-400 sebagai teks
    expect(contrast(color("--amber-600"), color("--surface-card"))).toBeLessThan(4.5);
  });
});

describe("kontras batas kontrol: WCAG 1.4.11 (>= 3:1)", () => {
  it("--border-strong (batas input, checkbox, tombol secondary) lolos di tiap permukaan", () => {
    for (const surface of SURFACES) {
      expect(contrast(color("--border-strong"), color(surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it("--border-focus lolos di permukaan terang dan panel Dalang gelap", () => {
    for (const surface of [...SURFACES, "--term-bg"]) {
      expect(contrast(color("--border-focus"), color(surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it("kontrol negatif: bone-400 lama memang di bawah 3:1", () => {
    expect(contrast(color("--bone-400"), color("--surface-card"))).toBeLessThan(3);
  });
});

describe("teks Dalang (screens/styles/dalang.css) lolos 4,5:1 di atas --term-bg", () => {
  // Pengganti kontrak footer `.hn-dlg-foot` (kelasnya dihapus di Fase 2E, tak dirender lagi). Semua warna
  // TEKS di berkas Dalang yang kini dipakai diukur terhadap latar gelapnya; titik status (background) di luar.
  const dalang = stripComments(read("../src/screens/styles/dalang.css"));
  const textTokens = [...new Set([...dalang.matchAll(/(?<![-\w])color:\s*var\((--[\w-]+)\)/g)].map((m) => m[1]!))];

  it("warna teks terbaca dari dalang.css", () => {
    expect(textTokens.length).toBeGreaterThanOrEqual(3);
  });

  it.each(textTokens)("%s >= 4,5:1 di term-bg", (token) => {
    expect(contrast(color(token), color("--term-bg"))).toBeGreaterThanOrEqual(4.5);
  });
});

// Teks yang dulu gagal 4,5:1 di latar yang benar-benar dipakai (axe). Nilainya dibaca dari ATURAN CSS-nya,
// bukan dari daftar tetap, jadi bila token di kelas itu diganti, test ikut mengukur token yang baru.
const ruleBody = (css: string, selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
  const m = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`aturan CSS tak ditemukan: ${selector}`);
  return m[1]!;
};
const tokenOf = (body: string, prop: string): string => {
  const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*var\\((--[\\w-]+)\\)`).exec(body);
  if (!m) throw new Error(`properti ${prop} tak memakai var(): ${body.trim()}`);
  return m[1]!;
};

describe("teks di latar nyata lolos 4,5:1 (axe, WCAG 1.4.3)", () => {
  const fileTree = stripComments(read("../src/screens/styles/file-tree.css"));
  const palette = stripComments(read("../src/palette/palette.css"));
  const shell = stripComments(read("../src/styles/app-shell.css"));
  const appCss = stripComments(read("../src/app.css"));

  it("hapus (.hn-ide-del) lolos di atas baris terpilih dan kartu", () => {
    const body = ruleBody(fileTree, ".hn-ide-del");
    const text = color(tokenOf(body, "color"));
    for (const surface of [tokenOf(ruleBody(fileTree, ".hn-ide-sel"), "background"), "--surface-card"]) {
      expect(contrast(text, color(surface)), surface).toBeGreaterThanOrEqual(4.5);
    }
    expect(body).not.toMatch(/!important/);
  });

  it("status D (.hn-ide-status[data-status=\"D\"]) lolos di baris terpilih", () => {
    const text = color(tokenOf(ruleBody(fileTree, '.hn-ide-status[data-status="D"]'), "color"));
    expect(contrast(text, color(tokenOf(ruleBody(fileTree, ".hn-ide-sel"), "background")))).toBeGreaterThanOrEqual(4.5);
  });

  it("hint pintasan palet lolos di baris aktif (brass-100) dan di kartu", () => {
    const text = color(tokenOf(ruleBody(palette, ".hn-palette-option-hint"), "color"));
    for (const surface of [tokenOf(ruleBody(palette, ".hn-palette-option.is-active"), "background"), "--surface-card"]) {
      expect(contrast(text, color(surface)), surface).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("teks aksi toast lolos di atas latar toast (surface-inverse)", () => {
    const text = color(tokenOf(ruleBody(shell, ".hn-toast-action"), "color"));
    const toastBg = color(tokenOf(ruleBody(shell, ".hn-toast"), "background"));
    expect(contrast(text, toastBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("masuknya toast tak menyentuh opacity, jadi teks aksi tak pernah transparan saat animasi", () => {
    const anim = /animation:\s*([\w-]+)/.exec(ruleBody(shell, ".hn-toast"))?.[1];
    expect(anim).toBeTruthy();
    const frames = new RegExp(`@keyframes ${anim}\\s*\\{([\\s\\S]*?)\\}\\s*\\}`).exec(shell)?.[1] ?? "";
    expect(frames).toMatch(/transform/);
    expect(frames).not.toMatch(/opacity/);
  });

  it("kontrol negatif: nilai lama memang gagal gerbang yang sama, dan keyframe fade lama memang memakai opacity", () => {
    expect(contrast(color("--clay-500"), color("--brass-100"))).toBeLessThan(4.5);
    expect(contrast(color("--text-subtle"), color("--brass-100"))).toBeLessThan(4.5);
    const oldFade = new RegExp(`@keyframes hn-fade-in\\s*\\{([\\s\\S]*?)\\}\\s*\\}`).exec(appCss)?.[1] ?? "";
    expect(oldFade).toMatch(/opacity/);
  });
});

describe("kontrak CSS dan HTML hasil audit", () => {
  const css = stripComments(read("../src/app.css"));
  const html = read("../index.html");

  it("viewport mengaktifkan safe-area (viewport-fit=cover) agar token --safe-* hidup", () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
  });

  it("font Google Fonts di-preconnect (origin CSS dan origin berkas font)", () => {
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" />');
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
  });

  it("font tak render-blocking: fonts.css tanpa @import; stylesheet Google Fonts lewat preload + swap, dengan noscript", () => {
    expect(stripComments(read("../src/ds/tokens/fonts.css"))).not.toMatch(/@import/);
    expect(html).toMatch(/<link rel="preload" href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" as="style" onload="this\.rel='stylesheet'" \/>/);
    expect(html).toMatch(/<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" \/><\/noscript>/);
    // Stylesheet Google Fonts hanya boleh ada di <noscript> (fallback tanpa JS), bukan sebagai pemblokir render.
    expect(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, "")).not.toMatch(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  });

  it("fallback offline: tiap keluarga font berakhir generik (serif / sans-serif / monospace)", () => {
    const typo = stripComments(read("../src/ds/tokens/typography.css"));
    for (const name of ["serif", "sans", "mono"]) {
      const value = new RegExp(`--font-${name}:\\s*([^;]+);`).exec(typo)?.[1] ?? "";
      expect(value, `--font-${name}`).toMatch(/,\s*(serif|sans-serif|monospace)\s*$/);
    }
  });

  it("aturan 44px pointer kasar tidak mengenai checkbox/radio mentah", () => {
    expect(css).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), select, textarea \{/);
    expect(css).not.toMatch(/(^|\n)\s*input, select, textarea \{/);
    // Checkbox/radio mentah tak lagi di-min-width (tak membesarkan kontrol native): kotaknya digambar
    // sendiri 16 px, dan area klik 44 px di pointer kasar datang dari padding transparan.
    expect(css).toMatch(/input\[type="checkbox"\],\ninput\[type="radio"\] \{\n  -webkit-appearance: none;/);
    expect(css).toMatch(/input\[type="checkbox"\], input\[type="radio"\] \{ padding: 14px; \}/);
    expect(css).not.toMatch(/input\[type="checkbox"\], input\[type="radio"\] \{ min-width: 24px; min-height: 24px; \}/);
  });

  it("tombol primer tak lagi di-override putih (danger memberi #fff sendiri di inline style)", () => {
    expect(css).not.toMatch(/--accent-on:\s*#fff/);
  });

  it("Dalang: tombol keluar tak pernah disembunyikan (dalang.css), termasuk di ponsel", () => {
    const dalang = stripComments(read("../src/screens/styles/dalang.css"));
    expect(dalang).toMatch(/\.hn-dlg-exit\s*\{[^}]*width:\s*var\(--touch-target\)/);
    expect(dalang).not.toMatch(/\.hn-dlg-exit[^{]*\{[^}]*display:\s*none/);
  });

  it("Dalang: tombol keluar 44×44 di semua ukuran layar (dalang.css, bukan app.css)", () => {
    const dalang = stripComments(read("../src/screens/styles/dalang.css"));
    expect(dalang).toMatch(/\.hn-dlg-exit \{[^}]*width: var\(--touch-target\); height: var\(--touch-target\);/);
    expect(css).not.toMatch(/\.hn-dlg-/);
  });

  it("Dalang: tak ada teks di bawah 11px", () => {
    const dalangCss = stripComments(read("../src/screens/styles/dalang.css"));
    const sizes: number[] = [];
    for (const [, selector, body] of dalangCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selector!.includes(".hn-dlg-")) continue;
      for (const m of body!.matchAll(/font-size:\s*([\d.]+)px/g)) sizes.push(Number(m[1]));
    }
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });
});
