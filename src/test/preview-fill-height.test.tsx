/* SPEC-363 · jendela pratinjau harus setinggi ruang yang tersedia, bukan angka tetap.
   Diukur di Chrome (audit-spec-363): `62vh` di modal membuang 18–23% tinggi di semua layar,
   dan `maxHeight: 620` MELEBIHI ruang `<main>` di layar 13" (→ dua scrollbar) sekaligus
   memakai kurang dari separuhnya di monitor besar (buang 43% di 1329 px).

   jsdom tak melayout, jadi yang diuji di sini adalah kontrak style-nya: pane menyerap sisa
   tinggi lewat rantai flex (pola `LIST_SCROLL_STYLE`, kit.tsx) dan tak lagi memasang tinggi
   tetap dalam px/vh. */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { paths } from "@hanoman/shared";

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
import { SpecDocsModal } from "../src/screens/SpecDocsModal";
import { DocsWorkspace } from "../src/screens/DocsWorkspace";
import { IdeScreen } from "../src/screens/IdeScreen";
import { mockViewport, resetViewport } from "./viewport";

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
    expect(panel.style.height).toContain("100dvh");
    const body = container.querySelector("[data-testid='modal-body']") as HTMLElement;
    expect(body.style.flex).toBe("1 1 auto");
    expect(body.style.minHeight).toBe("0");
  });

  it("tanpa fillHeight, modal tetap setinggi isinya (20-an modal lain tak berubah)", () => {
    const { container } = render(<Modal open title="X">isi</Modal>);
    const panel = container.querySelector("[data-testid='modal-panel']") as HTMLElement;
    expect(panel.style.height).toBe("");
    const body = container.querySelector("[data-testid='modal-body']") as HTMLElement;
    expect(body.style.flex).toBe("");
  });
});

describe("pane pratinjau menyerap tinggi yang tersedia (SPEC-363)", () => {
  it("DocsWorkspace exposes mounted tree/viewer panels on mobile", async () => {
    mockViewport(390);
    render(<DocsWorkspace projectId="p1" projectName="P1" docStatus="ok" />);
    await screen.findByRole("tablist", { name: "Panel Docs" });
    expect(document.querySelector('[data-panel="tree"]')).toHaveAttribute("aria-hidden", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Dokumen" }));
    expect(document.querySelector('[data-panel="viewer"]')).toHaveAttribute("aria-hidden", "false");
    resetViewport();
  });
  it("SpecDocsModal (Backlog & Terminal) — tanpa 62vh", async () => {
    render(<SpecDocsModal specId="SPEC-363" onClose={() => {}} />);
    await waitFor(() => expect(pane()).toBeInTheDocument());
    expect(pane().style.flex).toBe("1 1 auto");
    expect(pane().style.overflow).toBe("auto");
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
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(pane()).toBeInTheDocument());
    expect(pane().style.flex).toBe("1 1 auto");
    expect(pane().style.overflow).toBe("auto");
    expect(fixedHeightInsideFrame(pane())).toEqual([]);
  });
});
