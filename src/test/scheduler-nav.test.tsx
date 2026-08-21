import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Widget topbar yang self-fetch / butuh provider → di-noop agar Shell bisa dirender terisolasi.
vi.mock("../src/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("../src/screens/LimitIndicator", () => ({ LimitBadge: () => null, CodexLimitBadge: () => null }));
vi.mock("../src/screens/UpdateIndicator", () => ({ UpdateBadge: () => null, ReloadBadge: () => null }));
vi.mock("../src/auth/AccountMenu", () => ({ AccountMenu: () => null }));

import { Shell } from "../src/ds/shell";

describe("Shell nav · Scheduler (SPEC-299)", () => {
  it("merender item nav Scheduler dan memanggil onNavigate('scheduler')", () => {
    const onNavigate = vi.fn();
    render(<Shell active="overview" title="x" onNavigate={onNavigate}><div /></Shell>);
    const item = screen.getByText("Scheduler");
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onNavigate).toHaveBeenCalledWith("scheduler");
  });
});
