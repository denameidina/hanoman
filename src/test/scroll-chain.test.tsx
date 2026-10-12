/* SPEC-393 · pane yang bergulir harus BENAR-BENAR bisa digulir.
   SPEC-363 memindahkan tinggi pane Docs/IDE ke rantai flex, tapi memasangnya lewat `style` pada
   div TERLUAR `Card` saja. `Card` selalu menyisipkan satu pembungkus `<div>` di sekitar
   `children` yang `display: block` kecuali prop `fill` dipasang — jadi `flex: 1 1 auto` di pane
   jadi inert, pane tumbuh setinggi isinya, dan `Card` (`overflow: hidden`) memotongnya. Terukur
   di Chrome: pane 11 830 px di dalam kartu 701 px, 11 184 px terpotong, tanpa scroller mana pun.

   Test SPEC-363 lolos sepanjang bug ini karena ia hanya memeriksa style PANE-nya sendiri, yang
   memang tak pernah salah. Yang harus dijaga adalah INDUK-induknya, jadi di sini rantai leluhur
   yang dinaiki. jsdom tak melayout — yang diuji kontrak style tiap mata rantai. */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

// Audit UI/UX 2026-10 (3H): berkas IDE di tab Berkas (default-nya Perubahan).
async function openBerkas() {
  const list = await screen.findByRole("tablist", { name: "Bagian IDE" });
  fireEvent.click(within(list).getByRole("tab", { name: "Berkas" }));
}
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { injectProjectCss } from "./project-css";

vi.mock("../src/api/client", () => ({
  api: {
    getDocs: vi.fn(async () => ({ coverage: 100, tree: [
      { cat: "internal/docs/product", files: ["prd.md"], linked: true, scored: true },
    ] })),
    getDoc: vi.fn(async () => ({ path: "internal/docs/product/prd.md", content: "# prd" })),
    docDownloadUrl: () => "#",
    ideTree: vi.fn(async () => ({ ref: "", files: ["README.md"] })),
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    ideFile: vi.fn(async () => ({ path: "README.md", content: "# hi", binary: false, truncated: false })),
    ideWorkingStatus: vi.fn(async () => ({ branch: "main", staged: [], unstaged: [] })),
    ideFileDownloadUrl: () => "#",
    // Git Graph — cukup untuk membuka satu commit lalu satu berkas .md di modalnya.
    getConfig: vi.fn(async () => ({ entries: [] })),
    ideGraph: vi.fn(async () => ({ current: "main", commits: [
      { sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["main"], tags: [] },
    ] })),
    ideStatus: vi.fn(async () => ({ branch: "main", clean: true, ahead: 0, behind: 0,
      staged: [], unstaged: [], untracked: [] })),
    ideStashes: vi.fn(async () => []),
    ideCommit: vi.fn(async () => ({ sha: "aaaa111", parents: [], author: "t", at: "", subject: "kedua",
      body: "", changed: [{ path: "docs/a.md", add: 1, del: 0, status: "M", binary: false }],
      signed: false, committer: "t", committedAt: "", authorEmail: "t@t" })),
    ideCommitFile: vi.fn(async () => ({ path: "docs/a.md", status: "M", binary: false, truncated: false,
      diff: "@@ -1 +1 @@\n+# Judul", content: "# Judul\n\nisi" })),
    ideCommitFileDownloadUrl: () => "#",
    ideCompareFileDownloadUrl: () => "#",
  },
  ApiError: class extends Error {},
}));

import { DocsWorkspace } from "../src/screens/DocsWorkspace";
import { IdeScreen } from "../src/screens/IdeScreen";
import { GitGraph } from "../src/screens/GitGraph";

beforeAll(() => injectProjectCss());
beforeEach(() => vi.clearAllMocks());

/* "Kerangka" = leluhur yang tingginya sudah PASTI dengan sendirinya: panel ber-`maxHeight`/
   `height`, atau overlay `position: fixed`. Ia sumber batas tinggi, jadi ia sendiri tak perlu
   bisa menyusut — cukup meneruskan (kolom flex). */
/* Nilai efektif: inline bila ada, selain itu kaskade dari CSS proyek (lihat project-css.ts). Layout
   yang kini kelas (ide.css, app.css) terbaca lewat kaskade; yang masih inline tetap terbaca seperti dulu. */
type Prop = "display" | "minHeight" | "height" | "maxHeight" | "position";
const effective = (n: HTMLElement, prop: Prop): string => n.style[prop] || getComputedStyle(n)[prop];

const isFrame = (n: HTMLElement) => effective(n, "position") === "fixed" || !!effective(n, "height") || !!effective(n, "maxHeight");

/* Sebuah pane `overflow: auto` hanya bisa menggulir kalau tingginya dibatasi dari atas. Setiap
   leluhur antara pane dan kerangka (atau root layar) karena itu harus MENERUSKAN tinggi: menjadi
   container flex/grid (supaya `flex` anaknya berlaku) DAN boleh menyusut di bawah tinggi isinya
   (`min-height: 0`). Satu mata rantai `display: block` sudah cukup memutus semuanya — persis yang
   dilakukan pembungkus anak `Card` tanpa prop `fill`. */
function brokenLinks(pane: HTMLElement, root: HTMLElement): string[] {
  const broken: string[] = [];
  for (let n = pane.parentElement; n; n = n.parentElement) {
    const frame = isFrame(n);
    const display = effective(n, "display");
    const why: string[] = [];
    if (display !== "flex" && display !== "grid") why.push(`display "${display || "block"}"`);
    const minHeight = effective(n, "minHeight");
    if (!frame && minHeight !== "0" && minHeight !== "0px") {
      why.push(`min-height "${minHeight || "auto"}"`);
    }
    if (why.length) broken.push(`<div style="${n.getAttribute("style") ?? ""}"> → ${why.join(" + ")}`);
    if (frame || n === root) break;
  }
  return broken;
}

const rootOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe("rantai gulir pane tak boleh putus (SPEC-393)", () => {
  it("Docs · SoT — pane dokumen", async () => {
    const { container } = render(<DocsWorkspace projectId="p1" projectName="P1" docStatus="ok" />);
    await waitFor(() => expect(screen.getByTestId("doc-preview-scroll")).toBeInTheDocument());
    expect(brokenLinks(screen.getByTestId("doc-preview-scroll"), rootOf(container))).toEqual([]);
  });

  it("IDE · Explorer — pane berkas (preview, source, diff)", async () => {
    const { container } = render(<IdeScreen projects={[{ id: "p1", name: "P1" }] as never[]}
      projectId="p1" onProject={() => {}} />);
    await openBerkas();
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(screen.getByTestId("doc-preview-scroll")).toBeInTheDocument());
    expect(brokenLinks(screen.getByTestId("doc-preview-scroll"), rootOf(container))).toEqual([]);
  });

  it("IDE · Explorer — pane pohon berkas", async () => {
    const { container } = render(<IdeScreen projects={[{ id: "p1", name: "P1" }] as never[]}
      projectId="p1" onProject={() => {}} />);
    await openBerkas();
    await waitFor(() => expect(screen.getByTestId("ide-tree-scroll")).toBeInTheDocument());
    expect(brokenLinks(screen.getByTestId("ide-tree-scroll"), rootOf(container))).toEqual([]);
  });

  /* Modal berkas Git Graph kena bug yang sama: kartunya ber-`maxHeight: 86vh` (kerangka) tapi
     badannya menggantung di pembungkus anak `Card` yang `display: block`. Terukur di Chrome:
     11 162 px hilang dari isi 11 859 px, tanpa satu pun scroller. */
  it("IDE · Git Graph — pane badan modal berkas", async () => {
    const { container } = render(<GitGraph projectId="p1" onRunGit={async () => ({} as never)}
      onMerge={async () => {}} onRebase={async () => {}} onPull={async () => {}} onDrop={async () => {}}
      onOpenFile={() => {}} />);
    fireEvent.click(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("docs/a.md"));
    await waitFor(() => expect(screen.getByTestId("gitgraph-file-scroll")).toBeInTheDocument());
    expect(brokenLinks(screen.getByTestId("gitgraph-file-scroll"), rootOf(container))).toEqual([]);
  });
});
