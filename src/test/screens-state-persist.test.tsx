import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listAllPrds: vi.fn().mockResolvedValue({ items: [] }),
      listPrds: vi.fn().mockResolvedValue({ items: [] }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

import { PrdScreen } from "../src/screens/PrdScreen";

beforeEach(() => localStorage.clear());

const projects = [{ id: "erp", name: "ERP" }, { id: "crm", name: "CRM" }] as any[];

describe("state tampilan PRD", () => {
  const props = {
    projects, projectFilter: "all", onProjectFilter: () => {},
    onNewPrd: () => {}, onTakeToBacklog: () => {}, onStartBreakdown: () => {}, onMaterialize: () => {},
  };

  it("filter status bertahan lintas unmount/remount", async () => {
    render(<PrdScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Status PRD"), { target: { value: "draft" } });
    await waitFor(() => expect(readUiState(uiKey("prd", "status"), "all")).toBe("draft"));
    cleanup();
    render(<PrdScreen {...(props as any)} />);
    expect((screen.getByLabelText("Status PRD") as HTMLSelectElement).value).toBe("draft");
  });

  it("Reset tampilan mengembalikan status ke semua", () => {
    render(<PrdScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Status PRD"), { target: { value: "draft" } });
    expect(screen.getByText("1 filter aktif")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect((screen.getByLabelText("Status PRD") as HTMLSelectElement).value).toBe("all");
  });
});
