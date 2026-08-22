// Stub `../src/api/events` diimpor PALING DULU: factory `vi.mock` di bawah membacanya saat
// modul yang di-mock pertama kali dievaluasi — itu terjadi sebelum import di bawahnya selesai.
import { eventsStub } from "./helpers/events-stub";
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { Shell } from "../src/ds";
import { uiKey, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listNotifications: vi.fn().mockResolvedValue({ items: [], unread: 0 }),
      getLimits: vi.fn().mockResolvedValue(null),
      getCodexLimits: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ current: "0.0.0", latest: null, canApply: false }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

vi.mock("../src/api/events", () => ({
  // SPEC-908 · stub terpusat, bukan tiga ekspor tangan: modul ini kini juga punya
  // `subscribeTopic`/`eventsTopics`/`eventsHelloSeen`, dan ekspor yang hilang baru
  // meledak saat sebuah layar realtime kebetulan ikut ter-render.
  ...eventsStub,
  // SPEC-897 · HanomanPet membaca status koneksi dari socket `events` yang sama.
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

beforeEach(() => localStorage.clear());

const frame = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };

function fake(el: HTMLElement) {
  let top = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.max(0, Math.min(v, 1600)); },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 2000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 400 });
}

describe("scroll halaman", () => {
  it("disimpan per section dan dipulihkan saat kembali", async () => {
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    const main = screen.getByTestId("shell-main");
    fake(main);
    main.scrollTop = 720;
    fireEvent.scroll(main);
    await frame();
    expect(readUiState(uiKey("page@backlog", "scroll"), 0)).toBe(720);

    cleanup();
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    const again = screen.getByTestId("shell-main");
    fake(again);
    await frame();
    expect(again.scrollTop).toBe(720);
  });

  it("tiap section punya posisinya sendiri", async () => {
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    const main = screen.getByTestId("shell-main");
    fake(main);
    main.scrollTop = 300;
    fireEvent.scroll(main);
    await frame();
    cleanup();

    render(<Shell active="triage" title="Triase">isi</Shell>);
    const other = screen.getByTestId("shell-main");
    fake(other);
    await frame();
    expect(other.scrollTop).toBe(0);
    expect(readUiState(uiKey("page@backlog", "scroll"), 0)).toBe(300);
  });
});
