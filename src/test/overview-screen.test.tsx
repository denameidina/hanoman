import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OverviewScreen } from "../src/screens/OverviewScreen";
import type { ProjectVM, SpecSlim } from "../src/screens/types";
import type { TerminalSession } from "../src/api/client";

// Dua sumber limit dimock lewat objek hoisted supaya tiap test bisa mengubah statusnya.
const { claude, codex } = vi.hoisted(() => ({
  claude: { label: "limit-claude", status: "ok" },
  codex: { label: "limit-codex", status: "unavailable", plan: null as string | null },
}));
vi.mock("../src/api/limits", () => ({ useLimits: () => claude }));
vi.mock("../src/api/codex-limits", () => ({ useCodexLimits: () => codex }));
vi.mock("../src/screens/LimitIndicator", async () => {
  const React = await import("react");
  return { LimitWindows: ({ dto }: { dto: { label: string } }) => React.createElement("div", { "data-testid": "limit-body" }, dto.label) };
});

const noop = () => {};
const project = (over: Partial<ProjectVM> & { id: string; name: string }) =>
  ({ docStatus: "ok", coverage: 90, activity: "commit terakhir", commit: "abc123",
    session: { status: "idle", phase: null, flow: null }, ...over }) as unknown as ProjectVM;
const session = (over: Partial<TerminalSession> & { id: string; projectId: string }) =>
  ({ cwd: "/tmp", exited: false, ...over }) as TerminalSession;
const spec = (over: { id: string; startedAt?: string | null; stage?: string }) =>
  ({ id: over.id, stage: over.stage ?? "executing", startedAt: over.startedAt ?? null, source: "brief", priority: "sedang" }) as unknown as SpecSlim;

beforeEach(() => { codex.status = "unavailable"; codex.plan = null; });

describe("Overview · tanpa project", () => {
  it("menampilkan CTA onboarding, tanpa KPI '0/0' atau 'on-convention'", () => {
    const onGoto = vi.fn();
    render(<OverviewScreen projects={[]} backlog={[]} sessions={[]} onOpenProject={noop} onGoto={onGoto} onOpenSession={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Buat project pertama" }));
    expect(onGoto).toHaveBeenCalledWith("projects");
    expect(screen.queryByText(/0\/0/)).toBeNull();
    expect(screen.queryByText(/on-convention/i)).toBeNull();
    expect(screen.queryByText(/Semua project/)).toBeNull();
  });
});

describe("Overview · dengan project", () => {
  it("tanpa KPI yang mengulang kartu, jargon lama, dan 'total spec'", () => {
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[spec({ id: "SPEC-1" })]}
      sessions={[]} onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(screen.queryByText("SpecSlim di backlog")).toBeNull();
    expect(screen.queryByText("total spec")).toBeNull();
    expect(screen.queryByText("Docs on-convention")).toBeNull();
    expect(screen.queryByText(/Source of Truth/)).toBeNull();
    expect(screen.queryByText(/SpecSlim/)).toBeNull();
  });

  it("satu kartu 'Limit langganan' saat codex belum pernah melapor", () => {
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]} sessions={[]}
      onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(screen.getAllByText("Limit langganan")).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Codex" })).toBeNull();
    expect(screen.getByTestId("limit-body").textContent).toBe("limit-claude");
  });

  it("bila codex melapor, satu kartu bertab Claude/Codex", () => {
    codex.status = "ok"; codex.plan = "plus";
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]} sessions={[]}
      onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(screen.getAllByText("Limit langganan")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByTestId("limit-body").textContent).toBe("limit-codex");
    expect(screen.getByText(/tercatat · Codex · plus/)).toBeTruthy();
  });

  it("sesi hidup urut dari yang paling lama mulai; klik baris membuka sesinya", () => {
    const onOpenSession = vi.fn();
    render(<OverviewScreen
      projects={[project({ id: "a", name: "alpha" }), project({ id: "b", name: "beta" })]}
      backlog={[spec({ id: "SPEC-NEW", startedAt: "2026-10-10T08:00:00.000Z" }), spec({ id: "SPEC-OLD", startedAt: "2026-10-01T08:00:00.000Z" })]}
      sessions={[
        session({ id: "s-new", projectId: "a", specId: "SPEC-NEW" }),
        session({ id: "s-old", projectId: "b", specId: "SPEC-OLD" }),
      ]}
      onOpenProject={noop} onGoto={noop} onOpenSession={onOpenSession} />);
    const items = within(screen.getByTestId("live-list")).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("beta");
    expect(items[1]!.textContent).toContain("alpha");
    fireEvent.click(within(items[0]!).getByRole("button"));
    expect(onOpenSession).toHaveBeenCalledWith("s-old");
  });

  it("aktivitas: baris semantik, status berjalan berteks, dan klik membuka project", () => {
    const onOpenProject = vi.fn();
    const alpha = project({ id: "a", name: "alpha" });
    render(<OverviewScreen projects={[alpha, project({ id: "b", name: "beta" })]} backlog={[]}
      sessions={[session({ id: "s1", projectId: "a" })]} onOpenProject={onOpenProject} onGoto={noop} onOpenSession={noop} />);
    const rows = within(screen.getByTestId("activity-list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Berjalan");
    expect(rows[1]!.textContent).toContain("Diam");
    fireEvent.click(within(rows[0]!).getByRole("button"));
    expect(onOpenProject).toHaveBeenCalledWith(alpha);
  });
});
