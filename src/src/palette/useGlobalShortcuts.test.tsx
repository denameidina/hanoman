import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, fireEvent, act } from "@testing-library/react";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { getPaletteUi, resetPaletteUi } from "./ui-store";
import { CHORD_WINDOW_MS } from "./shortcuts";

const NAV = ["overview", "backlog", "terminal", "settings", "clients"];

function setup(over: { enabled?: boolean; navKeys?: string[] } = {}) {
  const go = vi.fn();
  renderHook(() => useGlobalShortcuts({ enabled: over.enabled ?? true, navKeys: over.navKeys ?? NAV, go }));
  return go;
}

const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, ...init });

beforeEach(() => {
  resetPaletteUi();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useGlobalShortcuts · chord g + huruf", () => {
  it("g lalu b pindah ke Backlog", () => {
    const go = setup();
    press(document.body, "g");
    press(document.body, "b");
    expect(go).toHaveBeenCalledWith("backlog");
  });

  it("chord yang kedaluwarsa (lebih dari 1 dtk) tidak pindah", () => {
    const go = setup();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(10_000);
    press(document.body, "g");
    now.mockReturnValue(10_000 + CHORD_WINDOW_MS + 1);
    press(document.body, "b");
    expect(go).not.toHaveBeenCalled();
  });

  it("layar bergerbang yang tak aktif tak pernah dituju", () => {
    const go = setup({ navKeys: NAV.filter((k) => k !== "clients") });
    press(document.body, "g");
    press(document.body, "k");
    expect(go).not.toHaveBeenCalled();
  });

  it("tombol modifier (Ctrl/Alt) tidak memulai chord", () => {
    const go = setup();
    press(document.body, "g", { ctrlKey: true });
    press(document.body, "b");
    expect(go).not.toHaveBeenCalled();
  });
});

describe("useGlobalShortcuts · fokus & konteks", () => {
  it("tidak aktif saat fokus di input, textarea, atau contenteditable", () => {
    const go = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press(input, "g");
    press(input, "b");
    expect(go).not.toHaveBeenCalled();
    expect(getPaletteUi().help).toBe(false);

    const area = document.createElement("div");
    area.setAttribute("contenteditable", "true");
    document.body.appendChild(area);
    press(area, "?");
    expect(getPaletteUi().help).toBe(false);
  });

  it("tidak aktif di dalam terminal xterm, termasuk ⌘K (Ctrl+K milik readline)", () => {
    const go = setup();
    const term = document.createElement("div");
    term.className = "xterm";
    const helper = document.createElement("textarea");
    term.appendChild(helper);
    document.body.appendChild(term);
    press(helper, "g");
    press(helper, "b");
    press(helper, "k", { ctrlKey: true });
    expect(go).not.toHaveBeenCalled();
    expect(getPaletteUi().palette).toBe(false);
  });

  it("tidak aktif saat ada dialog modal terbuka", () => {
    const go = setup();
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    press(document.body, "g");
    press(document.body, "b");
    expect(go).not.toHaveBeenCalled();
  });

  it("enabled=false (login, portal klien) mematikan semua shortcut", () => {
    const go = setup({ enabled: false });
    press(document.body, "g");
    press(document.body, "b");
    press(document.body, "?");
    press(document.body, "k", { metaKey: true });
    expect(go).not.toHaveBeenCalled();
    expect(getPaletteUi()).toEqual({ palette: false, help: false });
  });
});

describe("useGlobalShortcuts · aksi tunggal", () => {
  it("⌘K membuka lalu menutup palet", () => {
    setup();
    press(document.body, "k", { metaKey: true });
    expect(getPaletteUi().palette).toBe(true);
    press(document.body, "k", { metaKey: true });
    expect(getPaletteUi().palette).toBe(false);
  });

  it("Ctrl+K juga membuka palet di luar terminal", () => {
    setup();
    press(document.body, "k", { ctrlKey: true });
    expect(getPaletteUi().palette).toBe(true);
  });

  it("? membuka bantuan shortcut", () => {
    setup();
    press(document.body, "?", { shiftKey: true });
    expect(getPaletteUi().help).toBe(true);
  });

  it("/ memfokuskan kotak cari topbar bila ada dan bisa diketik", () => {
    setup();
    const wrap = document.createElement("div");
    wrap.className = "hn-shell-search";
    const input = document.createElement("input");
    wrap.appendChild(input);
    document.body.appendChild(wrap);
    press(document.body, "/");
    expect(document.activeElement).toBe(input);
    expect(getPaletteUi().palette).toBe(false);
  });

  it("/ membuka palet bila halaman tak punya kotak cari", () => {
    setup();
    press(document.body, "/");
    expect(getPaletteUi().palette).toBe(true);
  });
});
