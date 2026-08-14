import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpecDocsModal } from "../src/screens/SpecDocsModal";
import { mockViewport, resetViewport } from "./viewport";

const getSpecDocs = vi.fn();
const getSpecDocFile = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    getSpecDocs: (...a: unknown[]) => getSpecDocs(...a),
    getSpecDocFile: (...a: unknown[]) => getSpecDocFile(...a),
    // SPEC-361 · header preview memasang tombol unduh
    specDocDownloadUrl: (id: string, p: string, f: string) => `/api/specs/${id}/docs/${p}?download=${f}`,
  },
}));

beforeEach(() => { getSpecDocs.mockReset(); getSpecDocFile.mockReset(); });
afterEach(resetViewport);

describe("SpecDocsModal", () => {
  it("offers mounted document list/preview panels on mobile", async () => {
    mockViewport(390);
    getSpecDocs.mockResolvedValue({ files: [
      { kind: "spec", path: "internal/docs/spec.md", name: "spec.md" },
    ] });
    getSpecDocFile.mockResolvedValue({ path: "internal/docs/spec.md", content: "# Spec" });
    render(<SpecDocsModal specId="SPEC-763" onClose={() => {}} />);
    await screen.findByRole("tablist", { name: "Panel dokumen backlog" });
    expect(document.querySelector('[data-panel="files"]')).toHaveAttribute("aria-hidden", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(document.querySelector('[data-panel="preview"]')).toHaveAttribute("aria-hidden", "false");
  });
  it("mengelompokkan file per jenis & me-render markdown file terpilih", async () => {
    getSpecDocs.mockResolvedValue({ files: [
      { kind: "audit", path: "internal/docs/operations/spec-170-x-audit.md", name: "spec-170-x-audit.md" },
      { kind: "plan", path: "docs/superpowers/plans/x-spec-170.md", name: "x-spec-170.md" },
    ]});
    getSpecDocFile.mockResolvedValue({ path: "internal/docs/operations/spec-170-x-audit.md", content: "# Judul Audit" });
    render(<SpecDocsModal specId="SPEC-170" onClose={() => {}} />);
    expect(await screen.findByText("Audit")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    // file pertama auto-terpilih -> isinya di-render sebagai <h1> markdown
    await waitFor(() => expect(screen.getByText("Judul Audit")).toBeInTheDocument());
  });

  it("empty state saat item belum punya dokumen", async () => {
    getSpecDocs.mockResolvedValue({ files: [] });
    render(<SpecDocsModal specId="SPEC-999" onClose={() => {}} />);
    expect(await screen.findByText("Belum ada dokumen untuk item ini")).toBeInTheDocument();
  });
});
