/* SPEC-763 lanjutan — regresi layout mobile yang terukur di browser sungguhan (Chrome headless,
   390×844, instance hanoman terisolasi). jsdom tak punya layout engine, jadi test ini mengikat
   **mekanisme** yang membuat pengukuran itu berubah, bukan pikselnya:

   1. Tab yang menyusut. `.hn-tabs` sudah `overflow-x: auto`, tapi tanpa `flex-shrink: 0` tiap tab
      menyusut sampai `min-width` target sentuh (44px) dan labelnya yang `nowrap` TUMPAH ke tab
      tetangga alih-alih memicu scroll. Terukur pada strip sumber Backlog di 390px: tumpahan total
      67px ("Semua spec" 22px, "Help Center" 20px, "Dari brief" 14px, "Dari QA" 9px, "Audit" 2px)
      dan strip TIDAK bisa digulir. Dengan `flex: 0 0 auto`: tumpahan 0px, strip menggulir
      (konten 499px > kotak 362px).

   2. Baris padat yang menjepit teks. Baris `[teks flex:1][tombol]` tanpa `hn-dense-row` menyisakan
      sisa lebar untuk teksnya — terukur `crm-tumbuh-ai` jadi 3 baris (4 karakter/baris) di
      Overview dan kalimat gerbang scheduler jadi 9 baris (8 karakter/baris).

   3. Pil update memaksa topbar jadi tiga baris (161–211px = 19–25% viewport). Yang dijatuhkan di
      mobile hanya KATA-nya; kontrol, versi, dan nama aksesibelnya tetap ada. */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs } from "../src/ds/components/ui";
import { updateBadgeLabel, updateBadgeLabelShort } from "../src/api/update";
import type { UpdateStatus } from "@hanoman/shared";

const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8");
// Batas akhir dicari SESUDAH awal blok mobile: `.hn-local-overflow` juga disebut di komentar
// kepala berkas (jauh sebelum media query), dan indexOf tanpa titik mulai memilih yang itu →
// irisan kosong → ketiga assertion di bawah gagal pada CSS yang benar.
const mobileStart = css.indexOf("@media (max-width: 767px) {");
const mobile = css.slice(mobileStart, css.indexOf(".hn-local-overflow {", mobileStart));

describe("SPEC-763 · tab tak menyusut sampai labelnya tumpah", () => {
  it("mematikan flex-shrink pada setiap tab sehingga strip yang sempit menggulir", () => {
    render(
      <Tabs aria-label="Sumber spec" variant="pill" value="all" onChange={() => {}}
        tabs={[{ value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" },
          { value: "help", label: "Help Center" }]} />,
    );
    for (const name of ["Semua spec", "Dari brief", "Help Center"]) {
      // flex-shrink 0 = tab mempertahankan lebar intrinsiknya; sisanya urusan `.hn-tabs`
      // (`overflow-x: auto`), yang tanpa ini tak pernah punya konten lebih lebar untuk digulir.
      expect(screen.getByRole("tab", { name })).toHaveStyle({ flex: "0 0 auto" });
    }
  });

  it("menjaga strip tab tetap sebagai scroller lokal, bukan pemotong senyap", () => {
    const tabs = css.slice(css.indexOf(".hn-tabs {"));
    expect(tabs).toMatch(/max-width:\s*100%/);
    expect(tabs).toMatch(/overflow-x:\s*auto/);
  });
});

describe("SPEC-763 · baris padat memberi teks lebar minimum di mobile", () => {
  it("menyatakan aturan hn-dense-row di media query mobile", () => {
    expect(mobile).toMatch(/\.hn-dense-row[^}]*flex-wrap:\s*wrap/s);
    expect(mobile).toMatch(/\.hn-dense-row > \[style\*="flex: 1"\]\s*\{\s*min-width/);
  });

  it("memakai aturan itu pada baris yang terukur terjepit", () => {
    const overview = readFileSync(resolve(import.meta.dirname, "../src/screens/OverviewScreen.tsx"), "utf8");
    const from = overview.indexOf("function AttnRow");
    const attn = overview.slice(from, overview.indexOf(">Buka SoT</Button>", from));
    expect(attn).toContain('className="hn-dense-row"');

    const crons = readFileSync(resolve(import.meta.dirname, "../src/screens/SchedulerCrons.tsx"), "utf8");
    const gate = crons.slice(crons.indexOf("belum di-opt-in scheduler") - 900, crons.indexOf("belum di-opt-in scheduler"));
    expect(gate).toContain('className="hn-dense-row"');
  });
});

/* Baris pemilih (Ambil backlog · Riwayat sesi) memikul TIGA cacat sekaligus, ketiganya terukur di
   390×844 dan ketiganya lahir dari "item boleh menyusut di bawah kontennya" — akar yang sama dengan
   tab yang tumpah:
   - `all: "unset"` inline mengalahkan `button { min-height: var(--touch-target) }` → baris 39px;
   - daftar `flex-direction: column` ber-`maxHeight` memeras baris ke 44px sementara isinya 66px →
     judul yang membungkus MENIMPA baris berikutnya (terlihat langsung di tangkapan layar);
   - judul ber-`flex-basis: 0` kalah dari `projectId` yang basis-nya selebar isinya → judul tersisa
     "Ba…" (konten terpotong 667px) padahal ia satu-satunya pembeda antar-baris. */
describe("SPEC-763 · baris pemilih tak diperas di bawah kontennya", () => {
  const rows = [
    ["TerminalScreen.tsx", "onPick(s)"],
    ["SessionHistoryModal.tsx", "setSelected(r)"],
  ] as const;

  it.each(rows)("%s: baris tak memakai `all: unset` dan tak boleh menyusut", (file, anchor) => {
    const source = readFileSync(resolve(import.meta.dirname, `../src/screens/${file}`), "utf8");
    const at = source.indexOf(anchor);
    expect(at).toBeGreaterThan(-1);
    const row = source.slice(at, at + 420);
    expect(row).not.toContain('all: "unset"');
    expect(row).toContain('flex: "0 0 auto"');
  });

  it.each(rows)("%s: pembungkus flex ada DI DALAM tombol, bukan pada tombolnya", (file, anchor) => {
    const source = readFileSync(resolve(import.meta.dirname, `../src/screens/${file}`), "utf8");
    const at = source.indexOf(anchor);
    const row = source.slice(at, at + 900);
    // Kotak <button> tak menumbuhkan tingginya untuk baris flex yang membungkus: tombolnya
    // `block`, dan yang `flex` adalah <span> di dalamnya.
    expect(row).toContain('display: "block"');
    expect(row).toMatch(/<span className="hn-dense-row hn-picker-row"/);
  });

  it("memberi judul barisnya sendiri di mobile lewat aturan yang menang atas nowrap inline", () => {
    expect(mobile).toMatch(/\.hn-picker-row\s*\{\s*flex-wrap:\s*wrap/);
    const rule = mobile.slice(mobile.indexOf(".hn-picker-row > .hn-picker-title"));
    expect(rule).toMatch(/flex:\s*1 1 100%\s*!important/);
    expect(rule).toMatch(/white-space:\s*normal\s*!important/);
  });
});

describe("SPEC-763 · pil update tak sendirian memaksa topbar jadi tiga baris", () => {
  const status = (latestVersion: string | null): UpdateStatus => ({
    currentVersion: "0.1.33", latestVersion, updateAvailable: true,
    command: "npm i -g hanoman@latest", canApply: false,
  } as UpdateStatus);

  it("meringkas label jadi versinya saja — bukan menghapus teks sampai tersisa ikon telanjang", () => {
    expect(updateBadgeLabel(status("0.1.34"))).toBe("Update · 0.1.34");
    expect(updateBadgeLabelShort(status("0.1.34"))).toBe("0.1.34");
    // Tanpa versi tak ada yang bisa diringkas; kata "Update" wajib bertahan.
    expect(updateBadgeLabelShort(status(null))).toBe("Update");
  });

  it("menukar bentuk panjang dengan bentuk ringkas hanya di mobile", () => {
    expect(css).toMatch(/\.hn-topbar-label-short\s*\{\s*display:\s*none/);
    expect(mobile).toMatch(/\.hn-topbar-label\s*\{\s*display:\s*none/);
    expect(mobile).toMatch(/\.hn-topbar-label-short\s*\{\s*display:\s*inline/);
  });
});
