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

beforeEach(() => localStorage.clear());

describe("state tampilan Backlog", () => {
  it("nomor halaman bertahan lintas remount — mount bukan ganti penyaring", async () => {
    writeUiState(uiKey("backlog", "page"), 3);
    vi.mocked(api.listSpecs).mockClear();
    render(<BacklogScreen {...(props as any)} />);
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(vi.mocked(api.listSpecs).mock.calls.at(-1)![0]).toMatchObject({ page: 3 });
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
    expect(vi.mocked(api.listSpecs).mock.calls.at(-1)![0]).toMatchObject({ q: "invoice", page: 3 });
  });

  it("ganti penyaring TETAP mengembalikan daftar ke halaman 1 (AC-15)", async () => {
    writeUiState(uiKey("backlog", "page"), 3);
    vi.mocked(api.listSpecs).mockClear();
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "executing" } });
    await waitFor(() =>
      expect(vi.mocked(api.listSpecs).mock.calls.at(-1)![0]).toMatchObject({ page: 1, stage: "executing" }));
  });

  it("kata kunci, stage, dan prioritas bertahan lintas unmount/remount", async () => {
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Cari backlog"), { target: { value: "invoice" } });
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "executing" } });
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    await waitFor(() => expect(readUiState(uiKey("backlog", "q"), "")).toBe("invoice"));

    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    expect((screen.getByLabelText("Cari backlog") as HTMLInputElement).value).toBe("invoice");
    expect((screen.getByLabelText("Filter stage") as HTMLSelectElement).value).toBe("executing");
    expect((screen.getByLabelText("Filter prioritas") as HTMLSelectElement).value).toBe("tinggi");
  });

  it("rentang tanggal bertahan", async () => {
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(readUiState(uiKey("backlog", "from"), "")).toBe("2026-08-01"));
    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    expect((screen.getByLabelText("Tanggal dari") as HTMLInputElement).value).toBe("2026-08-01");
  });

  it("lencana filter aktif menyala dan Reset tampilan mengembalikan default", () => {
    render(<BacklogScreen {...(props as any)} />);
    expect(screen.queryByText(/filter aktif/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    expect(screen.getByText("1 filter aktif")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect((screen.getByLabelText("Filter prioritas") as HTMLSelectElement).value).toBe("all");
    expect(screen.queryByText(/filter aktif/)).toBeNull();
    expect(readUiState(uiKey("backlog", "prio"), "all")).toBe("all");
  });

  it("mode tampilan bertahan", () => {
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.click(screen.getByText("List"));
    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    expect(readUiState(uiKey("backlog", "view"), "grid")).toBe("list");
  });
});
