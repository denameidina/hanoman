import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState, writeUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listSpecs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";

const projects = [{ id: "erp", name: "ERP" }] as any[];
const props = {
  backlog: [] as any[], projects, pageSize: 20,
  projectFilter: "all", onProjectFilter: () => {},
};
// Filter lanjutan ada di popover "Filter" (progressive disclosure): buka sebelum mengakses kontrolnya.
const openFilter = () => fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));

beforeEach(() => localStorage.clear());

describe("state tampilan Backlog", () => {
  it("nomor halaman bertahan lintas remount — mount bukan ganti penyaring", async () => {
    writeUiState(uiKey("backlog", "page"), 3);
    vi.mocked(api.listSpecs).mockClear();
    render(<BacklogScreen {...(props as any)} />);
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    // Paginasi dilakukan klien atas himpunan penuh: halaman tak dikirim ke server.
    expect(vi.mocked(api.listSpecs).mock.calls.at(-1)![0]).not.toHaveProperty("page");
    expect(readUiState(uiKey("backlog", "page"), 1)).toBe(3);
  });

  it("kata kunci tersimpan tak menghapus halaman lewat debounce `dq`", async () => {
    // `dq` lahir kosong lalu menyusul 250 ms kemudian; tanpa seed dari `q` tersimpan, ia terbaca
    // sebagai PERGANTIAN penyaring dan menghapus halaman yang baru saja selamat dari mount.
    writeUiState(uiKey("backlog", "q"), "invoice");
    writeUiState(uiKey("backlog", "page"), 3);
    vi.mocked(api.listSpecs).mockClear();
    render(<BacklogScreen {...(props as any)} />);
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 400));
    expect(vi.mocked(api.listSpecs).mock.calls.at(-1)![0]).toMatchObject({ q: "invoice" });
    expect(readUiState(uiKey("backlog", "page"), 1)).toBe(3);
  });

  it("ganti penyaring TETAP mengembalikan daftar ke halaman 1 (AC-15)", async () => {
    writeUiState(uiKey("backlog", "page"), 3);
    vi.mocked(api.listSpecs).mockClear();
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.click(screen.getByRole("tab", { name: /Dikerjakan/ }));
    await waitFor(() => expect(readUiState(uiKey("backlog", "page"), 3)).toBe(1));
  });

  it("kata kunci, tahap, dan prioritas bertahan lintas unmount/remount", async () => {
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Cari backlog"), { target: { value: "invoice" } });
    fireEvent.click(screen.getByRole("tab", { name: /Dikerjakan/ }));
    openFilter();
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    await waitFor(() => expect(readUiState(uiKey("backlog", "q"), "")).toBe("invoice"));

    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    expect((screen.getByLabelText("Cari backlog") as HTMLInputElement).value).toBe("invoice");
    expect(screen.getByRole("tab", { name: /Dikerjakan/ })).toHaveAttribute("aria-selected", "true");
    openFilter();
    expect((screen.getByLabelText("Filter prioritas") as HTMLSelectElement).value).toBe("tinggi");
  });

  it("rentang tanggal bertahan", async () => {
    render(<BacklogScreen {...(props as any)} />);
    openFilter();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(readUiState(uiKey("backlog", "from"), "")).toBe("2026-08-01"));
    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    openFilter();
    expect((screen.getByLabelText("Tanggal dari") as HTMLInputElement).value).toBe("2026-08-01");
  });

  it("filter aktif tampil sebagai chip dan Reset filter mengembalikan default", () => {
    render(<BacklogScreen {...(props as any)} />);
    expect(screen.queryByRole("button", { name: "Reset filter" })).toBeNull();
    openFilter();
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    expect(screen.getByRole("button", { name: "Hapus filter Prioritas: Tinggi" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    expect((screen.getByLabelText("Filter prioritas") as HTMLSelectElement).value).toBe("all");
    expect(screen.queryByRole("button", { name: /^Hapus filter/ })).toBeNull();
    expect(readUiState(uiKey("backlog", "prio"), "all")).toBe("all");
  });

  it("mode tampilan bertahan", () => {
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.click(screen.getByRole("button", { name: "Papan" }));
    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    expect(readUiState(uiKey("backlog", "view"), "list")).toBe("board");
    expect(screen.getByRole("button", { name: "Papan" })).toHaveAttribute("aria-pressed", "true");
  });
});
