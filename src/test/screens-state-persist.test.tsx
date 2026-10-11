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

  // Redesign 3P: select filter status dibuang. Status kini indeks lipat per grup; tak ada lagi
  // filter status yang disimpan, dan penghitung "filter aktif" hanya menghitung pilihan project.
  it("tanpa select status: tak ada filter status tersimpan", async () => {
    render(<PrdScreen {...(props as any)} />);
    expect(screen.queryByLabelText("Status PRD")).toBeNull();
    expect(readUiState(uiKey("prd", "status"), "all")).toBe("all");
    cleanup();
  });

  it("penghitung filter aktif mengikuti pilihan project saja", () => {
    render(<PrdScreen {...(props as any)} projectFilter="erp" />);
    expect(screen.getByText("1 filter aktif")).toBeTruthy();
  });
});
