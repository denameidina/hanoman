// Audit UI/UX 2026-10 · kerangka shell: judul topbar adalah <h1>, skip link "Lewati ke konten" menjadi
// elemen fokusable pertama dan tampil saat menerima fokus, <main> menjadi tujuannya, dan kotak cari
// punya nama aksesibel.
import { eventsStub } from "./helpers/events-stub";
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Shell } from "../src/ds";

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
  ...eventsStub,
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

describe("Shell: struktur heading, skip link, dan landmark", () => {
  it("judul topbar adalah heading level 1", () => {
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    expect(screen.getByRole("heading", { level: 1, name: "Backlog" })).toBeInTheDocument();
  });

  it("skip link adalah elemen fokusable pertama dan menuju <main id=main-content>", () => {
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    const skip = screen.getByRole("link", { name: "Lewati ke konten" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(document.querySelector("a, button, input, select, textarea")).toBe(skip);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("skip link tersembunyi secara visual sampai menerima fokus, lalu tampil", () => {
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    const skip = screen.getByRole("link", { name: "Lewati ke konten" });
    expect(skip.style.width).toBe("1px");
    act(() => skip.focus());
    expect(skip.style.position).toBe("fixed");
    expect(skip.style.width).toBe("");
    act(() => skip.blur());
    expect(skip.style.width).toBe("1px");
  });

  it("kotak cari punya nama aksesibel 'Cari'", () => {
    render(<Shell active="projects" title="Projects" showSearch onSearchChange={() => {}}>isi</Shell>);
    expect(screen.getByRole("textbox", { name: "Cari" })).toBeInTheDocument();
  });
});
