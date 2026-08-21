/* SPEC-879 · regresi layout IDE yang terukur di browser sungguhan (Chrome headless, 390/820/1100px,
   instance hanoman terisolasi, repo dengan 7 branch & 2 worktree). jsdom tak punya layout engine,
   jadi yang diikat di sini adalah MEKANISME yang membuat pengukuran itu berubah, bukan pikselnya:

   1. Baris kepala tanpa pemilik sisa lebar. `<Tabs>` dan toolbar sama-sama `flex: 0 1 auto`, jadi
      tak ada yang menyerap kekurangan: begitu jumlahnya melewati baris, SELURUH toolbar turun.
      Terukur di ~1100px pada viewport yang sama — tab Explorer memberi kepala satu baris, tab
      Worktrees dua — semata karena label tab aktif dirender `font-weight: 600`. Di 390px toolbar
      membungkus sendiri jadi dua baris → kepala tiga baris, 154px dari 844px.

   2. `.hn-local-overflow` yang membungkus seluruh kartu Git Graph adalah scroller MATI: anaknya
      blok, dan blok selalu selebar induknya (terukur `content = box = 362` di 390px). Karena
      scroller-nya mati, barisnya yang membayar: 200 tombol subject terukur `0×44` — bukan
      terpotong, hilang — dan pill ref yang `flex: 0 0 auto` meluber menimpa kolom author.

   3. Baris Branches/Worktrees adalah flex satu baris tanpa `flex-wrap`: tombol Hapus tiap baris
      terukur 145–363px di luar layar di 390px, dan 17px di 820px.

   4. `<input type="checkbox">` mentah di kontrol tampilan Git Graph direntangkan aturan mobile
      `input { min-height: var(--touch-target) }` jadi kotak biru 44×44. */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8");
const mobile = css.slice(css.indexOf("@media (max-width: 767px) {"));
const source = (file: string) =>
  readFileSync(resolve(import.meta.dirname, `../src/screens/${file}`), "utf8");

vi.mock("../src/api/client", () => ({
  api: {
    ideTree: vi.fn(async () => ({ ref: "", files: ["README.md"] })),
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    ideWorkingStatus: vi.fn(async () => ({ branch: "main", staged: [], unstaged: [] })),
    ideFile: vi.fn(async () => ({ path: "README.md", content: "# hi", binary: false, truncated: false })),
    ideFileDownloadUrl: () => "#",
  },
  ApiError: class extends Error {},
}));

import { IdeScreen } from "../src/screens/IdeScreen";

beforeEach(() => vi.clearAllMocks());

const renderIde = () => render(
  <IdeScreen projectId="p1" projects={[{ id: "p1", name: "P1" }] as never[]}
    onProject={() => {}} onToast={() => {}} />,
);

describe("SPEC-879 · baris kepala IDE punya pemilik sisa lebar", () => {
  it("memberi strip tab sisa lebar sehingga kekurangan dibayar gulir, bukan wrap", () => {
    const rule = css.slice(css.indexOf(".hn-ide-head {"), css.indexOf(".hn-ide-toolbar {"));
    expect(rule).toMatch(/\.hn-ide-head\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(rule).toMatch(/\.hn-ide-head > \.hn-tabs\s*\{[^}]*flex:\s*1 1 auto/s);
    expect(rule).toMatch(/\.hn-ide-head > \.hn-tabs\s*\{[^}]*min-width:\s*0/s);
  });

  it("menjadikan toolbar satu baris yang MENGGULIR di mobile, bukan dua baris yang membungkus", () => {
    expect(mobile).toMatch(/\.hn-ide-head > \*\s*\{[^}]*flex:\s*1 1 100%/s);
    expect(mobile).toMatch(/\.hn-ide-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(mobile).toMatch(/\.hn-ide-toolbar\s*\{[^}]*overflow-x:\s*auto/s);
    // Scroller tanpa aturan ini adalah scroller MATI (akar SPEC-763): itemnya menyusut sampai
    // labelnya tumpah, dan strip-nya tak pernah punya konten lebih lebar untuk digulir.
    expect(mobile).toMatch(/\.hn-ide-toolbar > \*\s*\{[^}]*flex:\s*0 0 auto/s);
  });

  it("memasang kedua kelas itu di layar IDE, dengan strip tab sebagai anak langsung", () => {
    const { container } = renderIde();
    const head = container.querySelector('[role="tablist"]')!.parentElement!;
    expect(head).toHaveClass("hn-ide-head");
    expect(head.querySelector(":scope > .hn-ide-toolbar")).not.toBeNull();
    // `space-between` tak punya arti lagi begitu strip tab yang menyerap sisa lebar.
    expect(head.style.justifyContent).toBe("");
  });
});
