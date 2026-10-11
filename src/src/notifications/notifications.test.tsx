import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { Notification } from "@hanoman/shared";

// ADR-0204 · tandai SATU notifikasi terbaca dari bell. Dua jaminan yang diuji: membuka bell TIDAK
// menandai apa pun, dan "Buka" pada satu item menandai item itu saja — optimistik, dengan rollback
// dan toast bila server menolak.
const { markNotificationRead, getSettings, state } = vi.hoisted(() => ({
  markNotificationRead: vi.fn(async (_id: string) => undefined as void),
  getSettings: vi.fn(async () => ({
    notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  })),
  state: { listener: undefined as ((m: unknown) => void) | undefined },
}));

vi.mock("../api/client", () => ({
  api: { markNotificationRead, getSettings },
}));
vi.mock("../api/events", () => ({
  subscribe: (h: (m: unknown) => void) => { state.listener = h; return () => { state.listener = undefined; }; },
}));
vi.mock("./sound", () => ({ playNotifySound: vi.fn(), unlockNotifySound: vi.fn() }));

import { NotificationsProvider } from "./NotificationsContext";
import { NotificationBell } from "./NotificationBell";

const note = (over: Partial<Notification> = {}): Notification => ({
  id: "n1", type: "done", key: null, specId: "SPEC-1", sessionId: null, title: "satu",
  projectId: "p1", createdAt: "2026-09-05T00:00:00.000Z", readAt: null, ...over,
} as Notification);

function frame(items: Notification[], unread: number) {
  act(() => { state.listener?.({ t: "notifications", items, unread, total: items.length }); });
}

function mount(showToast = vi.fn(), onOpen = vi.fn()) {
  render(
    <NotificationsProvider showToast={showToast} onOpen={onOpen}>
      <NotificationBell />
    </NotificationsProvider>,
  );
  return { showToast, onOpen };
}

beforeEach(() => {
  markNotificationRead.mockReset();
  markNotificationRead.mockImplementation(async () => undefined);
});

describe("bell: tandai per item", () => {
  it("membuka bell saja tidak menandai apa pun terbaca", () => {
    mount();
    frame([note({ id: "n1" }), note({ id: "n2", specId: "SPEC-2" })], 2);
    fireEvent.click(screen.getByRole("button", { name: "Notifikasi" }));
    expect(markNotificationRead).not.toHaveBeenCalled();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("'Buka' pada satu item menandai item itu saja, optimistik, dan tetap membuka", () => {
    const { onOpen } = mount();
    frame([note({ id: "n1" }), note({ id: "n2", specId: "SPEC-2" })], 2);
    fireEvent.click(screen.getByRole("button", { name: "Notifikasi" }));
    fireEvent.click(screen.getAllByRole("menuitem", { name: "Buka" })[0]!);
    expect(markNotificationRead).toHaveBeenCalledTimes(1);
    expect(markNotificationRead).toHaveBeenCalledWith("n1");
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }));
    // badge turun seketika (sebelum request selesai) dan hanya satu
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("galat server: item dikembalikan ke belum-dibaca dan operator diberi toast err", async () => {
    markNotificationRead.mockImplementationOnce(async () => { throw new Error("jaringan putus"); });
    const { showToast } = mount();
    frame([note({ id: "n1" }), note({ id: "n2", specId: "SPEC-2" })], 2);
    fireEvent.click(screen.getByRole("button", { name: "Notifikasi" }));
    fireEvent.click(screen.getAllByRole("menuitem", { name: "Buka" })[0]!);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), "err", "x-circle"));
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("item yang sudah terbaca tidak memicu request", () => {
    mount();
    frame([note({ id: "n1", readAt: "2026-09-05T01:00:00.000Z" })], 0);
    fireEvent.click(screen.getByRole("button", { name: "Notifikasi" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Buka" }));
    expect(markNotificationRead).not.toHaveBeenCalled();
  });
});
