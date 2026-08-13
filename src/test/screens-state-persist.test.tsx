import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, scoped, readUiState, writeUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listAllPrds: vi.fn().mockResolvedValue({ items: [] }),
      listPrds: vi.fn().mockResolvedValue({ items: [] }),
      listChangelogs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getChangelogSources: vi.fn().mockResolvedValue({ modes: [] }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

import { PrdScreen } from "../src/screens/PrdScreen";
import { ChangelogScreen } from "../src/screens/ChangelogScreen";

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

describe("state tampilan Changelog", () => {
  it("pencarian ber-scope project — project lain tak terkena", async () => {
    render(<ChangelogScreen p={projects[0]} onToast={() => {}} />);
    fireEvent.change(screen.getByLabelText("Cari rilis"), { target: { value: "rilis" } });
    await waitFor(() => expect(readUiState(uiKey(scoped("changelog", "erp"), "q"), "")).toBe("rilis"));
    expect(readUiState(uiKey(scoped("changelog", "crm"), "q"), "")).toBe("");
  });

  it("pencarian project lain dipulihkan saat project berganti", () => {
    writeUiState(uiKey(scoped("changelog", "crm"), "q"), "milik-crm");
    const { rerender } = render(<ChangelogScreen p={projects[0]} onToast={() => {}} />);
    expect((screen.getByLabelText("Cari rilis") as HTMLInputElement).value).toBe("");
    rerender(<ChangelogScreen p={projects[1]} onToast={() => {}} />);
    expect((screen.getByLabelText("Cari rilis") as HTMLInputElement).value).toBe("milik-crm");
  });
});
