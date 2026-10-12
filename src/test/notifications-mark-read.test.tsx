// Audit UI/UX 2026-10 · galat tandai-dibaca / bersihkan tak lagi ditelan: keadaan dikembalikan dan
// toast menyebut aksinya beserta alasan server.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { NotificationsProvider } from "../src/notifications/NotificationsContext";
import { NotificationBell } from "../src/notifications/NotificationBell";

const { api, events } = vi.hoisted(() => ({
  api: {
    getSettings: vi.fn(async () => ({})),
    markNotificationsRead: vi.fn(),
    clearNotifications: vi.fn(),
  },
  events: { handler: undefined as undefined | ((m: any) => void) },
}));

vi.mock("../src/api/client", () => ({ api, ApiError: class extends Error {} }));
vi.mock("../src/api/events", () => ({
  subscribe: (fn: (m: any) => void) => { events.handler = fn; return () => { events.handler = undefined; }; },
}));

const item = {
  id: "n1", type: "done", specId: "SPEC-9", sessionId: "s9", title: "Selesai",
  projectId: "p", createdAt: "2026-10-11T01:00:00.000Z", readAt: null,
};

beforeEach(() => {
  api.markNotificationsRead.mockReset().mockResolvedValue(undefined);
  api.clearNotifications.mockReset().mockResolvedValue(undefined);
  events.handler = undefined;
});

function renderBell(showToast: (...args: unknown[]) => void) {
  render(
    <NotificationsProvider showToast={showToast as any}>
      <NotificationBell />
    </NotificationsProvider>,
  );
  // Frame pertama = seed (tanpa toast), membawa satu notifikasi belum dibaca.
  act(() => { events.handler?.({ t: "notifications", items: [item], unread: 1, total: 1 }); });
}

describe("NotificationsProvider: galat tak ditelan", () => {
  it("gagal menandai semua dibaca: badge kembali dan toast menyebut aksi serta alasannya", async () => {
    api.markNotificationsRead.mockRejectedValueOnce(new Error("403 forbidden"));
    const showToast = vi.fn();
    renderBell(showToast);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tandai semua dibaca" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      "Gagal menandai notifikasi dibaca: 403 forbidden", "err", "x-circle"));
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("gagal membersihkan: daftar dikembalikan dan toast menyebut alasannya", async () => {
    api.clearNotifications.mockRejectedValueOnce(new Error("500"));
    const showToast = vi.fn();
    renderBell(showToast);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Bersihkan" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      "Gagal membersihkan notifikasi: 500", "err", "x-circle"));
    expect(screen.getByText("SPEC-9 · Selesai")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("berhasil menandai dibaca: tak ada toast galat", async () => {
    const showToast = vi.fn();
    renderBell(showToast);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tandai semua dibaca" }));
    await waitFor(() => expect(api.markNotificationsRead).toHaveBeenCalledTimes(1));
    expect(showToast).not.toHaveBeenCalled();
  });
});
