import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { listConflicts, resolveConflict } = vi.hoisted(() => ({
  listConflicts: vi.fn(),
  resolveConflict: vi.fn(),
}));
vi.mock("../src/api/client", () => ({ api: { listConflicts, resolveConflict }, ApiError: class extends Error {} }));

import { ReconcileModal } from "../src/screens/ReconcileModal";

const conflict = {
  entity: "spec", recordId: "SPEC-1",
  localData: { title: "judul lokal", stage: "review" }, localVersion: 2, localUpdatedAt: "2020-01-02T00:00:00.000Z",
  serverData: { title: "judul server", stage: "planned" }, serverVersion: 3, serverUpdatedAt: "2020-01-01T00:00:00.000Z",
  detectedAt: "2020-01-02T00:00:00.000Z",
};

beforeEach(() => {
  listConflicts.mockResolvedValue({ conflicts: [conflict] });
  resolveConflict.mockResolvedValue({ ok: true });
});

describe("ReconcileModal (SPEC-270)", () => {
  it("menampilkan kedua sisi & menandai sisi updatedAt terbaru sebagai default", async () => {
    render(<ReconcileModal open onClose={() => {}} onResolved={() => {}} />);
    await waitFor(() => expect(screen.getByText(/judul lokal/)).toBeTruthy());
    expect(screen.getByText(/judul server/)).toBeTruthy();
    expect(screen.getByTestId("default-side").textContent).toContain("Lokal");
  });

  // Cacat C · route membalas HTTP 200 ber-`{ ok: false, reason }` saat hub menolak, dan modal
  // membuang hasilnya. Operator mengklik, tak ada yang berubah, tak ada pesan apa pun.
  it("menampilkan alasan saat resolusi ditolak, bukan diam", async () => {
    resolveConflict.mockResolvedValue({ ok: false, reason: "still-conflict" });
    render(<ReconcileModal open onClose={() => {}} onResolved={() => {}} />);
    await waitFor(() => screen.getByText(/judul lokal/));
    fireEvent.click(screen.getByRole("button", { name: /Pakai Lokal/i }));
    await waitFor(() => expect(screen.getByTestId("resolve-error").textContent).toMatch(/hub/i));
  });

  it("klik Pakai Server memanggil resolveConflict(server)", async () => {
    const onResolved = vi.fn();
    render(<ReconcileModal open onClose={() => {}} onResolved={onResolved} />);
    await waitFor(() => screen.getByText(/judul lokal/));
    fireEvent.click(screen.getByRole("button", { name: /Pakai Server/i }));
    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith("spec", "SPEC-1", "server"));
  });
});
