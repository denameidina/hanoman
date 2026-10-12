import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReviewScreen } from "../src/screens/ReviewScreen";
import { api } from "../src/api/client";
import { mockViewport, resetViewport } from "./viewport";

vi.mock("../src/api/client", () => ({
  api: {
    specReview: vi.fn(), specReviewFile: vi.fn(),
    sessionReview: vi.fn(), sessionReviewFile: vi.fn(),
    specReviewFileDownloadUrl: (id: string, p: string, f: string) => `/api/specs/${id}/review/${p}?download=${f}`,
    sessionReviewFileDownloadUrl: (id: string, p: string, f: string) => `/api/terminal/sessions/${id}/review/${p}?download=${f}`,
  },
}));

// ADR-0218 · tombol "Tandai ditinjau" di bar keputusan Review (item selesai saja, lewat prop dari App).
beforeEach(() => {
  (api.specReview as any).mockResolvedValue({
    base: "abc", files: ["src/a.ts"],
    changed: [{ path: "src/a.ts", add: 3, del: 1, status: "M", binary: false }],
  });
  (api.specReviewFile as any).mockResolvedValue({
    path: "src/a.ts", status: "M", binary: false, truncated: false, diff: "+new", content: "new",
  });
});

const bar = () => screen.findByRole("region", { name: "Keputusan" });

describe("ReviewScreen · tandai sudah ditinjau (ADR-0218)", () => {
  it("tanpa onMarkReviewed tombolnya tidak ada", async () => {
    render(<ReviewScreen specId="SPEC-7" title="Judul" onBack={() => {}} />);
    await bar();
    expect(screen.queryByRole("button", { name: "Tandai ditinjau" })).toBeNull();
  });

  it("belum ditinjau: tombol 'Tandai ditinjau' memanggil dengan reviewed=true", async () => {
    const onMarkReviewed = vi.fn(async () => {});
    render(<ReviewScreen specId="SPEC-7" title="Judul" onBack={() => {}} onMarkReviewed={onMarkReviewed} reviewed={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tandai ditinjau" }));
    await waitFor(() => expect(onMarkReviewed).toHaveBeenCalledWith("SPEC-7", true));
  });

  it("sudah ditinjau: tombolnya berganti 'Batalkan tanda ditinjau' dan memanggil dengan reviewed=false", async () => {
    const onMarkReviewed = vi.fn(async () => {});
    render(<ReviewScreen specId="SPEC-7" title="Judul" onBack={() => {}} onMarkReviewed={onMarkReviewed} reviewed />);
    fireEvent.click(await screen.findByRole("button", { name: "Batalkan tanda ditinjau" }));
    await waitFor(() => expect(onMarkReviewed).toHaveBeenCalledWith("SPEC-7", false));
  });

  it("galat dari layar induk tampil di bar, tidak ditelan", async () => {
    const onMarkReviewed = vi.fn(async () => { throw new Error("backlog item belum selesai"); });
    render(<ReviewScreen specId="SPEC-7" title="Judul" onBack={() => {}} onMarkReviewed={onMarkReviewed} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tandai ditinjau" }));
    expect(await screen.findByText(/menandai ditinjau/i)).toBeTruthy();
  });

  it("di layar sempit aksi yang sama ada di menu ⋯, bukan bar", async () => {
    mockViewport(360);
    const onMarkReviewed = vi.fn(async () => {});
    render(<ReviewScreen specId="SPEC-7" title="Judul" onBack={() => {}} onMarkReviewed={onMarkReviewed} />);
    await bar();
    expect(screen.queryByRole("button", { name: "Tandai ditinjau" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tandai ditinjau" }));
    await waitFor(() => expect(onMarkReviewed).toHaveBeenCalledWith("SPEC-7", true));
    resetViewport();
  });
});
