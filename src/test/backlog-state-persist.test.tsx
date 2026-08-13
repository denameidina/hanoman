import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState } from "../src/ui-state";

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

const projects = [{ id: "erp", name: "ERP" }] as any[];
const props = {
  backlog: [] as any[], projects, pageSize: 20,
  projectFilter: "all", onProjectFilter: () => {},
};

beforeEach(() => localStorage.clear());

describe("state tampilan Backlog", () => {
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
