// Audit UI/UX 2026-10 (1F) · Docs: draft kotor ditandai "belum disimpan", dan galat simpan
// tampil inline sambil mempertahankan draft (tak ada yang hilang diam-diam).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const { getDocs, getDoc, putDoc } = vi.hoisted(() => ({
  getDocs: vi.fn(async () => ({ coverage: 100, tree: [
    { cat: "internal/docs/product", files: ["blueprint.md"], linked: true, scored: true },
  ] })),
  getDoc: vi.fn(async () => ({ path: "internal/docs/product/blueprint.md", content: "# Blueprint" })),
  putDoc: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../src/api/client", () => ({
  api: { getDocs, getDoc, putDoc, deleteDoc: vi.fn(), docDownloadUrl: () => "/x" },
  ApiError: class extends Error {},
}));

import { DocsWorkspace } from "../src/screens/DocsWorkspace";

describe("DocsWorkspace · draft & simpan", () => {
  it("draft kotor ditandai dan galat simpan mempertahankan draft", async () => {
    putDoc.mockRejectedValueOnce(new Error("disk penuh"));
    render(<DocsWorkspace projectId="demo" projectName="Demo" docStatus="ok" />);
    const edit = await screen.findByRole("button", { name: "Edit" });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    const area = screen.getByLabelText("Isi internal/docs/product/blueprint.md");
    fireEvent.change(area, { target: { value: "# Baru" } });
    expect(screen.getByText("belum disimpan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Gagal menyimpan dokumen: disk penuh");
    expect(screen.getByLabelText("Isi internal/docs/product/blueprint.md")).toHaveValue("# Baru");
  });
});
