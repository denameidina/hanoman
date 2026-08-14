import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { LimitsDTO } from "@hanoman/shared";

// Badge self-fetch via useLimits(); pakai nilai tetap agar render deterministik. Helper murni
// (worstWindow/severityToken/severityTone) tetap asli.
let hookDto: LimitsDTO;
vi.mock("../src/api/limits", async (orig) => ({
  ...(await orig<typeof import("../src/api/limits")>()),
  useLimits: () => hookDto,
}));
import { LimitWindows, LimitBadge } from "../src/screens/LimitIndicator";

const dto: LimitsDTO = {
  status: "ok", fetchedAt: "2026-07-11T06:00:00Z",
  windows: [
    { key: "session", label: "Sesi 5 jam", usedPct: 19, resetsAt: "2026-07-11T09:00:00Z", severity: "normal", isActive: false },
    { key: "weekly_all", label: "Mingguan", usedPct: 40, resetsAt: "2026-07-15T00:00:00Z", severity: "warning", isActive: true },
  ],
};

describe("LimitWindows", () => {
  it("renders each window label and percent", () => {
    render(<LimitWindows dto={dto} />);
    expect(screen.getByText("Sesi 5 jam")).toBeTruthy();
    expect(screen.getByText(/Mingguan/)).toBeTruthy();
    expect(screen.getByText(/19%/)).toBeTruthy();
    expect(screen.getByText(/40%/)).toBeTruthy();
  });
  it("shows unavailable message when no windows", () => {
    render(<LimitWindows dto={{ status: "unavailable", windows: [], fetchedAt: null }} />);
    expect(screen.getByText(/tidak tersedia|idle|belum login/i)).toBeTruthy();
  });
  it("weekly window shows absolute reset date+time, session shows countdown only", () => {
    render(<LimitWindows dto={dto} />);
    // weekly_all reset 2026-07-15 → tanggal absolut (bulan Jul) tampil di samping countdown
    expect(screen.getByText(/reset.*Jul/)).toBeTruthy();
    // session (5 jam) tetap countdown saja — tanpa tanggal absolut
    expect(screen.getByText((t) => t.startsWith("reset") && !/Jul/.test(t))).toBeTruthy();
  });
});

describe("LimitBadge", () => {
  it("shows the worst window percent and opens a popover on click", () => {
    hookDto = dto;   // worst = weekly_all (warning) 40%
    render(<LimitBadge />);
    const btn = screen.getByTitle("Limit Claude");
    expect(btn.textContent).toContain("40%");
    expect(screen.queryByText("Limit Claude")).toBeNull();   // popover tertutup
    fireEvent.click(btn);
    expect(screen.getByText("Limit Claude")).toBeTruthy();    // popover terbuka
    expect(screen.getByText(/Mingguan/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Limit Claude" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Limit Claude" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Limit Claude" })).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });
  it("shows an em dash when unavailable", () => {
    hookDto = { status: "unavailable", windows: [], fetchedAt: null };
    render(<LimitBadge />);
    expect(screen.getByTitle("Limit Claude").textContent).toContain("—");
  });
});
