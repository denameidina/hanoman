import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { openPalette, resetPaletteUi, getPaletteUi } from "./ui-store";
import type { PaletteCommand } from "./commands";

function commands(): PaletteCommand[] {
  return [
    { id: "nav:backlog", group: "Pindah ke", label: "Backlog", hint: "halaman", run: vi.fn() },
    { id: "nav:overview", group: "Pindah ke", label: "Overview", hint: "halaman", run: vi.fn() },
    { id: "action:answer", group: "Aksi", label: "Jawab sesi yang menunggu", disabled: true,
      hint: "tidak ada sesi yang menunggu", run: vi.fn() },
    { id: "action:scope", group: "Aksi", label: "Ganti project aktif", prefill: "project ", run: vi.fn() },
    { id: "scope:erp", group: "Project", label: "Ganti project ke ERP Tumbuh", keywords: "project erp", run: vi.fn() },
  ];
}

const combo = () => screen.getByRole("combobox", { name: "Cari perintah, halaman, atau backlog" }) as HTMLInputElement;
const optionTexts = () => within(screen.getByRole("listbox", { name: "Hasil perintah" }))
  .getAllByRole("option").map((o) => o.textContent ?? "");

beforeEach(() => {
  resetPaletteUi();
  localStorage.clear();
});

describe("CommandPalette", () => {
  it("tertutup secara default; terbuka lewat openPalette sebagai dialog modal dengan nama", () => {
    render(<CommandPalette commands={commands()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openPalette());
    const dialog = screen.getByRole("dialog", { name: "Palet perintah" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(combo());
  });

  it("kueri kosong menampilkan grup pembuka; kueri terisi menyaring hasil", () => {
    render(<CommandPalette commands={commands()} />);
    act(() => openPalette());
    const listbox = screen.getByRole("listbox", { name: "Hasil perintah" });
    expect(within(listbox).getByRole("group", { name: "Pindah ke" })).toBeInTheDocument();
    expect(within(listbox).getByRole("group", { name: "Aksi" })).toBeInTheDocument();
    // Grup daftar panjang (Project) hanya muncul bila diketik.
    expect(within(listbox).queryByRole("group", { name: "Project" })).toBeNull();
    expect(optionTexts()).toHaveLength(4);

    fireEvent.change(combo(), { target: { value: "backlog" } });
    expect(optionTexts()).toHaveLength(1);
    expect(optionTexts()[0]).toContain("Backlog");
  });

  it("panah mengganti opsi aktif lewat aria-activedescendant dan melewati yang nonaktif; Enter menjalankan dan menutup", () => {
    const cmds = commands();
    render(<CommandPalette commands={cmds} />);
    act(() => openPalette());
    // Opsi aktif awal = yang pertama TIDAK nonaktif ("Ganti project aktif"), bukan "Jawab sesi" yang mati.
    const scopeOpt = screen.getByRole("option", { name: /Ganti project aktif/ });
    expect(combo().getAttribute("aria-activedescendant")).toBe(scopeOpt.id);
    fireEvent.keyDown(combo(), { key: "ArrowDown" });
    const backlogOpt = screen.getByRole("option", { name: /Backlog/ });
    expect(combo().getAttribute("aria-activedescendant")).toBe(backlogOpt.id);
    fireEvent.keyDown(combo(), { key: "ArrowUp" });
    expect(combo().getAttribute("aria-activedescendant")).toBe(scopeOpt.id);
    fireEvent.keyDown(combo(), { key: "ArrowDown" });
    fireEvent.keyDown(combo(), { key: "Enter" });
    expect(cmds[0]!.run).toHaveBeenCalledOnce();
    expect(getPaletteUi().palette).toBe(false);
  });

  it("perintah nonaktif tak bisa dijalankan dan ditandai aria-disabled", () => {
    const cmds = commands();
    render(<CommandPalette commands={cmds} />);
    act(() => openPalette());
    const option = screen.getByRole("option", { name: /Jawab sesi yang menunggu/ });
    expect(option).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(option);
    expect(cmds[2]!.run).not.toHaveBeenCalled();
    expect(getPaletteUi().palette).toBe(true);
  });

  it("perintah 'prefill' mengisi kueri dan palet tetap terbuka", () => {
    render(<CommandPalette commands={commands()} />);
    act(() => openPalette());
    fireEvent.click(screen.getByRole("option", { name: /Ganti project aktif/ }));
    expect(combo().value).toBe("project ");
    expect(getPaletteUi().palette).toBe(true);
    expect(optionTexts().some((t) => t.includes("Ganti project ke ERP Tumbuh"))).toBe(true);
  });

  it("Esc menutup palet dan fokus kembali ke pemicu", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "pemicu";
    document.body.appendChild(trigger);
    trigger.focus();
    render(<CommandPalette commands={commands()} />);
    act(() => openPalette());
    expect(document.activeElement).toBe(combo());
    fireEvent.keyDown(combo(), { key: "Escape" });
    expect(getPaletteUi().palette).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("kueri tanpa hasil menampilkan status, bukan daftar kosong yang sunyi", () => {
    render(<CommandPalette commands={commands()} />);
    act(() => openPalette());
    fireEvent.change(combo(), { target: { value: "zzqx" } });
    expect(screen.getByRole("status")).toHaveTextContent("Tidak ada yang cocok dengan “zzqx”.");
  });

  it("perintah yang dijalankan masuk riwayat ui-state dan tampil di grup Riwayat saat dibuka lagi", () => {
    const cmds = commands();
    const { unmount } = render(<CommandPalette commands={cmds} />);
    act(() => openPalette());
    fireEvent.click(screen.getByRole("option", { name: /Overview/ }));
    expect(JSON.parse(localStorage.getItem("hn.ui.v1.palette.recent")!)).toEqual(["nav:overview"]);
    unmount();

    render(<CommandPalette commands={cmds} />);
    act(() => openPalette());
    const riwayat = screen.getByRole("group", { name: "Riwayat" });
    expect(within(riwayat).getByRole("option")).toHaveTextContent("Overview");
  });
});
