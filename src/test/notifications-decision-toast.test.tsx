// Audit UI/UX 2026-10 · Fase 4 (Z4). Toast keputusan membawa aksi "Jawab": membuka Terminal terfokus
// ke sesi itu dan menandai notifikasinya terbaca. Dilewati bila sesi itu sudah ditonton di Terminal.
// Satu notifikasi = satu toast, walau frame WebSocket-nya datang berulang.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotificationsProvider } from "../src/notifications/NotificationsContext";
import { useToast, ToastHost } from "../src/ds/kit";

const { api, events } = vi.hoisted(() => ({
  api: {
    getSettings: vi.fn(),
    markNotificationRead: vi.fn(),
    markNotificationsRead: vi.fn(),
    clearNotifications: vi.fn(),
  },
  events: { handler: undefined as undefined | ((m: any) => void) },
}));

vi.mock("../src/api/client", () => ({ api, ApiError: class extends Error {} }));
vi.mock("../src/api/events", () => ({
  subscribe: (fn: (m: any) => void) => { events.handler = fn; return () => { events.handler = undefined; }; },
}));
vi.mock("../src/notifications/sound", () => ({ playNotifySound: vi.fn(), unlockNotifySound: vi.fn() }));

const SETTINGS = { notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" };
const seed = {
  id: "seed", type: "done", specId: "SPEC-0", sessionId: "s0", title: "awal", projectId: "p",
  createdAt: "2026-10-11T00:00:00.000Z", readAt: null,
};
const decision = (id: string, createdAt: string) => ({
  id, type: "decision", specId: "SPEC-9", sessionId: "spec_9", title: "tanya", projectId: "p", createdAt, readAt: null,
});
const frame = (items: any[]) => ({ t: "notifications", items, unread: items.filter((n) => !n.readAt).length, total: items.length });

beforeEach(() => {
  api.getSettings.mockReset().mockResolvedValue(SETTINGS);
  api.markNotificationRead.mockReset().mockResolvedValue(undefined);
  events.handler = undefined;
});

// Harness memakai ToastHost sungguhan, supaya aksi "Jawab" diuji lewat tombol yang benar-benar dirender.
function Harness({ onOpen, isViewing }: { onOpen: (n: any) => void; isViewing?: (n: any) => boolean }) {
  const [toast, show] = useToast();
  return (
    <NotificationsProvider showToast={show} onOpen={onOpen} isViewing={isViewing}>
      <ToastHost toast={toast} />
    </NotificationsProvider>
  );
}

// Frame pertama = seed (tanpa toast). Frame berikutnya membawa notifikasi baru.
function mount(opts: { onOpen?: (n: any) => void; isViewing?: (n: any) => boolean } = {}) {
  const onOpen = opts.onOpen ?? vi.fn();
  render(<Harness onOpen={onOpen} isViewing={opts.isViewing} />);
  act(() => { events.handler?.(frame([seed])); });
  return { onOpen };
}

describe("toast keputusan: aksi Jawab", () => {
  it("keputusan baru men-toast dengan aksi Jawab, dan Jawab membuka Terminal ke sesinya serta menandai terbaca", async () => {
    const { onOpen } = mount();
    const d = decision("d1", "2026-10-11T01:00:00.000Z");
    act(() => { events.handler?.(frame([d, seed])); });

    expect(screen.getByText("SPEC-9 · butuh keputusan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jawab" }));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "d1", sessionId: "spec_9" }));
    expect(api.markNotificationRead).toHaveBeenCalledWith("d1");
  });

  it("toast keputusan bertahan 7 dtk lalu hilang", () => {
    vi.useFakeTimers();
    try {
      mount();
      act(() => { events.handler?.(frame([decision("d2", "2026-10-11T01:00:00.000Z"), seed])); });
      act(() => { vi.advanceTimersByTime(6_900); });
      expect(screen.getByRole("button", { name: "Jawab" })).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByRole("button", { name: "Jawab" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifikasi selesai tidak membawa aksi Jawab", () => {
    mount();
    const done = { ...seed, id: "done1", createdAt: "2026-10-11T02:00:00.000Z", title: "rampung" };
    act(() => { events.handler?.(frame([done, seed])); });
    expect(screen.getByText(/rampung"/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jawab" })).not.toBeInTheDocument();
  });
});

describe("toast keputusan: tidak tampil saat sesi sudah ditonton", () => {
  it("sesi yang sedang ditonton di Terminal: tanpa toast", () => {
    mount({ isViewing: (n) => n.sessionId === "spec_9" });
    act(() => { events.handler?.(frame([decision("d3", "2026-10-11T01:00:00.000Z"), seed])); });
    expect(screen.queryByText("SPEC-9 · butuh keputusan")).not.toBeInTheDocument();
  });

  it("sesi lain (tak sedang ditonton): tetap men-toast", () => {
    mount({ isViewing: () => false });
    act(() => { events.handler?.(frame([decision("d4", "2026-10-11T01:00:00.000Z"), seed])); });
    expect(screen.getByText("SPEC-9 · butuh keputusan")).toBeInTheDocument();
  });

  it("notifikasi selesai tak terpengaruh isViewing", () => {
    mount({ isViewing: () => true });
    const done = { ...seed, id: "done2", createdAt: "2026-10-11T03:00:00.000Z", title: "rampung" };
    act(() => { events.handler?.(frame([done, seed])); });
    expect(screen.getByText(/rampung"/)).toBeInTheDocument();
  });
});

describe("toast keputusan: satu notifikasi, satu toast", () => {
  it("frame ulang dengan notifikasi yang sama tak men-toast lagi", () => {
    mount();
    const d = decision("d5", "2026-10-11T01:00:00.000Z");
    act(() => { events.handler?.(frame([d, seed])); });
    act(() => { events.handler?.(frame([d, seed])); });
    act(() => { events.handler?.(frame([d, seed])); });
    expect(screen.getAllByText("SPEC-9 · butuh keputusan")).toHaveLength(1);
  });
});
