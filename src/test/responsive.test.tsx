import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponsivePanels, responsiveTier } from "../src/ds/responsive";

type Listener = (event: MediaQueryListEvent) => void;

function viewport(width: number) {
  let current = width;
  const listeners = new Map<string, Set<Listener>>();
  const match = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)?.[1];
    const max = /max-width:\s*(\d+)px/.exec(query)?.[1];
    return (!min || current >= Number(min)) && (!max || current <= Number(max));
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      media: query,
      matches: match(query),
      onchange: null,
      addEventListener: (_: string, listener: Listener) => {
        const set = listeners.get(query) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(query, set);
      },
      removeEventListener: (_: string, listener: Listener) => listeners.get(query)?.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return {
    resize(next: number) {
      current = next;
      for (const [query, set] of listeners) {
        const event = { matches: match(query), media: query } as MediaQueryListEvent;
        for (const listener of set) listener(event);
      }
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("responsive tier SPEC-763", () => {
  it.each([
    [390, "mobile"],
    [767, "mobile"],
    [768, "tablet"],
    [1199, "tablet"],
    [1200, "desktop"],
    [1440, "desktop"],
  ] as const)("maps %dpx to %s", (width, expected) => {
    expect(responsiveTier(width)).toBe(expected);
  });

  it("keeps every panel mounted while mobile navigation changes the active panel", () => {
    viewport(390);
    const onActiveChange = vi.fn();
    const { container, rerender } = render(
      <ResponsivePanels
        ariaLabel="Workspace docs"
        active="list"
        onActiveChange={onActiveChange}
        panels={[
          { id: "list", label: "Daftar", content: <input aria-label="Draft daftar" defaultValue="tetap" /> },
          { id: "detail", label: "Dokumen", content: <div>Isi dokumen</div> },
        ]}
      />,
    );

    const list = screen.getByRole("region", { name: "Daftar" });
    const detail = container.querySelector<HTMLElement>('[data-panel="detail"]');
    expect(list).toHaveAttribute("aria-hidden", "false");
    expect(detail).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByLabelText("Draft daftar")).toHaveValue("tetap");
    screen.getByLabelText("Draft daftar").focus();

    fireEvent.click(screen.getByRole("tab", { name: "Dokumen" }));
    expect(onActiveChange).toHaveBeenCalledWith("detail");

    rerender(
      <ResponsivePanels
        ariaLabel="Workspace docs"
        active="detail"
        onActiveChange={onActiveChange}
        panels={[
          { id: "list", label: "Daftar", content: <input aria-label="Draft daftar" defaultValue="tetap" /> },
          { id: "detail", label: "Dokumen", content: <div>Isi dokumen</div> },
        ]}
      />,
    );
    expect(container.querySelector('[data-panel="list"]')).toBeInTheDocument();
    expect(screen.getByLabelText("Draft daftar", { selector: "input" })).toHaveValue("tetap");
    expect(screen.getByRole("region", { name: "Dokumen" })).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("region", { name: "Dokumen" })).toHaveFocus();
  });

  it("shows the same mounted panels together after crossing the split breakpoint", () => {
    const vp = viewport(390);
    const { container } = render(
      <ResponsivePanels
        ariaLabel="IDE"
        active="files"
        onActiveChange={() => {}}
        panels={[
          { id: "files", label: "Files", content: <div>Tree</div> },
          { id: "viewer", label: "Viewer", content: <div>Source</div> },
        ]}
      />,
    );

    expect(container.querySelector('[data-panel="viewer"]')).toHaveAttribute("aria-hidden", "true");
    act(() => vp.resize(1200));
    expect(screen.getByRole("region", { name: "Files" })).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("region", { name: "Viewer" })).toHaveAttribute("aria-hidden", "false");
  });
});
