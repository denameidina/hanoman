/* SPEC-361 · tombol unduh .md/.pdf terpasang di SETIAP pratinjau Markdown.
   SpecDocsModal sengaja diuji sekali saja: komponen yang sama dipakai Backlog dan Terminal. */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

// Audit UI/UX 2026-10 (3H): berkas IDE di tab Berkas (default-nya Perubahan).
async function openBerkas() {
  const list = await screen.findByRole("tablist", { name: "Bagian IDE" });
  fireEvent.click(within(list).getByRole("tab", { name: "Berkas" }));
}
import { describe, it, expect, vi, beforeEach } from "vitest";
import { paths } from "@hanoman/shared";

const PRD = {
  slug: "x", name: "x.md", path: "docs/prd/x.md", title: "PRD X",
  live: false, projectId: "p1", projectName: "P1",
};

vi.mock("../src/api/client", () => ({
  api: {
    getSpecDocs: vi.fn(async () => ({ files: [
      { kind: "plan", path: "docs/superpowers/plans/x.md", name: "x.md" },
    ] })),
    getSpecDocFile: vi.fn(async () => ({ path: "docs/superpowers/plans/x.md", content: "# X" })),
    getDocs: vi.fn(async () => ({ coverage: 100, tree: [
      { cat: "internal/docs/product", files: ["prd.md"], linked: true, scored: true },
    ] })),
    getDoc: vi.fn(async () => ({ path: "internal/docs/product/prd.md", content: "# prd" })),
    listPrds: vi.fn(async () => ({ items: [PRD] })),
    listAllPrds: vi.fn(async () => ({ items: [PRD] })),
    getPrd: vi.fn(async () => ({ path: "docs/prd/x.md", content: "# PRD X" })),
    getBreakdown: vi.fn(async () => ({ items: [], live: false })),
    ideTree: vi.fn(async () => ({ ref: "", files: ["README.md"] })),
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    ideFile: vi.fn(async () => ({ path: "README.md", content: "# hi", binary: false, truncated: false })),
    ideWorkingStatus: vi.fn(async () => ({ branch: "main", staged: [], unstaged: [] })),
    specDocDownloadUrl: (id: string, p: string, f: "md" | "pdf") => paths.download(paths.specDocFile(id, p), f),
    docDownloadUrl: (id: string, p: string, f: "md" | "pdf") => paths.download(paths.docFile(id, p), f),
    prdDownloadUrl: (id: string, p: string, f: "md" | "pdf") => paths.download(paths.prdFile(id, p), f),
    ideFileDownloadUrl: (id: string, p: string, ref: string, f: "md" | "pdf") =>
      paths.download(paths.ideFile(id, p, ref), f),
  },
  ApiError: class extends Error {},
}));

import { SpecDocsModal } from "../src/screens/SpecDocsModal";
import { DocsWorkspace } from "../src/screens/DocsWorkspace";
import { PrdScreen } from "../src/screens/PrdScreen";
import { IdeScreen } from "../src/screens/IdeScreen";

beforeEach(() => vi.clearAllMocks());

const mdLink = () => screen.getByRole("link", { name: /unduh \.md/i });
const pdfLink = () => screen.getByRole("link", { name: /unduh \.pdf/i });
const projects = [{ id: "p1", name: "P1" }] as never[];

describe("tombol unduh pada pratinjau dokumen", () => {
  it("SpecDocsModal (dipakai Backlog & Terminal) menaut dokumen backlog yang dibuka", async () => {
    render(<SpecDocsModal specId="SPEC-361" onClose={() => {}} />);
    await waitFor(() => expect(pdfLink()).toBeInTheDocument());
    expect(mdLink()).toHaveAttribute("href", "/api/specs/SPEC-361/docs/docs/superpowers/plans/x.md?download=md");
    expect(pdfLink()).toHaveAttribute("href", "/api/specs/SPEC-361/docs/docs/superpowers/plans/x.md?download=pdf");
  });

  it("DocsWorkspace menaut dokumen Source of Truth yang terpilih", async () => {
    // Redesign 3P: unduh ada di menu ⋯ kepala dokumen (mode Baca).
    render(<DocsWorkspace projectId="p1" projectName="P1" docStatus="ok" />);
    const menu = await screen.findByRole("button", { name: "Aksi untuk dokumen" });
    fireEvent.click(menu);
    await waitFor(() => expect(mdLink()).toBeInTheDocument());
    expect(mdLink()).toHaveAttribute("href", "/api/projects/p1/docs/internal/docs/product/prd.md?download=md");
    expect(pdfLink()).toHaveAttribute("href", "/api/projects/p1/docs/internal/docs/product/prd.md?download=pdf");
  });

  it("PrdScreen menaut PRD yang sedang dipratinjau", async () => {
    render(<PrdScreen projects={projects} projectFilter="p1" onProjectFilter={() => {}}
      onNewPrd={() => {}} onTakeToBacklog={() => {}}
      onStartBreakdown={() => {}} onMaterialize={async () => 0} />);
    fireEvent.click(await screen.findByText("PRD X"));
    // Redesign 3P: unduh PRD ada di menu ⋯ bar aksi sticky, bukan tombol terpisah.
    fireEvent.click(await screen.findByRole("button", { name: "Aksi lain PRD" }));
    await waitFor(() => expect(mdLink()).toBeInTheDocument());
    expect(mdLink()).toHaveAttribute("href", "/api/projects/p1/prds/docs/prd/x.md?download=md");
    expect(pdfLink()).toHaveAttribute("href", "/api/projects/p1/prds/docs/prd/x.md?download=pdf");
  });

  it("IdeScreen menaut berkas yang dibuka di Explorer", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await openBerkas();
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(mdLink()).toBeInTheDocument());
    expect(mdLink()).toHaveAttribute("href", "/api/projects/p1/file?path=README.md&download=md");
    expect(pdfLink()).toHaveAttribute("href", "/api/projects/p1/file?path=README.md&download=pdf");
  });
});
