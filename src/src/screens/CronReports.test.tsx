import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CronReports } from "./CronReports";

const rep = (over: Record<string, unknown> = {}) => ({
  id: "r1", projectId: "p1", cronId: "c1", cronName: "Cek biaya Harian Cloudflare", runDate: "2026-10-14",
  dueAt: "2026-10-13T18:00:00.000Z", sessionId: "cron-c1", bytes: 2048,
  filename: "2026-10-14-cek-biaya-harian-cloudflare-r1.md",
  createdAt: "2026-10-13T18:05:00.000Z", updatedAt: "2026-10-13T18:05:00.000Z", ...over,
});
const listCronReports = vi.fn(async (..._a: unknown[]) => ({ items: [rep()], total: 1, page: 1, pageSize: 10 }));
const getCronReport = vi.fn(async (..._a: unknown[]) => ({ ...rep(), body: "# Biaya\n\nTotal **Rp 10**" }));
vi.mock("../api/client", () => ({
  api: {
    listCronReports: (...a: unknown[]) => listCronReports(...a),
    getCronReport: (...a: unknown[]) => getCronReport(...a),
  },
}));

beforeEach(() => { listCronReports.mockClear(); getCronReport.mockClear(); });

describe("CronReports", () => {
  it("memuat daftar per project tanpa isi; isi baru dimuat saat dibuka", async () => {
    render(<CronReports projectId="p1" />);
    expect(await screen.findByText("Cek biaya Harian Cloudflare")).toBeTruthy();
    expect(listCronReports).toHaveBeenCalledWith({ projectId: "p1", page: 1, limit: 10 });
    expect(getCronReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Baca" }));
    await waitFor(() => expect(getCronReport).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText("Rp 10")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unduh \.md/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sembunyikan" }));
    expect(screen.queryByText("Rp 10")).toBeNull();
  });

  it("kosong → pesan kosong, bukan error", async () => {
    listCronReports.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 });
    render(<CronReports projectId="p1" />);
    expect(await screen.findByText(/Belum ada laporan/)).toBeTruthy();
  });

  it("galat memuat tampil sebagai galat", async () => {
    listCronReports.mockRejectedValueOnce(new Error("boom"));
    render(<CronReports projectId="p1" />);
    expect(await screen.findByText(/memuat laporan cron/i)).toBeTruthy();
  });
});
