// Audit UI/UX 2026-10 (1F) · pohon berkas: role tree/treeitem, aria-expanded, satu tab stop,
// dan navigasi panah (bawah, kanan membuka folder, kiri naik ke induk).
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { buildFileTree, TreeRoot, TreeRow } from "../src/screens/file-tree";

function renderTree() {
  const nodes = buildFileTree(["src/a.ts", "README.md"]);
  return render(
    <TreeRoot label="Pohon uji" nodes={nodes}>
      {nodes.map((n) => <TreeRow key={n.path} node={n} selected="" onSelect={() => {}} />)}
    </TreeRoot>,
  );
}

describe("file-tree · aksesibilitas keyboard", () => {
  it("memakai role tree dengan satu tab stop dan aria-expanded", () => {
    renderTree();
    expect(screen.getByRole("tree", { name: "Pohon uji" })).toBeInTheDocument();
    const [src, readme] = screen.getAllByRole("treeitem");
    expect(src).toHaveAttribute("aria-expanded", "false");
    expect(src).toHaveAttribute("tabindex", "0");
    expect(readme).toHaveAttribute("tabindex", "-1");
  });

  it("panah kanan membuka folder, panah bawah masuk ke anak, panah kiri kembali ke induk", () => {
    renderTree();
    const src = screen.getByRole("treeitem", { name: "src/" });
    src.focus();
    fireEvent.keyDown(src, { key: "ArrowRight" });
    expect(src).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(src, { key: "ArrowDown" });
    const child = screen.getByRole("treeitem", { name: "a.ts" });
    expect(child).toHaveFocus();
    fireEvent.keyDown(child, { key: "ArrowLeft" });
    expect(src).toHaveFocus();
  });
});
