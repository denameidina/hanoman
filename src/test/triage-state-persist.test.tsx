import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState, writeUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listTickets: vi.fn().mockResolvedValue({ items: [], total: 0, unreviewed: 0 }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

import { TriageScreen } from "../src/screens/TriageScreen";
import { api } from "../src/api/client";

const projects = [{ id: "erp", name: "ERP" }] as any[];
const props = { projects, onAccepted: () => {}, onToast: () => {} };

beforeEach(() => localStorage.clear());

describe("state tampilan Triase", () => {
  it("filter status & project bertahan lintas unmount/remount", async () => {
    render(<TriageScreen {...(props as any)} />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "erp" } });
    fireEvent.change(selects[1]!, { target: { value: "accepted" } });
    await waitFor(() => expect(readUiState(uiKey("triage", "status"), "")).toBe("accepted"));

    cleanup();
    render(<TriageScreen {...(props as any)} />);
    const again = screen.getAllByRole("combobox");
    expect((again[0] as HTMLSelectElement).value).toBe("erp");
    expect((again[1] as HTMLSelectElement).value).toBe("accepted");
  });

  it("tab yang aktif bertahan", async () => {
    render(<TriageScreen {...(props as any)} />);
    fireEvent.click(screen.getByText("Issue GitHub"));
    await waitFor(() => expect(readUiState(uiKey("triage", "tab"), "tiket")).toBe("issue"));
    cleanup();
    render(<TriageScreen {...(props as any)} />);
    expect(screen.getByText("Pilih satu project")).toBeTruthy();
  });

  it("nomor halaman bertahan lintas remount — mount bukan ganti penyaring", async () => {
    writeUiState(uiKey("triage", "page"), 2);
    vi.mocked(api.listTickets).mockClear();
    render(<TriageScreen {...(props as any)} />);
    await waitFor(() => expect(api.listTickets).toHaveBeenCalled());
    expect(vi.mocked(api.listTickets).mock.calls.at(-1)![0]).toMatchObject({ page: "2" });
    expect(readUiState(uiKey("triage", "page"), 1)).toBe(2);
  });

  it("ganti penyaring TETAP mengembalikan daftar ke halaman 1 (AC-15)", async () => {
    writeUiState(uiKey("triage", "page"), 2);
    vi.mocked(api.listTickets).mockClear();
    render(<TriageScreen {...(props as any)} />);
    fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "accepted" } });
    await waitFor(() =>
      expect(vi.mocked(api.listTickets).mock.calls.at(-1)![0]).toMatchObject({ page: "1", status: "accepted" }));
  });

  it("Reset tampilan mengembalikan penyaring ke default", () => {
    render(<TriageScreen {...(props as any)} />);
    fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "rejected" } });
    expect(screen.getByText("1 filter aktif")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("");
    expect(screen.queryByText(/filter aktif/)).toBeNull();
  });
});
