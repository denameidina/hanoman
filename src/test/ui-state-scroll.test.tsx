import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
  it("menyimpan posisi scroll", async () => {
    render(<List ready />);
    const el = screen.getByTestId("list");
    el.scrollTop = 640;
    fireEvent.scroll(el);
    await frame();
    expect(readUiState(uiKey("demo", "scroll"), 0)).toBe(640);
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
