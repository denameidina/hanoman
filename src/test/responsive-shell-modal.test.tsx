import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HN_NAV, Modal, Shell } from "../src/ds";

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
  subscribe: () => () => {},
  // SPEC-897 · HanomanPet membaca status koneksi dari socket `events` yang sama.
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

function mobileViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      media: query,
      matches: query.includes("max-width: 767px"),
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

describe("responsive Shell", () => {
  it("keeps all navigation available through a semantic mobile drawer", () => {
    mobileViewport();
    const onNavigate = vi.fn();
    render(<Shell active="overview" title="Overview" onNavigate={onNavigate}>Isi</Shell>);

    const toggle = screen.getByRole("button", { name: "Buka navigasi" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("hn-primary-navigation")).toHaveAttribute("inert");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("hn-primary-navigation")).not.toHaveAttribute("inert");
    expect(document.querySelector(".hn-shell-column")).toHaveAttribute("inert");
    expect(document.querySelector(".hn-shell-column")).toHaveAttribute("aria-hidden", "true");

    const nav = screen.getByRole("navigation", { name: "Navigasi utama" });
    const buttons = Array.from(nav.querySelectorAll("button"));
    expect(buttons).toHaveLength(HN_NAV.length);
    for (const item of HN_NAV) expect(screen.getByRole("button", { name: item.label })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(onNavigate).toHaveBeenCalledWith("projects");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("closes the drawer with Escape and returns focus to its toggle", () => {
    mobileViewport();
    render(<Shell active="overview" title="Overview" onNavigate={() => {}}>Isi</Shell>);
    const toggle = screen.getByRole("button", { name: "Buka navigasi" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Overview" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
});

function DialogHarness() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Buka dialog</button>
      <Modal open={open} title="Ubah proyek" onClose={() => setOpen(false)} footer={<button>Simpan</button>}>
        <input aria-label="Nama proyek" />
      </Modal>
    </>
  );
}

describe("responsive Modal", () => {
  it("labels the dialog, traps focus, closes on Escape, and restores focus", () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Buka dialog" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Ubah proyek" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Nama proyek")).toHaveFocus();

    const close = screen.getByRole("button", { name: "Tutup" });
    const save = screen.getByRole("button", { name: "Simpan" });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();

    act(() => fireEvent.keyDown(document, { key: "Escape" }));
    expect(dialog).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("lets only the topmost nested dialog consume Escape", () => {
    function NestedDialogs() {
      const [child, setChild] = React.useState(false);
      return (
        <Modal open title="Induk" onClose={() => {}}>
          <button onClick={() => setChild(true)}>Buka anak</button>
          <Modal open={child} title="Anak" onClose={() => setChild(false)}>Isi anak</Modal>
        </Modal>
      );
    }
    render(<NestedDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Buka anak" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Anak" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Induk" })).toBeInTheDocument();
  });
});
