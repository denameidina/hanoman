import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SyncButton, __resetSyncActiveCache } from "../screens/SyncButton";
import { api } from "../api/client";

beforeEach(() => { __resetSyncActiveCache(); vi.restoreAllMocks(); });

describe("SyncButton — hapus tertunda (SPEC-799 · ADR-0119)", () => {
  it("merender lencana saat ada penghapusan menunggu", async () => {
    vi.spyOn(api, "getConfig").mockResolvedValue({ sync: { running: true } } as never);
    vi.spyOn(api, "getSyncPending").mockResolvedValue({
      deletes: [{ entity: "project", recordId: "p1", deletedAt: "2026-08-15T00:00:00.000Z" }], total: 1,
    });
    render(<SyncButton onDone={() => {}} onToast={() => {}} />);
    expect(await screen.findByText(/1 hapus menunggu/i)).toBeInTheDocument();
  });

  it("tanpa penghapusan tertunda, lencana tak dirender", async () => {
    vi.spyOn(api, "getConfig").mockResolvedValue({ sync: { running: true } } as never);
    vi.spyOn(api, "getSyncPending").mockResolvedValue({ deletes: [], total: 0 });
    render(<SyncButton onDone={() => {}} onToast={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Sync$/i })).toBeInTheDocument());
    expect(screen.queryByText(/hapus menunggu/i)).toBeNull();
  });
});
