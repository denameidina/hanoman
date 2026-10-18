// ADR-0205 · tab hub (SectionTabs), breadcrumb "Hub › Tab", dan ingatan tab terakhir per hub di Shell.
import { render, screen, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PENDING } from "@hanoman/shared";

// Widget topbar yang self-fetch / butuh provider → di-noop (pola sama dengan nav-pending-badge.test).
vi.mock("../src/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("../src/screens/LimitIndicator", () => ({ LimitBadge: () => null, CodexLimitBadge: () => null, AntigravityLimitBadge: () => null }));
vi.mock("../src/screens/UpdateIndicator", () => ({ UpdateBadge: () => null, ReloadBadge: () => null }));
vi.mock("../src/auth/AccountMenu", () => ({ AccountMenu: () => null }));

import { NavGate, NavPending, Shell } from "../src/ds/shell";
import { SectionTabs } from "../src/ds/section-tabs";
import { uiKey, writeUiState } from "../src/ui-state/store";

beforeEach(() => localStorage.clear());

describe("SectionTabs · tab hub di atas layar anak hub", () => {
  it("memasang tablist hub dan memilih tab dari section URL", () => {
    render(<SectionTabs section="prd" onNavigate={() => {}} />);
    const list = screen.getByRole("tablist", { name: "Projects" });
    expect(within(list).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Daftar", "PRD", "Docs", "QA", "Kode"]);
    expect(screen.getByRole("tab", { name: "PRD" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Daftar" })).toHaveAttribute("aria-selected", "false");
  });

  it("layar turunan (detail project) memilih tab induknya", () => {
    render(<SectionTabs section="project" onNavigate={() => {}} />);
    expect(screen.getByRole("tab", { name: "Daftar" })).toHaveAttribute("aria-selected", "true");
  });

  it("klik tab menavigasi ke section-nya; tab yang sudah terpilih tak menavigasi ulang", () => {
    const onNavigate = vi.fn();
    render(<SectionTabs section="prd" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("tab", { name: "Docs" }));
    expect(onNavigate).toHaveBeenLastCalledWith("docs");
    onNavigate.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "PRD" }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("dari detail project, klik 'Daftar' tetap membawa keluar ke daftarnya", () => {
    const onNavigate = vi.fn();
    render(<SectionTabs section="project" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("tab", { name: "Daftar" }));
    expect(onNavigate).toHaveBeenCalledWith("projects");
  });

  it("tab bergerbang disembunyikan; hub yang tersisa satu tab tak merender bar sama sekali", () => {
    const { unmount } = render(<NavGate.Provider value={{ clients: false }}><SectionTabs section="terminal" onNavigate={() => {}} /></NavGate.Provider>);
    expect(screen.queryByRole("tablist")).toBeNull();
    unmount();
    render(<NavGate.Provider value={{ clients: true }}><SectionTabs section="terminal" onNavigate={() => {}} /></NavGate.Provider>);
    expect(screen.getByRole("tab", { name: "Perangkat" })).toBeInTheDocument();
  });

  it("layar tanpa tab (hub satu layar, palet-saja) tak merender apa pun", () => {
    for (const section of ["overview", "triage", "skills", "dalang"]) {
      const { container, unmount } = render(<SectionTabs section={section} onNavigate={() => {}} />);
      expect(container, section).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("angka antrean tampil di tab yang bersangkutan", () => {
    render(<NavPending.Provider value={{ ...EMPTY_PENDING, prd: 3 }}><SectionTabs section="docs" onNavigate={() => {}} /></NavPending.Provider>);
    expect(within(screen.getByRole("tab", { name: /PRD/ })).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: "Docs" })).queryByText(/\d/)).toBeNull();
  });
});

describe("Shell · breadcrumb hub dan ingatan tab", () => {
  it("crumb 'Hub › Tab' untuk hub bertab banyak; deskripsi layar tetap terbaca utuh", () => {
    render(<Shell active="prd" title="PRD" breadcrumb="brief → brainstorm → dokumen" onNavigate={() => {}}>isi</Shell>);
    expect(screen.getByTestId("hub-crumb")).toHaveTextContent("Projects › PRD");
    expect(screen.getByText("brief → brainstorm → dokumen")).toBeInTheDocument();
  });

  it("layar turunan review menampilkan induknya di crumb", () => {
    render(<Shell active="review" title="Review" onNavigate={() => {}}>isi</Shell>);
    expect(screen.getByTestId("hub-crumb")).toHaveTextContent("Backlog › Spec");
  });

  it("hub satu layar tak punya crumb", () => {
    render(<Shell active="overview" title="Overview" breadcrumb="nafanesia.id · ringkasan workspace" onNavigate={() => {}}>isi</Shell>);
    expect(screen.queryByTestId("hub-crumb")).toBeNull();
    expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeInTheDocument();
  });

  it("tanpa riwayat, klik hub memakai default-nya", () => {
    const onNavigate = vi.fn();
    render(<Shell active="overview" title="Overview" onNavigate={onNavigate}>isi</Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(onNavigate).toHaveBeenLastCalledWith("backlog");
  });

  it("klik hub kembali ke tab terakhir yang dibuka di hub itu, dan bertahan lewat pemasangan ulang", () => {
    const onNavigate = vi.fn();
    render(<Shell active="team" title="Tim" onNavigate={onNavigate}>isi</Shell>).unmount();
    render(<Shell active="overview" title="Overview" onNavigate={onNavigate}>isi</Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(onNavigate).toHaveBeenLastCalledWith("team");
  });

  it("riwayat tab klien yang gerbangnya mati jatuh ke default hub Sesi", () => {
    writeUiState(uiKey("nav", "lastTab"), { sesi: "clients" });
    const onNavigate = vi.fn();
    render(<Shell active="overview" title="Overview" onNavigate={onNavigate}>isi</Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Sesi" }));
    expect(onNavigate).toHaveBeenLastCalledWith("terminal");
  });
});
