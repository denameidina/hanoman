import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState, writeUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      getLeadStatus: vi.fn().mockResolvedValue({
        config: { enabled: false, maxConcurrent: 2 }, projects: [], deciding: [], queued: [], waiting: [],
        lastPulseAt: null, gate: { inFlight: 0, waiting: 0, capacity: 2 },
      }),
      getLeadDecisions: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      getLeadFlows: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      putLeadConfig: vi.fn(),
      updateProject: vi.fn(),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

import { LeadScreen } from "../src/screens/LeadScreen";
import { api } from "../src/api/client";

const projects = [{ id: "erp", name: "ERP" }] as any[];
const props = { projects, onProjectChanged: () => {}, onToast: () => {}, onGotoTerminal: () => {} };

beforeEach(() => localStorage.clear());

describe("state tampilan Lead", () => {
  it("penyaring project bertahan lintas unmount/remount", async () => {
    render(<LeadScreen {...(props as any)} />);
    fireEvent.change(await screen.findByLabelText("saring project"), { target: { value: "erp" } });
    await waitFor(() => expect(readUiState(uiKey("lead", "filter"), "all")).toBe("erp"));
    cleanup();
    render(<LeadScreen {...(props as any)} />);
    expect(((await screen.findByLabelText("saring project")) as HTMLSelectElement).value).toBe("erp");
  });

  it("nomor halaman kedua daftar bertahan lintas remount — mount bukan ganti penyaring", async () => {
    writeUiState(uiKey("lead", "decPage"), 2);
    writeUiState(uiKey("lead", "flowPage"), 3);
    vi.mocked(api.getLeadDecisions).mockClear();
    vi.mocked(api.getLeadFlows).mockClear();
    render(<LeadScreen {...(props as any)} />);
    await screen.findByLabelText("saring project");
    await waitFor(() => expect(api.getLeadDecisions).toHaveBeenCalled());
    expect(vi.mocked(api.getLeadDecisions).mock.calls.at(-1)![0]).toMatchObject({ page: 2 });
    expect(vi.mocked(api.getLeadFlows).mock.calls.at(-1)![0]).toMatchObject({ page: 3 });
    expect(readUiState(uiKey("lead", "decPage"), 1)).toBe(2);
    expect(readUiState(uiKey("lead", "flowPage"), 1)).toBe(3);
  });

  it("ganti penyaring TETAP mengembalikan kedua daftar ke halaman 1 (AC-15)", async () => {
    writeUiState(uiKey("lead", "decPage"), 2);
    writeUiState(uiKey("lead", "flowPage"), 3);
    vi.mocked(api.getLeadDecisions).mockClear();
    render(<LeadScreen {...(props as any)} />);
    fireEvent.change(await screen.findByLabelText("saring project"), { target: { value: "erp" } });
    await waitFor(() =>
      expect(vi.mocked(api.getLeadDecisions).mock.calls.at(-1)![0]).toMatchObject({ page: 1, projectId: "erp" }));
    expect(readUiState(uiKey("lead", "flowPage"), 99)).toBe(1);
  });

  it("Reset tampilan mengembalikan penyaring ke semua project", async () => {
    render(<LeadScreen {...(props as any)} />);
    fireEvent.change(await screen.findByLabelText("saring project"), { target: { value: "erp" } });
    // Ganti penyaring memicu load() non-silent → layar sempat kembali ke state "loading".
    expect(await screen.findByText("1 filter aktif")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect(((await screen.findByLabelText("saring project")) as HTMLSelectElement).value).toBe("all");
  });
});
