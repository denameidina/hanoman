import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotificationsArchiveModal } from "../src/notifications/NotificationsArchiveModal";

const rows = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `n${from + i}`, type: "done", key: `done:SPEC-${from + i}`,
    specId: `SPEC-${from + i}`, sessionId: null, projectId: null,
    title: `judul ${from + i}`, readAt: null, createdAt: "2026-08-04T00:00:00.000Z",
  }));

const listNotifications = vi.fn(async (p: { page?: number; limit?: number } = {}) => ({
  items: rows((p.page ?? 1) === 1 ? 0 : 20, 20),
  unread: 0, total: 60, page: p.page ?? 1, pageSize: 20,
}));

vi.mock("../src/api/client", () => ({ api: { listNotifications: (p?: never) => listNotifications(p ?? {}) } }));

beforeEach(() => vi.clearAllMocks());

describe("NotificationsArchiveModal (SPEC-523)", () => {
  it("merender halaman pertama dan kontrol halaman saat total > pageSize", async () => {
    render(<NotificationsArchiveModal onClose={() => { }} />);
    await waitFor(() => expect(screen.getByText(/judul 0/)).toBeInTheDocument());
    expect(screen.getByText("1–20 dari 60 notifikasi")).toBeInTheDocument();
  });

  it("menekan Berikutnya MENGGANTI isi daftar, bukan menambahnya", async () => {
    render(<NotificationsArchiveModal onClose={() => { }} />);
    await waitFor(() => expect(screen.getByText(/judul 0/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText(/judul 20/)).toBeInTheDocument());
    expect(screen.queryByText(/judul 0$/)).not.toBeInTheDocument();
    expect(listNotifications).toHaveBeenLastCalledWith({ page: 2, limit: 20 });
  });
});
