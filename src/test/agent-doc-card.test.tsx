import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentDocCard } from "../src/screens/AgentDocCard";

const MD = "# hanoman — dokumentasi AI Agent\n\n## 0. Apa itu hanoman\n\nOrchestrator.\n";
const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });
const notFound = { ok: false, status: 404, text: async () => "{}" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ok(MD)));
});

afterEach(() => vi.unstubAllGlobals());

describe("AgentDocCard", () => {
  it("menampilkan URL absolut yang bisa disalin agen", () => {
    render(<AgentDocCard />);
    expect(screen.getByText(`${window.location.origin}/api/agent-integration.md`)).toBeTruthy();
  });

  // Kunci "satu sumber": yang dirender di dashboard adalah respons endpoint yang SAMA dengan yang
  // dibaca agen. Kalau komponen ini pernah menyimpan naskahnya sendiri, test ini merah.
  it("tombol Buka merender isi dari endpoint, bukan salinan lokal", async () => {
    render(<AgentDocCard />);
    fireEvent.click(screen.getByRole("button", { name: /buka/i }));
    await waitFor(() => expect(screen.getByText("0. Apa itu hanoman")).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith("/api/agent-integration.md", expect.anything());
  });

  it("tautan GitHub adalah satu elemen <a>, tanpa <button> bersarang", () => {
    render(<AgentDocCard />);
    const link = screen.getByRole("link", { name: /lihat di github/i });
    expect(link.querySelector("button")).toBeNull();
    expect(link.closest("a")!.getAttribute("target")).toBe("_blank");
  });

  it("salin tautan menunggu clipboard sebelum melapor sukses", async () => {
    let resolve!: () => void;
    const writeText = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onToast = vi.fn();
    render(<AgentDocCard onToast={onToast} />);
    fireEvent.click(screen.getByRole("button", { name: /salin tautan/i }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/agent-integration.md`);
    expect(onToast).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Tautan disalin", "ok", "copy"));
  });

  it("salin tautan yang ditolak clipboard melapor galat, bukan sukses", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("izin ditolak"); }) } });
    const onToast = vi.fn();
    render(<AgentDocCard onToast={onToast} />);
    fireEvent.click(screen.getByRole("button", { name: /salin tautan/i }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Gagal menyalin link: izin ditolak", "err"));
    expect(onToast).not.toHaveBeenCalledWith("Tautan disalin", "ok", "copy");
  });

  it("endpoint gagal → pesan galat, bukan modal kosong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFound));
    render(<AgentDocCard />);
    fireEvent.click(screen.getByRole("button", { name: /buka/i }));
    await waitFor(() => expect(screen.getByText(/gagal memuat/i)).toBeTruthy());
    expect(screen.queryByText("0. Apa itu hanoman")).toBeNull();
  });
});
