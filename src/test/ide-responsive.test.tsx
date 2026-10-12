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
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8");
const mobile = css.slice(css.indexOf("@media (max-width: 767px) {"));
const source = (file: string) =>
  readFileSync(resolve(import.meta.dirname, `../src/screens/${file}`), "utf8");
const ideCss = readFileSync(resolve(import.meta.dirname, "../src/screens/styles/ide.css"), "utf8");

vi.mock("../src/api/client", () => ({
  api: {
    ideTree: vi.fn(async () => ({ ref: "", files: ["README.md"] })),
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    ideWorkingStatus: vi.fn(async () => ({ branch: "main", staged: [], unstaged: [] })),
    ideFile: vi.fn(async () => ({ path: "README.md", content: "# hi", binary: false, truncated: false })),
    ideFileDownloadUrl: () => "#",
    getConfig: vi.fn(async () => ({ entries: [] })),
    ideGraph: vi.fn(async () => ({ current: "main", commits: [
      { sha: "aaaa111", parents: [], author: "Dena", at: "2026-01-02T00:00:00Z",
        subject: "feat(terminal): perekam diagnostik jalur ketik", refs: ["main"], tags: [] },
    ] })),
    ideStatus: vi.fn(async () => ({ branch: "main", clean: true, ahead: 0, behind: 0,
      staged: [], unstaged: [], untracked: [] })),
    ideStashes: vi.fn(async () => []),
  },
  ApiError: class extends Error {},
}));

import { IdeScreen } from "../src/screens/IdeScreen";
import { GitGraph } from "../src/screens/GitGraph";

beforeEach(() => vi.clearAllMocks());

const renderIde = () => render(
  <IdeScreen projectId="p1" projects={[{ id: "p1", name: "P1" }] as never[]}
    onProject={() => {}} onToast={() => {}} />,
);

describe("SPEC-879 · baris kepala IDE punya pemilik sisa lebar", () => {
  it("memutuskan pecah-baris lewat flex-basis yang DINYATAKAN, bukan lebar isi", () => {
    const head = css.slice(css.indexOf(".hn-ide-head {"), css.indexOf(".hn-ide-toolbar > *"));
    expect(head).toMatch(/\.hn-ide-head\s*\{[^}]*flex-wrap:\s*wrap/s);
    // Empat tab adalah navigasi IDE — merekalah yang tak boleh menyusut.
    expect(head).toMatch(/\.hn-ide-head > \.hn-tabs\s*\{[^}]*flex:\s*0 0 auto/s);
    // `flex-wrap` memutus baris memakai hypothetical main size = flex-basis. Basis `auto` berarti
    // LEBAR ISI, dan itulah yang membuat kepala ~1100px berdiri sejauh satu label tebal dari pecah.
    expect(head).toMatch(/\.hn-ide-toolbar\s*\{[^}]*flex:\s*1 1 \d+px/s);
    expect(head).not.toMatch(/\.hn-ide-toolbar\s*\{[^}]*flex:\s*1 1 auto/s);
  });

  // Audit UI/UX 2026-10 (QA P1): toolbar MEMBUNGKUS, tidak lagi menggulir. Gulir mendatar di app.css
  // (SPEC-879) membuat selector project 648px dan memotong selector cabang di luar layar. app.css
  // masih memuat `nowrap` itu (berkas di luar lingkup Fase ini); aturan efektifnya ada di ide.css.
  it("toolbar membungkus kontrolnya dan selector project/ref boleh menyusut (ide.css mengalahkan app.css)", () => {
    expect(ideCss).toMatch(/\.hn-ide-head > \.hn-ide-toolbar\s*\{\s*flex-wrap:\s*wrap;\s*overflow:\s*visible;\s*\}/);
    // `> * { flex: 0 0 auto }` di app.css memaksa lebar intrinsik `<select>` (opsi terpanjang).
    // Tanpa min-width:0 flex item tak pernah lebih kecil dari itu.
    expect(ideCss).toMatch(/\.hn-ide-head > \.hn-ide-toolbar > \.hn-ide-proyek,\s*\.hn-ide-head > \.hn-ide-toolbar > \.hn-ide-ref\s*\{\s*min-width:\s*0;\s*max-width:\s*100%/s);
    expect(ideCss).toMatch(/\.hn-ide-head > \.hn-ide-toolbar > \.hn-ide-proyek \{ flex: 1 1 140px/);
    expect(ideCss).toMatch(/\.hn-ide-head > \.hn-ide-toolbar > \.hn-ide-ref \{ flex: 1 1 140px/);
    expect(ideCss).toMatch(/\.hn-ide-head > \.hn-ide-toolbar \.hn-select select\s*\{[^}]*text-overflow:\s*ellipsis/s);
    // Di ponsel nama project mendapat baris penuh; ref dan tombol mengalir di bawahnya.
    expect(ideCss).toMatch(/@media \(max-width: 767px\)\s*\{[\s\S]*?\.hn-ide-head > \.hn-ide-toolbar > \.hn-ide-proyek\s*\{\s*flex-basis:\s*100%/);
    // Rata kanan lewat margin auto: `justify-content: flex-end` membuat AWAL konten tak
    // terjangkau begitu kontainernya menggulir.
    expect(css).toMatch(/\.hn-ide-toolbar > :first-child\s*\{\s*margin-inline-start:\s*auto/s);
  });

  it("selector project dan ref memakai kelasnya di dalam toolbar, dan nama project utuh di title", () => {
    const { container } = renderIde();
    const proyek = screen.getByRole("combobox", { name: "Proyek" });
    const ref = screen.getByRole("combobox", { name: "Ref yang dilihat" });
    expect(proyek.closest(".hn-select")).toHaveClass("hn-ide-proyek");
    expect(ref.closest(".hn-select")).toHaveClass("hn-ide-ref");
    expect(container.querySelector(".hn-ide-toolbar")!.contains(proyek)).toBe(true);
    // Nama yang dipotong ellipsis tetap terbaca lewat tooltip.
    expect(proyek).toHaveAttribute("title", "P1");
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

const renderGraph = () => render(
  <GitGraph projectId="p1" onRunGit={async () => ({ ok: true } as never)}
    onMerge={async () => {}} onRebase={async () => {}} onPull={async () => {}}
    onDrop={async () => {}} onOpenFile={() => {}} />,
);

describe("SPEC-879 · region baris Git Graph adalah scroller lokal yang HIDUP", () => {
  // `getConfig` yang mendarat belakangan mengubah `gopts` → `load()` berjalan lagi dan
  // `setState("loading")` MENGGANTI seluruh subtree. Setiap assert karena itu me-query ulang di
  // dalam `waitFor`; simpul yang dipegang dari `find*` sebelumnya sudah basi.
  it("membungkus baris commit — bukan seluruh kartu — dengan scroller ber-lebar minimum", async () => {
    renderGraph();
    await waitFor(() => {
      const rows = screen.getByTestId("ide-graph-rows");
      expect(rows).toHaveClass("hn-local-overflow");
      // Anak blok selalu selebar induknya; tanpa `min-width` scroller ini tak pernah punya konten
      // lebih lebar untuk digulir — terukur 362 = 362 di 390px, `canScroll: false`.
      const inner = rows.firstElementChild as HTMLElement;
      // Lebar minimum daftar ada di CSS variable (dinamis per jumlah lane); kelasnya memakainya.
      expect(Number.parseInt(inner.style.getPropertyValue("--graph-min-w"), 10)).toBeGreaterThanOrEqual(460);
      expect(ideCss).toMatch(/\.hn-git-rows\s*\{[^}]*min-width:\s*var\(--graph-min-w/s);
      // Kartunya sendiri TAK boleh lagi berada di dalam scroller mendatar.
      expect(rows.closest(".hn-local-overflow")).toBe(rows);
    });
  });

  it("menaruh baris commit di dalam scroller dan baris penutup SPEC-351 di luarnya", async () => {
    renderGraph();
    await waitFor(() => {
      const rows = screen.getByTestId("ide-graph-rows");
      expect(rows.contains(screen.getByRole("button", { name: /Buka commit aaaa111/ }))).toBe(true);
      // Sentinel IntersectionObserver menempel pada `<main>` yang menggulir tegak; menaruhnya di
      // dalam scroller mendatar tak menambah apa pun kecuali risiko.
      expect(rows.contains(screen.getByText(/commit dimuat|dari \d+ commit/))).toBe(false);
    });
  });
});

// Audit UI/UX 2026-10 (3H): branch dan worktree kini satu daftar di CabangPanel.tsx; baris
// (`CabangRow`) menggantikan dua baris lama BranchesPanel & WorktreesPanel.
describe("SPEC-879 · baris Cabang membungkus sebelum memotong", () => {
  it("CabangRow memakai hn-dense-row dan boleh membungkus di tier mana pun", () => {
    const src = source("CabangPanel.tsx");
    const at = src.indexOf("function CabangRow(");
    expect(at).toBeGreaterThan(-1);
    const row = src.slice(at, at + 900);
    // `.hn-dense-row` memberi nama (anak ber-`flex: 1`) lebar minimum 220px di mobile; `flexWrap`
    // inline berlaku di SEMUA tier karena yang bocor di 820px cuma 17px — membungkus satu tombol
    // ke baris kedua jauh lebih baik daripada memotongnya.
    expect(row).toContain('className="hn-dense-row"');
    expect(row).toContain('flexWrap: "wrap"');
  });

  it("CabangRow: kolom meta tetap rata kanan sesudah membungkus", () => {
    // Sesudah baris membungkus, kolom meta mendarat di baris kedua; tanpa `margin-left: auto` ia
    // menempel ke kiri dan barisnya kehilangan bentuknya.
    expect(source("CabangPanel.tsx")).toMatch(/minWidth:\s*\d+,\s*\n?\s*marginLeft:\s*"auto",\s*textAlign:\s*"right"/s);
  });

  it.each([["IdeScreen.tsx"], ["GitGraph.tsx"], ["CabangPanel.tsx"], ["ide-menu.tsx"]] as const)(
    "%s: tak memakai `all: unset` (ia menang atas min-height target sentuh DAN atas flex-wrap)",
    (file) => expect(source(file)).not.toContain('all: "unset"'));
});

describe("SPEC-879 · kontrol IDE memakai primitive design system", () => {
  it("Git Graph tak lagi memakai <input type=checkbox> mentah", async () => {
    const { container } = renderGraph();
    // Audit UI/UX 2026-10 (3H): remote/tag/redupkan merge ada di disclosure "Tampilan".
    fireEvent.click(await screen.findByRole("button", { name: "Tampilan" }));
    await waitFor(() => {
      // `input { min-width/min-height: var(--touch-target) }` merentangkan checkbox mentah jadi
      // kotak biru 44×44; `Checkbox` DS menaruh kotak 18×18 DI DALAM area sentuh itu.
      for (const name of ["remote", "tag", "redupkan merge"]) {
        expect(screen.getByRole("checkbox", { name })).toBeInTheDocument();
      }
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    });
  });

  it("label tujuan Berkas menyerap sisa lebar, bukan bergantung pada spacer yang boleh runtuh", async () => {
    renderIde();
    const list = await screen.findByRole("tablist", { name: "Bagian IDE" });
    fireEvent.click(within(list).getByRole("tab", { name: "Berkas" }));
    const dest = await screen.findByTestId("ide-entry-dest");
    expect(dest).toHaveTextContent("→ root");
    // Sisa lebar dipegang kelas di ide.css (jsdom tak memuat CSS).
    expect(dest).toHaveClass("hn-ide-dest");
    expect(ideCss).toMatch(/\.hn-ide-dest\s*\{[^}]*flex:\s*1 1 auto/s);
    const spacers = [...dest.parentElement!.children].filter((c) =>
      c !== dest && !c.textContent?.trim() && ((c as HTMLElement).style.flex === "1" || c.classList.contains("hn-grow")));
    expect(spacers).toHaveLength(0);
  });

  it("editor berkas tak memaksa tinggi tetap yang melewati viewport ponsel", () => {
    expect(ideCss).toMatch(/\.hn-ide-editor\s*\{[^}]*min-height:\s*clamp\(240px, 50dvh, 560px\)/s);
    expect(source("IdeScreen.tsx")).not.toContain("minHeight: 560");
  });
});

// Audit UI/UX 2026-10 · Fase 4 QA (IDE): fokus dan target sentuh. jsdom tak memuat CSS, jadi yang
// diikat di sini adalah kelas di DOM dan aturan yang dipegang ide.css.
describe("QA · IDE: fokus bertoken dan target sentuh toggle diff/source", () => {
  it("region panel tak memakai ring biru bawaan UA; ring bertoken hanya di mode selector", () => {
    // Region ber-tabIndex=-1 difokus programatik di mode selector; UA menggambar kotak biru di
    // sekeliling seluruh panel. Di mode split ia tak pernah jadi target fokus.
    expect(ideCss).toMatch(/\.hn-ide-screen \.hn-responsive-panel:focus\s*\{\s*outline:\s*none/);
    expect(ideCss).toMatch(
      /\.hn-ide-screen \.hn-responsive-panels\[data-split="false"\] \.hn-responsive-panel:focus-visible\s*\{\s*outline:\s*2px solid var\(--border-focus\)/);
    const { container } = renderIde();
    const panel = container.querySelector('[data-panel="daftar"]')!;
    expect(panel).toHaveAttribute("tabindex", "-1");
    expect(panel.closest(".hn-responsive-panels")).toHaveAttribute("data-split");
  });

  it("toggle diff/source memakai kelas sentuh dan minimum 24px (desktop), 44px (pointer kasar)", async () => {
    const { container } = renderIde();
    await screen.findByRole("tablist", { name: "Bagian IDE" });
    const buttons = [...container.querySelectorAll(".hn-ide-seg button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["diff", "source"]);
    for (const b of buttons) expect(b).toHaveClass("hn-touch-target");
    expect(ideCss).toMatch(/\.hn-ide-seg button\s*\{[^}]*min-height:\s*24px/s);
    expect(ideCss).toMatch(/@media \(pointer: coarse\), \(max-width: 767px\)\s*\{\s*\.hn-ide-seg button\s*\{\s*min-height:\s*44px/s);
  });
});
