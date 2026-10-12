/* SPEC-363 · jendela pratinjau harus setinggi ruang yang tersedia, bukan angka tetap.
   Diukur di Chrome (audit-spec-363): `62vh` di modal membuang 18–23% tinggi di semua layar,
   dan `maxHeight: 620` MELEBIHI ruang `<main>` di layar 13" (→ dua scrollbar) sekaligus
   memakai kurang dari separuhnya di monitor besar (buang 43% di 1329 px).

   jsdom tak melayout, jadi yang diuji di sini adalah kontrak style-nya: pane menyerap sisa
   tinggi lewat rantai flex (pola `LIST_SCROLL_STYLE`, kit.tsx) dan tak lagi memasang tinggi
   tetap dalam px/vh. */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

// Audit UI/UX 2026-10 (3H): berkas IDE di tab Berkas (default-nya Perubahan).
async function openBerkas() {
  const list = await screen.findByRole("tablist", { name: "Bagian IDE" });
  fireEvent.click(within(list).getByRole("tab", { name: "Berkas" }));
}
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { paths } from "@hanoman/shared";
import { injectProjectCss } from "./project-css";

vi.mock("../src/api/client", () => ({
  api: {
    getSpecDocs: vi.fn(async () => ({ files: [{ kind: "plan", path: "docs/superpowers/plans/x.md", name: "x.md" }] })),
    getSpecDocFile: vi.fn(async () => ({ path: "docs/superpowers/plans/x.md", content: "# X" })),
    getDocs: vi.fn(async () => ({ coverage: 100, tree: [
      { cat: "internal/docs/product", files: ["prd.md"], linked: true, scored: true },
    ] })),
    getDoc: vi.fn(async () => ({ path: "internal/docs/product/prd.md", content: "# prd" })),
    ideTree: vi.fn(async () => ({ ref: "", files: ["README.md"] })),
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    ideFile: vi.fn(async () => ({ path: "README.md", content: "# hi", binary: false, truncated: false })),
    ideWorkingStatus: vi.fn(async () => ({ branch: "main", staged: [], unstaged: [] })),
    specDocDownloadUrl: (id: string, p: string, f: "md" | "pdf") => paths.download(paths.specDocFile(id, p), f),
    docDownloadUrl: (id: string, p: string, f: "md" | "pdf") => paths.download(paths.docFile(id, p), f),
    ideFileDownloadUrl: (id: string, p: string, ref: string, f: "md" | "pdf") =>
      paths.download(paths.ideFile(id, p, ref), f),
  },
  ApiError: class extends Error {},
}));

import { Modal } from "../src/ds";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SpecDocsModal } from "../src/screens/SpecDocsModal";

// Gaya pane SpecDocsModal kini kelas (`hn-sdm-scroll`) di dialogs.css. jsdom tak menerapkan kaskade
// berkas CSS, jadi aturannya dibaca langsung dari berkasnya; komentar dibuang lebih dulu.
const DIALOGS_CSS = readFileSync(resolve(import.meta.dirname, "../src/screens/styles/dialogs.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
import { DocsWorkspace } from "../src/screens/DocsWorkspace";
import { IdeScreen } from "../src/screens/IdeScreen";
import { mockViewport, resetViewport } from "./viewport";

beforeAll(() => injectProjectCss());
beforeEach(() => vi.clearAllMocks());

const pane = () => screen.getByTestId("doc-preview-scroll");

/* Tinggi tetap = angka px/vh di properti tinggi pada rantai DI DALAM kerangka. Kerangka
   terluar (panel modal `88vh`) sengaja dikecualikan: itulah tinggi turunan-viewport yang
   justru harus ada supaya isinya bisa mengisi. Yang dicari adalah angka tetap di antara
   kerangka dan pane — `62vh` dan `620px` dulu ada di sini. */
function fixedHeightInsideFrame(el: HTMLElement): string[] {
  const found: string[] = [];
  for (let n: HTMLElement | null = el; n && n.dataset.testid !== "modal-panel"; n = n.parentElement) {
    for (const p of ["height", "maxHeight"] as const) {
      const v = n.style[p];
      if (v && /^\d+(\.\d+)?(px|vh)$/.test(v)) found.push(`${n.dataset.testid ?? n.tagName}: ${p} ${v}`);
    }
  }
  return found;
}

describe("Modal fillHeight (SPEC-363)", () => {
  it("memberi panel tinggi pasti agar isinya bisa mengisi, dan badannya menyerap sisa", () => {
    const { container } = render(<Modal open fillHeight title="X">isi</Modal>);
    const panel = container.querySelector("[data-testid='modal-panel']") as HTMLElement;
    // Sejak Audit UI/UX 2026-10 (Z4) tinggi/flex dipindah dari style inline ke kelas (app-shell.css);
    // jsdom tak memuat CSS, jadi kontraknya diuji lewat kelas + isi berkas CSS.
    expect(panel).toHaveClass("hn-modal-panel--fill");
    const body = container.querySelector("[data-testid='modal-body']") as HTMLElement;
    expect(body).toHaveClass("hn-modal-body--fill");
    const css = readFileSync(resolve(__dirname, "../src/styles/app-shell.css"), "utf8");
    expect(css.match(/\.hn-modal-panel--fill\s*\{([^}]*)\}/)?.[1] ?? "").toMatch(/100dvh/);
    const bodyRule = css.match(/\.hn-modal-body--fill\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(bodyRule).toMatch(/flex:\s*1 1 auto/);
    expect(bodyRule).toMatch(/min-height:\s*0/);
  });

  it("tanpa fillHeight, modal tetap setinggi isinya (20-an modal lain tak berubah)", () => {
    const { container } = render(<Modal open title="X">isi</Modal>);
    const panel = container.querySelector("[data-testid='modal-panel']") as HTMLElement;
    expect(panel).not.toHaveClass("hn-modal-panel--fill");
    const body = container.querySelector("[data-testid='modal-body']") as HTMLElement;
    expect(body).not.toHaveClass("hn-modal-body--fill");
  });
});

describe("pane pratinjau menyerap tinggi yang tersedia (SPEC-363)", () => {
  it("DocsWorkspace exposes mounted tree/viewer panels on mobile", async () => {
    mockViewport(390);
    render(<DocsWorkspace projectId="p1" projectName="P1" docStatus="ok" />);
    // Label landmark ikut glosarium Indonesia audit UI/UX 2026-10 ("Docs" → "Dokumen"), bukan hilang.
    await screen.findByRole("tablist", { name: "Panel Dokumen" });
    expect(document.querySelector('[data-panel="tree"]')).toHaveAttribute("aria-hidden", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Dokumen" }));
    expect(document.querySelector('[data-panel="viewer"]')).toHaveAttribute("aria-hidden", "false");
    resetViewport();
  });
  it("SpecDocsModal (Backlog & Terminal) — tanpa 62vh", async () => {
    render(<SpecDocsModal specId="SPEC-363" onClose={() => {}} />);
    await waitFor(() => expect(pane()).toBeInTheDocument());
    expect(pane().className).toContain("hn-sdm-scroll");
    const rule = /\.hn-sdm-scroll\s*\{([^}]*)\}/.exec(DIALOGS_CSS)?.[1] ?? "";
    expect(rule).toMatch(/flex:\s*1 1 auto/);
    expect(rule).toMatch(/overflow:\s*auto/);
    expect(fixedHeightInsideFrame(pane())).toEqual([]);
  });

  it("DocsWorkspace (Docs · SoT) — tanpa maxHeight 620", async () => {
    render(<DocsWorkspace projectId="p1" projectName="P1" docStatus="ok" />);
    await waitFor(() => expect(pane()).toBeInTheDocument());
    expect(pane().style.flex).toBe("1 1 auto");
    expect(pane().style.overflow).toBe("auto");
    expect(fixedHeightInsideFrame(pane())).toEqual([]);
  });

  it("IdeScreen (Explorer) — tanpa maxHeight 620", async () => {
    render(<IdeScreen projects={[{ id: "p1", name: "P1" }] as never[]} projectId="p1" onProject={() => {}} />);
    await openBerkas();
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(pane()).toBeInTheDocument());
    // Z2 · pane IDE kini kelas (ide.css): nilainya dibaca dari kaskade, bukan inline.
    expect(getComputedStyle(pane()).flex).toBe("1 1 auto");
    expect(getComputedStyle(pane()).overflow).toBe("auto");
    expect(fixedHeightInsideFrame(pane())).toEqual([]);
  });
});
