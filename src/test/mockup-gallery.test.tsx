import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MockupGallery, MockupViewer } from "../src/screens/MockupGallery";
import { api } from "../src/api/client";

// ADR-0233 · galeri mockup: dimuat saat muncul, tak merender apa pun bila kosong, membuka ImageViewer.
const two = {
  source: "worktree" as const, dir: "/repo/.worktrees/spec-1/docs/mockups/spec-1",
  items: [
    { name: "01-a.png", size: 10, modifiedAt: "2026-10-31T00:00:00.000Z" },
    { name: "02-b.png", size: 10, modifiedAt: "2026-10-31T00:00:01.000Z" },
  ],
};
const empty = { source: null, dir: null, items: [] };

beforeEach(() => { vi.restoreAllMocks(); });

describe("MockupGallery (ADR-0233)", () => {
  it("varian button: kosong → tak merender apa pun", async () => {
    const spy = vi.spyOn(api, "specMockups").mockResolvedValue(empty);
    const { container } = render(<MockupGallery specId="SPEC-1" variant="button" />);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith("SPEC-1"));
    expect(container.textContent).toBe("");
  });

  it("varian button: dua mockup → `Lihat mockup (2)`, klik membuka viewer dengan URL ber-versi", async () => {
    vi.spyOn(api, "specMockups").mockResolvedValue(two);
    render(<MockupGallery specId="SPEC-1" variant="button" />);
    fireEvent.click(await screen.findByRole("button", { name: "Lihat mockup (2)" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("1 / 2 · 01-a.png")).toBeTruthy();
    const main = screen.getByTestId("image-viewer-stage").querySelector("img")!;
    expect(main.getAttribute("src")).toBe(`/api/specs/SPEC-1/mockups/01-a.png?v=${encodeURIComponent("2026-10-31T00:00:00.000Z")}`);
  });

  it("varian section: thumbnail per mockup; klik thumbnail kedua membuka gambar kedua", async () => {
    vi.spyOn(api, "specMockups").mockResolvedValue(two);
    render(<MockupGallery specId="SPEC-1" variant="section" />);
    expect(await screen.findByText("Mockup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lihat mockup 02-b.png" }));
    expect(screen.getByText("2 / 2 · 02-b.png")).toBeTruthy();
  });

  it("varian section: gagal muat → keterangan, bukan diam", async () => {
    vi.spyOn(api, "specMockups").mockRejectedValue(new Error("x"));
    render(<MockupGallery specId="SPEC-1" variant="section" />);
    expect(await screen.findByText("Mockup tak bisa dimuat")).toBeTruthy();
  });
});

describe("MockupViewer (chip fase Mockup)", () => {
  it("ada mockup → langsung viewer; kosong → keterangan Belum ada mockup", async () => {
    vi.spyOn(api, "specMockups").mockResolvedValueOnce(two).mockResolvedValueOnce(empty);
    const { unmount } = render(<MockupViewer specId="SPEC-1" onClose={vi.fn()} />);
    expect(await screen.findByText("1 / 2 · 01-a.png")).toBeTruthy();
    unmount();
    render(<MockupViewer specId="SPEC-1" onClose={vi.fn()} />);
    expect(await screen.findByText("Belum ada mockup")).toBeTruthy();
  });
});
