import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useScrollRestore } from "../src/ui-state/hooks";
import { uiKey, readUiState, writeUiState } from "../src/ui-state/store";

beforeEach(() => localStorage.clear());

// jsdom tak melakukan layout: scrollTop selalu 0 dan scrollHeight/clientHeight selalu 0.
// Elemen palsu di bawah memberi ketiganya perilaku nyata supaya hook bisa diuji.
function fakeScroller(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  let top = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.max(0, Math.min(v, scrollHeight - clientHeight)); },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
}

function List({ ready, tall = 2000 }: { ready: boolean; tall?: number }) {
  const ref = useScrollRestore("demo", "scroll", ready);
  return (
    <div
      data-testid="list"
      ref={(node) => {
        if (node && !(node as any).__faked) { (node as any).__faked = true; fakeScroller(node, tall, 400); }
        ref(node);
      }}
    />
  );
}

const frame = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };

describe("useScrollRestore", () => {
  it("menyimpan posisi scroll (ditulis setelah jeda throttle)", async () => {
    render(<List ready />);
    const el = screen.getByTestId("list");
    el.scrollTop = 640;
    fireEvent.scroll(el);
    await waitFor(() => expect(readUiState(uiKey("demo", "scroll"), 0)).toBe(640));
  });

  // Audit UI/UX 2026-10 · menggulir tak boleh menulis localStorage tiap frame: sepanjang satu jeda
  // hanya satu tulisan, dan nilai yang tertulis adalah posisi terakhir.
  it("menggulir berkali-kali dalam satu jeda hanya menulis sekali, dengan posisi terakhir", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      render(<List ready />);
      const el = screen.getByTestId("list");
      for (const y of [100, 200, 300, 400]) { el.scrollTop = y; fireEvent.scroll(el); }
      await waitFor(() => expect(readUiState(uiKey("demo", "scroll"), 0)).toBe(400));
      const writes = setItem.mock.calls.filter(([k]) => k === uiKey("demo", "scroll"));
      expect(writes).toHaveLength(1);
    } finally {
      setItem.mockRestore();
    }
  });

  it("scrollend menulis posisi seketika, tanpa menunggu jeda", () => {
    render(<List ready />);
    const el = screen.getByTestId("list");
    el.scrollTop = 320;
    fireEvent.scroll(el);
    fireEvent(el, new Event("scrollend"));
    expect(readUiState(uiKey("demo", "scroll"), 0)).toBe(320);
  });

  it("posisi terakhir ditulis saat layar dilepas sebelum jeda habis", () => {
    const { unmount } = render(<List ready />);
    const el = screen.getByTestId("list");
    el.scrollTop = 900;
    fireEvent.scroll(el);
    unmount();
    expect(readUiState(uiKey("demo", "scroll"), 0)).toBe(900);
  });

  it("storage yang menolak tulis tak melempar ke penggulir", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    try {
      render(<List ready />);
      const el = screen.getByTestId("list");
      el.scrollTop = 500;
      expect(() => fireEvent.scroll(el)).not.toThrow();
      await waitFor(() => expect(setItem).toHaveBeenCalled());
    } finally {
      setItem.mockRestore();
    }
  });

  it("memulihkan posisi setelah ready", async () => {
    writeUiState(uiKey("demo", "scroll"), 500);
    const { rerender } = render(<List ready={false} />);
    const el = screen.getByTestId("list");
    await frame();
    expect(el.scrollTop).toBe(0);          // belum ready → belum dipulihkan
    rerender(<List ready />);
    await frame();
    expect(el.scrollTop).toBe(500);
  });

  it("tak memulihkan saat tak ada posisi tersimpan", async () => {
    render(<List ready />);
    await frame();
    expect(screen.getByTestId("list").scrollTop).toBe(0);
  });

  it("posisi tersimpan tak rusak oleh konten yang masih pendek", async () => {
    writeUiState(uiKey("demo", "scroll"), 1500);
    render(<List ready tall={500} />);   // hanya bisa scroll sampai 100
    await frame();
    await frame();
    expect(readUiState(uiKey("demo", "scroll"), 0)).toBe(1500);
  });
});
