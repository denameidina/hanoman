import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationBell } from "../src/notifications/NotificationBell";
import { NotificationsContext } from "../src/notifications/NotificationsContext";

function Harness({ items, onOpen, markAllRead = () => {} }: { items: any[]; onOpen?: (n: any) => void; markAllRead?: () => void }) {
  const ctx = { items, unread: items.filter((n) => !n.readAt).length, total: items.length, markAllRead, clear: () => {}, onOpen };
  return <NotificationsContext.Provider value={ctx}><NotificationBell /></NotificationsContext.Provider>;
}
const now = () => new Date().toISOString();

describe("NotificationBell", () => {
  it("menampilkan badge unread", () => {
    render(<Harness items={[{ id: "1", type: "done", specId: "SPEC-180", sessionId: "s", title: "x", projectId: null, createdAt: now(), readAt: null }]} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
  it("done: tombol Buka memanggil onOpen dengan item", () => {
    const n = { id: "1", type: "done", specId: "SPEC-180", sessionId: "spec-180", title: "Selesai", projectId: "p", createdAt: now(), readAt: null };
    const onOpen = vi.fn();
    render(<Harness items={[n]} onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    fireEvent.click(screen.getByText("Buka"));
    expect(onOpen).toHaveBeenCalledWith(n);
  });
  it("decision: tombol Buka terminal memanggil onOpen", () => {
    const n = { id: "2", type: "decision", specId: "SPEC-9", sessionId: "spec_9", title: "x", projectId: "p", createdAt: now(), readAt: null };
    const onOpen = vi.fn();
    render(<Harness items={[n]} onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    fireEvent.click(screen.getByText("Buka terminal"));
    expect(onOpen).toHaveBeenCalledWith(n);
  });
  // Audit UI/UX 2026-10 · membuka bell tak lagi menandai semua terbaca diam-diam: badge tetap
  // menunjukkan yang belum dilihat sampai pengguna menekan "Tandai semua dibaca" sendiri.
  it("membuka bell tak memanggil markAllRead dan badge tetap menghitung yang belum dibaca", () => {
    const markAllRead = vi.fn();
    const n = { id: "4", type: "done", specId: "SPEC-4", sessionId: "s4", title: "x", projectId: "p", createdAt: now(), readAt: null };
    render(<Harness items={[n]} markAllRead={markAllRead} />);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(markAllRead).not.toHaveBeenCalled();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("Tandai semua dibaca memanggil markAllRead sekali", () => {
    const markAllRead = vi.fn();
    const n = { id: "5", type: "done", specId: "SPEC-5", sessionId: "s5", title: "x", projectId: "p", createdAt: now(), readAt: null };
    render(<Harness items={[n]} markAllRead={markAllRead} />);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tandai semua dibaca" }));
    expect(markAllRead).toHaveBeenCalledTimes(1);
  });

  it("memberi semantik menu, fokus masuk, dan Escape mengembalikan fokus", () => {
    const n = { id: "3", type: "done", specId: "SPEC-3", sessionId: "s3", title: "x", projectId: "p", createdAt: now(), readAt: null };
    render(<Harness items={[n]} onOpen={() => {}} />);
    const trigger = screen.getByLabelText("Notifikasi");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Bersihkan" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Buka" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
