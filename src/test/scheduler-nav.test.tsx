import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Widget topbar yang self-fetch / butuh provider → di-noop agar Shell bisa dirender terisolasi.
vi.mock("../src/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("../src/screens/LimitIndicator", () => ({ LimitBadge: () => null, CodexLimitBadge: () => null, AntigravityLimitBadge: () => null }));
vi.mock("../src/screens/UpdateIndicator", () => ({ UpdateBadge: () => null, ReloadBadge: () => null }));
vi.mock("../src/auth/AccountMenu", () => ({ AccountMenu: () => null }));

import { Shell } from "../src/ds/shell";

// ADR-0205 · Scheduler tak lagi entri sidebar sendiri: ia tab di dalam hub Otonom. Klik hub
// mendarat di Scheduler (tab pertama dan default), jadi perilaku yang dijaga test ini tetap sama.
describe("Shell nav · Scheduler (SPEC-299, ADR-0205)", () => {
  it("hub Otonom memuat Scheduler dan klik hub memanggil onNavigate('scheduler')", () => {
    const onNavigate = vi.fn();
    render(<Shell active="overview" title="x" onNavigate={onNavigate}><div /></Shell>);
    const hub = screen.getByRole("button", { name: "Otonom" });
    expect(hub).toBeInTheDocument();
    fireEvent.click(hub);
    expect(onNavigate).toHaveBeenCalledWith("scheduler");
  });
});
