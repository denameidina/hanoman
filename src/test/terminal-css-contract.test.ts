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

describe("terminal.css · tinggi pane ponsel", () => {
  it("kepala + strip + dock dihitung di atas 55% viewport, dengan cadangan vh", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-focus-main\s*\{[^}]*min-height:\s*calc\(55vh \+ 168px\)/);
    expect(mobileBlock).toMatch(/\.hn-terminal-focus-main\s*\{[^}]*min-height:\s*calc\(55dvh \+ 168px\)/);
  });

  it("rail sesi jadi laci di ponsel, dan tombol 'Sesi · N' tak lagi disembunyikan oleh display:none", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-rail\s*\{\s*display:\s*none/);
    expect(code).not.toMatch(/\.hn-terminal-rail-toggle\s*\{[^}]*display:\s*none/);
  });
});

describe("terminal.css · dock ringkas di ponsel", () => {
  it("composer satu baris di ponsel", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-dock \.hn-terminal-composer\s*\{\s*flex-wrap:\s*nowrap/);
  });

  it("Tombol khusus dan Kirim punya target sentuh minimal --touch-target di ponsel", () => {
    expect(mobileBlock).toMatch(/\.hn-terminal-keys-toggle,\s*\.hn-terminal-send\s*\{\s*min-height:\s*var\(--touch-target\)/);
  });

  it("warna tombol Kirim memakai token aksen, bukan warna baru", () => {
    expect(code).toMatch(/\.hn-terminal-send\s*\{[^}]*color:\s*var\(--accent-on\)/);
    expect(code).toMatch(/\.hn-terminal-send\s*\{[^}]*background:\s*var\(--accent\)/);
  });
});
