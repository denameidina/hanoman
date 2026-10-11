// Audit UI/UX 2026-10 · Z11 · fokus keyboard Button/IconButton. jsdom tak memuat stylesheet dan tak
// menghitung `:focus-visible`, jadi yang diikat di sini adalah MEKANISMENYA: tak ada `outline` inline
// yang memblokir aturan global, aturan global itu memang mencakup tombol dengan cincin 2 px di luar
// border, dan rasio cincinnya dihitung dari token yang berlaku (rumus WCAG 2.x, sama dengan
// ui-audit-tokens.test.ts).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Button, IconButton } from "../src/ds";

afterEach(cleanup);

const SRC = resolve(import.meta.dirname, "../src");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const appCss = stripComments(readFileSync(join(SRC, "app.css"), "utf8"));
const formsCss = stripComments(readFileSync(join(SRC, "ds/components/forms.css"), "utf8"));
const uiCss = stripComments(readFileSync(join(SRC, "ds/components/ui.css"), "utf8"));
const integrationsCss = stripComments(readFileSync(join(SRC, "screens/styles/integrations.css"), "utf8"));
const advancedSrc = readFileSync(join(SRC, "screens/settings/Advanced.tsx"), "utf8");

// ── Token dan rasio ────────────────────────────────────────────────────────────────────────────
const colorSrc = stripComments(readFileSync(join(SRC, "ds/tokens/colors.css"), "utf8"));
const tokenMap = new Map<string, string>();
for (const m of colorSrc.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokenMap.set(m[1]!, m[2]!.trim());

const tokenHex = (name: string, depth = 0): string => {
  const value = tokenMap.get(name);
  if (value === undefined) throw new Error(`token tak terdefinisi: ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (!ref) return value;
  if (depth > 5) throw new Error(`rantai token terlalu dalam: ${name}`);
  return tokenHex(ref[1]!, depth + 1);
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

// Aturan (selector + isi) dari satu stylesheet yang komentarnya sudah dibuang. Selector tak boleh memuat
// `@`, jadi pembuka `@media` dilewati dan aturan di dalamnya tetap tertangkap.
const rules = (css: string) => Array.from(css.matchAll(/([^{}@]+)\{([^{}]*)\}/g), (m) => ({ selector: m[1]!.trim(), body: m[2]! }));

describe("Button dan IconButton · tanpa outline inline", () => {
  it.each(["primary", "secondary", "ghost", "danger", "danger-outline"] as const)(
    "Button varian %s tak menulis outline inline", (variant) => {
      render(<Button variant={variant}>Aksi {variant}</Button>);
      const btn = screen.getByRole("button", { name: `Aksi ${variant}` });
      expect(btn.style.outline).toBe("");
      expect(btn.getAttribute("style") ?? "").not.toMatch(/outline/);
    });

  it("Button disabled dan Button sebagai tautan juga tanpa outline inline", () => {
    render(<>
      <Button variant="secondary" disabled>Nonaktif</Button>
      <Button variant="primary" as="a" href="#x">Tautan</Button>
    </>);
    expect(screen.getByRole("button", { name: "Nonaktif" }).style.outline).toBe("");
    expect(screen.getByRole("link", { name: "Tautan" }).style.outline).toBe("");
  });

  it.each(["solid", "outline", "ghost"] as const)("IconButton varian %s tanpa outline inline", (variant) => {
    render(<IconButton icon="x" label={`Ikon ${variant}`} variant={variant} />);
    const btn = screen.getByRole("button", { name: `Ikon ${variant}` });
    expect(btn.style.outline).toBe("");
    expect(btn.getAttribute("style") ?? "").not.toMatch(/outline/);
  });

  it("kelas danger yang dirender punya aturan :focus-visible sendiri di forms.css", () => {
    render(<>
      <Button variant="danger">Hapus</Button>
      <Button variant="danger-outline">Reset</Button>
    </>);
    for (const cls of ["hn-btn-danger", "hn-btn-danger-outline"]) {
      expect(screen.getByRole("button", { name: cls === "hn-btn-danger" ? "Hapus" : "Reset" })).toHaveClass(cls);
      expect(formsCss).toMatch(new RegExp(`\\.${cls}:focus-visible`));
    }
  });
});

describe("aturan fokus global · mencakup tombol, tanpa mematikan outline-nya", () => {
  it("app.css: button:focus-visible menggambar cincin --border-focus 2 px di luar border", () => {
    expect(appCss).toMatch(/button:focus-visible,[^{]*\{\s*outline:\s*2px solid var\(--border-focus\);\s*outline-offset:\s*2px;\s*\}/);
  });

  it.each([["app.css", appCss], ["forms.css", formsCss], ["ui.css", uiCss]])(
    "%s tak mematikan outline tombol (button, .hn-btn-*, atau tautan tombol)", (_name, css) => {
      const offenders = rules(css)
        .filter((r) => /(^|[\s,])button\b|hn-btn-/.test(r.selector) && /outline\s*:\s*(none|0)\b/.test(r.body))
        .map((r) => r.selector);
      expect(offenders).toEqual([]);
    });

  it("kontrol negatif: aturan yang mematikan outline tombol memang tertangkap penyaring", () => {
    const sample = "button:focus { outline: none; }\n.hn-x { color: red; }";
    const hits = rules(sample).filter((r) => /(^|[\s,])button\b|hn-btn-/.test(r.selector) && /outline\s*:\s*(none|0)\b/.test(r.body));
    expect(hits).toHaveLength(1);
  });
});

describe("cincin fokus · kontras WCAG 1.4.11 (>= 3:1) terhadap latar tempatnya menempel", () => {
  // Cincin digambar 2 px di luar border, jadi yang bersebelahan dengannya adalah latar halaman atau
  // kartu, bukan isian tombol. Isian primer (brass-500) dan danger (clay-600) hanya ~1,3–1,5:1 terhadap
  // cincin; itu sebabnya offset-nya tak boleh hilang.
  const ring = () => tokenHex("--border-focus");
  it.each(["--surface-page", "--surface-card", "--surface-panel"])("lolos 3:1 di %s", (surface) => {
    expect(contrast(ring(), tokenHex(surface))).toBeGreaterThanOrEqual(3);
  });

  it("kontrol negatif: brass-500 lama (2,99:1 di page) memang di bawah 3:1", () => {
    expect(contrast(tokenHex("--brass-500"), tokenHex("--surface-page"))).toBeLessThan(3);
  });
});

describe("teks galat WebhooksPanel (.hn-wh-err) · kontras >= 4,5:1", () => {
  it("memakai --status-err (clay-600), bukan tint-nya sebagai warna teks", () => {
    const rule = rules(integrationsCss).find((r) => r.selector === ".hn-wh-err");
    expect(rule?.body).toMatch(/color\s*:\s*var\(--status-err\)/);
    expect(rule?.body).not.toMatch(/status-err-tint/);
  });

  it("lolos 4,5:1 di kartu, page, dan panel", () => {
    for (const surface of ["--surface-card", "--surface-page", "--surface-panel"]) {
      expect(contrast(tokenHex("--status-err"), tokenHex(surface)), surface).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("kontrol negatif: --status-err-tint sebagai teks memang gagal (≈1,2:1 di kartu)", () => {
    expect(contrast(tokenHex("--status-err-tint"), tokenHex("--surface-card"))).toBeLessThan(1.5);
  });
});

describe("Advanced · tombol bahaya memakai danger-outline", () => {
  it("tiga tombol bahaya (Hapus token, Reset, Hapus log) berkelas danger-outline, tanpa hn-set-danger-text", () => {
    expect(advancedSrc).not.toMatch(/hn-set-danger-text/);
    expect(advancedSrc.match(/variant="danger-outline"/g)).toHaveLength(3);
  });

  it("settings.css tak lagi memuat .hn-set-danger-text (tak ada pemakai lain)", () => {
    const settingsCss = stripComments(readFileSync(join(SRC, "screens/styles/settings.css"), "utf8"));
    expect(settingsCss).not.toMatch(/\.hn-set-danger-text/);
  });
});
