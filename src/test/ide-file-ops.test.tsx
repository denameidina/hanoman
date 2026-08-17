import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { buildFileTree, TreeRow } from "../src/screens/file-tree";

// ADR-0121 · folder sebagai TUJUAN operasi berkas.
describe("TreeRow · folder sebagai target", () => {
  it("klik folder memanggil onSelectDir dan menandainya", () => {
    const onSelectDir = vi.fn();
    const nodes = buildFileTree(["src/ds/a.ts"]);
    const { rerender } = render(
      <TreeRow node={nodes[0]!} selected="" onSelect={() => {}} dirSelected="" onSelectDir={onSelectDir} />);
    fireEvent.click(screen.getByText("src/"));
    expect(onSelectDir).toHaveBeenCalledWith("src");
    rerender(<TreeRow node={nodes[0]!} selected="" onSelect={() => {}} dirSelected="src" onSelectDir={onSelectDir} />);
    expect(screen.getByText("src/").closest("button")).toHaveStyle({ background: "var(--brass-100)" });
  });

  it("tanpa onSelectDir perilaku lama utuh: klik hanya buka-tutup", () => {
    const nodes = buildFileTree(["src/ds/a.ts"]);
    render(<TreeRow node={nodes[0]!} selected="" onSelect={() => {}} />);
    expect(screen.queryByText("ds/")).toBeNull();
    fireEvent.click(screen.getByText("src/"));
    expect(screen.getByText("ds/")).toBeInTheDocument();
  });
});
