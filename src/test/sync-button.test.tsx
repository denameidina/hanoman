import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getConfig, syncNow, getSyncPending } = vi.hoisted(() => ({
  getConfig: vi.fn(async () => ({ entries: [], sync: { running: true, connected: true } })),
  syncNow: vi.fn(async () => ({ ok: true, pulled: 2, pushed: 1, conflicts: 0 })),
  getSyncPending: vi.fn(async () => ({ deletes: [], total: 0 })),
}));
vi.mock("../src/api/client", () => ({
  api: { getConfig, syncNow, getSyncPending }, ApiError: class extends Error {},
}));

import { SyncButton, __resetSyncActiveCache } from "../src/screens/SyncButton";

beforeEach(() => {
  __resetSyncActiveCache();
  getConfig.mockResolvedValue({ entries: [], sync: { running: true, connected: true } });
  syncNow.mockResolvedValue({ ok: true, pulled: 2, pushed: 1, conflicts: 0 });
  getSyncPending.mockResolvedValue({ deletes: [], total: 0 });
});

describe("SyncButton (SPEC-268)", () => {
  it("render saat client, klik → syncNow + toast + onDone", async () => {
    const onDone = vi.fn(); const onToast = vi.fn();
    render(<SyncButton onDone={onDone} onToast={onToast} />);
    const btn = await screen.findByText("Sync");
    fireEvent.click(btn);
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("↓2 ↑1"), "ok", expect.anything());
  });

  // SPEC-382 · baris feed yang terlanjur dilompati kursor hanya bisa dipulihkan dengan menarik
  // ulang feed dari awal — tak ada siklus normal yang bisa mundur.
  it("tombol Tarik ulang memicu syncNow({ full: true })", async () => {
    const onToast = vi.fn();
    syncNow.mockResolvedValue({ ok: true, full: true, pulled: 7, pushed: 0, conflicts: 0 } as never);
    render(<SyncButton onDone={vi.fn()} onToast={onToast} />);
    fireEvent.click(await screen.findByText("Tarik ulang"));
    await waitFor(() => expect(syncNow).toHaveBeenCalledWith({ full: true }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("↓7"), "ok", expect.anything()));
  });

  it("tak render saat hub (sync.running=false)", async () => {
    getConfig.mockResolvedValue({ entries: [], sync: { running: false, connected: false } } as never);
    const { container } = render(<SyncButton onDone={vi.fn()} onToast={vi.fn()} />);
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    expect(container.textContent ?? "").not.toContain("Sync");
  });

  // SPEC-799 · ADR-0119 · penghapusan yang tombstone-nya sudah tercatat tapi belum sempat ter-push.
  // Tanpa lencana ini operator tak punya cara membedakannya dari "hapusnya tak terjadi".
  it("merender lencana saat ada penghapusan menunggu", async () => {
    getSyncPending.mockResolvedValue({
      deletes: [{ entity: "project", recordId: "p1", deletedAt: "2026-08-15T00:00:00.000Z" }], total: 1,
    } as never);
    render(<SyncButton onDone={vi.fn()} onToast={vi.fn()} />);
    expect(await screen.findByText(/1 hapus menunggu/i)).toBeInTheDocument();
  });

  it("tanpa penghapusan tertunda, lencana tak dirender", async () => {
    render(<SyncButton onDone={vi.fn()} onToast={vi.fn()} />);
    await screen.findByText("Sync");
    expect(screen.queryByText(/hapus menunggu/i)).toBeNull();
  });

  it("toast memuat hitungan hapus yang menyeberang", async () => {
    const onToast = vi.fn();
    syncNow.mockResolvedValue({ ok: true, pulled: 1, pushed: 0, conflicts: 0, deleted: 3 } as never);
    render(<SyncButton onDone={vi.fn()} onToast={onToast} />);
    fireEvent.click(await screen.findByText("Sync"));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("⨯3"), "ok", expect.anything()));
  });
});
