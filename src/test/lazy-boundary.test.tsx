// ADR-0160 · chunk layar malas yang gagal diunduh tak boleh memutihkan seluruh App.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LazyBoundary } from "../src/ds/LazyBoundary";

afterEach(() => vi.restoreAllMocks());

describe("LazyBoundary", () => {
  it("merender anak saat tak ada galat", () => {
    render(<LazyBoundary><div>isi layar</div></LazyBoundary>);
    expect(screen.getByText("isi layar")).toBeTruthy();
  });

  it("layar malas yang melempar → blok galat + tombol Muat ulang", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});   // React mencetak stack boundary
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload }, writable: true });
    const Broken = React.lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    render(
      <LazyBoundary>
        <React.Suspense fallback={<div>memuat</div>}><Broken /></React.Suspense>
      </LazyBoundary>,
    );
    expect(await screen.findByText("Halaman gagal dimuat")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
