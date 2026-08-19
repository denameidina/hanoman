// SPEC-847 · hapus doc SoT menghapus berkas di disk — AC-1..AC-3 lewat komponen sungguhan.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";

const { getDocs, getDoc, deleteDoc } = vi.hoisted(() => ({
  getDocs: vi.fn(async () => ({ coverage: 100, tree: [
    { cat: "internal/docs/product", files: ["blueprint.md"], linked: true, scored: true },
  ] })),
  getDoc: vi.fn(async () => ({ path: "internal/docs/product/blueprint.md", content: "# Blueprint" })),
  deleteDoc: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../src/api/client", () => ({
  api: {
    getDocs, getDoc, deleteDoc,
    putDoc: vi.fn(async () => ({ ok: true })),
    docDownloadUrl: () => "/x",
  },
  ApiError: class extends Error {},
}));

import { DocsWorkspace } from "../src/screens/DocsWorkspace";

beforeEach(() => { deleteDoc.mockClear(); });

const openDialog = async () => {
  render(<DocsWorkspace projectId="demo" projectName="Demo" docStatus="ok" />);
  const btn = await screen.findByRole("button", { name: "Hapus" });
  btn.focus();
  fireEvent.click(btn);
  await screen.findByRole("dialog");
  return btn;
};

describe("DocsWorkspace hapus doc · konfirmasi aplikasi (SPEC-847)", () => {
  it("dialog menyebut path dokumen dan dampaknya", async () => {
    await openDialog();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/internal\/docs\/product\/blueprint\.md/)).toBeTruthy();
    expect(dialog.getByText(/berkas aslinya di disk/i)).toBeTruthy();
  });

  it("Batal tak memanggil deleteDoc", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("Escape tak memanggil deleteDoc", async () => {
    await openDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("konfirmasi memanggil deleteDoc sekali walau diklik dua kali, lalu fokus kembali ke pemicu", async () => {
    const trigger = await openDialog();
    const ok = screen.getByRole("button", { name: "Hapus dokumen" });
    fireEvent.click(ok); fireEvent.click(ok);
    await waitFor(() => expect(deleteDoc).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
