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
      listGithubIssues: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

import { TriageScreen } from "../src/screens/TriageScreen";
import { api } from "../src/api/client";

const projects = [{ id: "erp", name: "ERP" }] as any[];
const props = { projects, onAccepted: () => {}, onToast: () => {} };

// Audit UI/UX 2026-10 · Fase 3F: status = segmented; project & sumber = popover "Filter".
const openFilter = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.listTickets).mockClear();
});

describe("state tampilan Triase", () => {
  it("project & sumber bertahan lintas unmount/remount; status ikut tersimpan", async () => {
    render(<TriageScreen {...(props as any)} />);
    await openFilter();
    fireEvent.change(screen.getByLabelText("Project triase"), { target: { value: "erp" } });
    fireEvent.change(screen.getByLabelText("Sumber triase"), { target: { value: "tiket" } });
    fireEvent.click(screen.getByRole("button", { name: /^Diterima/ }));
    await waitFor(() => expect(readUiState(uiKey("triage", "status"), "new")).toBe("accepted"));
    expect(readUiState(uiKey("triage", "project"), "")).toBe("erp");
    expect(readUiState(uiKey("triage", "source"), "semua")).toBe("tiket");

    cleanup();
    render(<TriageScreen {...(props as any)} />);
    expect(screen.getByRole("button", { name: /^Diterima/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Project: ERP")).toBeTruthy();
    expect(screen.getByText("Sumber: Help Center")).toBeTruthy();
  });

  it("sumber GitHub tanpa project menjelaskan perlunya project, bukan daftar kosong senyap", async () => {
    writeUiState(uiKey("triage", "source"), "issue");
    render(<TriageScreen {...(props as any)} />);
    expect(await screen.findByText("Pilih satu project")).toBeTruthy();
    cleanup();
    render(<TriageScreen {...(props as any)} />);
    expect(await screen.findByText("Pilih satu project")).toBeTruthy();
  });

  it("nomor halaman bertahan lintas remount — mount bukan ganti penyaring", async () => {
    writeUiState(uiKey("triage", "page"), 2);
    render(<TriageScreen {...(props as any)} />);
    await waitFor(() => expect(api.listTickets).toHaveBeenCalled());
    expect(vi.mocked(api.listTickets).mock.calls.at(-1)![0]).toMatchObject({ page: "2" });
    expect(readUiState(uiKey("triage", "page"), 1)).toBe(2);
  });

  it("ganti status TETAP mengembalikan daftar ke halaman 1 (AC-15)", async () => {
    writeUiState(uiKey("triage", "page"), 2);
    render(<TriageScreen {...(props as any)} />);
    fireEvent.click(screen.getByRole("button", { name: /^Diterima/ }));
    await waitFor(() =>
      expect(vi.mocked(api.listTickets).mock.calls.at(-1)![0]).toMatchObject({ page: "1", status: "accepted" }));
  });

  it("Reset tampilan mengembalikan penyaring project & sumber ke default", async () => {
    render(<TriageScreen {...(props as any)} />);
    await openFilter();
    fireEvent.change(screen.getByLabelText("Sumber triase"), { target: { value: "tiket" } });
    expect(await screen.findByText("1 filter aktif")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect(screen.queryByText("Sumber: Help Center")).toBeNull();
    expect(screen.queryByText(/filter aktif/)).toBeNull();
  });
});
