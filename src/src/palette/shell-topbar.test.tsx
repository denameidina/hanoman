// Topbar Shell untuk palet (Fase 2C): tombol "Cari" membuka palet dan menunjukkan petunjuk ⌘K/Ctrl K,
// project switcher hanya tampil di layar yang membaca projectFilter, dan scope-nya masuk breadcrumb.
import { eventsStub } from "../../test/helpers/events-stub";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Shell } from "../ds/shell";
import { ProjectScopeContext, type ProjectScopeValue } from "./ProjectSwitcher";
import { getPaletteUi, resetPaletteUi } from "./ui-store";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<any>("../api/client");
  return {
    ...actual,
    api: {
      listNotifications: vi.fn().mockResolvedValue({ items: [], unread: 0 }),
      getLimits: vi.fn().mockResolvedValue(null),
      getCodexLimits: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ current: "0.0.0", latest: null, canApply: false }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

vi.mock("../api/events", () => ({
  ...eventsStub,
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

function scope(over: Partial<ProjectScopeValue> = {}): ProjectScopeValue {
  return {
    value: "erp",
    projects: [{ id: "erp", name: "ERP Tumbuh" }, { id: "crm", name: "CRM" }],
    onChange: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  resetPaletteUi();
  localStorage.clear();
});

describe("tombol Cari di topbar", () => {
  it("membuka palet perintah saat ditekan", () => {
    render(<Shell active="overview" title="Overview">isi</Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Cari" }));
    expect(getPaletteUi().palette).toBe(true);
  });

  it("menampilkan petunjuk Ctrl K di luar Mac dan aria-keyshortcuts yang sesuai", () => {
    render(<Shell active="overview" title="Overview">isi</Shell>);
    const btn = screen.getByRole("button", { name: "Cari" });
    expect(btn).toHaveTextContent("Ctrl K");
    expect(btn).toHaveAttribute("aria-keyshortcuts", "Control+K");
  });

  it("kotak cari layar (Projects) tetap ada berdampingan dengan tombol palet", () => {
    render(<Shell active="projects" title="Projects" showSearch onSearchChange={() => {}}>isi</Shell>);
    expect(screen.getByRole("textbox", { name: "Cari" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cari" })).toBeInTheDocument();
  });
});

describe("project switcher", () => {
  it("tampil di layar yang membaca projectFilter dan mengubah scope lewat konteks", () => {
    const s = scope();
    render(<ProjectScopeContext.Provider value={s}><Shell active="backlog" title="Backlog">isi</Shell></ProjectScopeContext.Provider>);
    const select = screen.getByRole("combobox", { name: "Project aktif" }) as HTMLSelectElement;
    expect(select.value).toBe("erp");
    fireEvent.change(select, { target: { value: "all" } });
    expect(s.onChange).toHaveBeenCalledWith("all");
  });

  it("tak tampil di layar yang tak membaca projectFilter (Overview)", () => {
    render(<ProjectScopeContext.Provider value={scope()}><Shell active="overview" title="Overview">isi</Shell></ProjectScopeContext.Provider>);
    expect(screen.queryByRole("combobox", { name: "Project aktif" })).toBeNull();
  });

  it("nama project aktif masuk breadcrumb; 'Semua project' tidak menambah apa pun", () => {
    const { rerender } = render(
      <ProjectScopeContext.Provider value={scope()}><Shell active="team" title="Tim" breadcrumb="tugas manusia">isi</Shell></ProjectScopeContext.Provider>,
    );
    expect(screen.getByTestId("scope-crumb")).toHaveTextContent("project: ERP Tumbuh");
    expect(screen.getByTestId("scope-crumb").parentElement).toHaveTextContent("tugas manusia · project: ERP Tumbuh");

    rerender(
      <ProjectScopeContext.Provider value={scope({ value: "all" })}><Shell active="team" title="Tim" breadcrumb="tugas manusia">isi</Shell></ProjectScopeContext.Provider>,
    );
    expect(screen.queryByTestId("scope-crumb")).toBeNull();
  });

  it("tanpa konteks (Shell berdiri sendiri) tak ada switcher", () => {
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    expect(screen.queryByRole("combobox", { name: "Project aktif" })).toBeNull();
  });
});
