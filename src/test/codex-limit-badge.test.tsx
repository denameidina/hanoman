import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Store limits berlangganan WS lewat api/events — sumbernya di-mock supaya test bisa mendorong frame.
let push: ((m: unknown) => void) | null = null;
// ADR-0234 · badge juga membaca store akun runtime; di sini tak ada akun terdaftar (perilaku lama).
vi.mock("../src/api/account-limits", () => ({ useAccountLimits: () => [] }));
vi.mock("../src/api/events", () => ({
  subscribe: (cb: (m: unknown) => void) => { push = cb; return () => { push = null; }; },
}));

import { CodexLimitBadge } from "../src/screens/LimitIndicator";
import { _resetCodexLimitsStore } from "../src/api/codex-limits";

const dto = (over: object = {}) => ({
  status: "ok", plan: "pro",
  fetchedAt: new Date(Date.now() - 120_000).toISOString(),
  windows: [
    { key: "codex:primary:300", label: "Sesi 5 jam", usedPct: 10, resetsAt: null, severity: "normal", isActive: false },
    { key: "codex:secondary:10080", label: "Mingguan", usedPct: 62, resetsAt: null, severity: "normal", isActive: false },
  ], ...over,
});

// Store adalah singleton modul (pola api/limits.ts) — tanpa reset, state kasus sebelumnya bocor.
beforeEach(() => { push = null; _resetCodexLimitsStore(); });

describe("CodexLimitBadge (SPEC-338)", () => {
  it("belum pernah pakai codex (unavailable) → badge tak dirender sama sekali", () => {
    const { container } = render(<CodexLimitBadge />);
    // Store lahir "unavailable"; badge codex tak boleh jadi noise permanen di top bar.
    expect(container.textContent).toBe("");
  });

  it("ada snapshot → badge tampil dengan persen window terburuk", () => {
    render(<CodexLimitBadge />);
    act(() => { push!({ t: "codexLimits", limits: dto() }); });
    expect(screen.getByTitle("Limit Codex")).toHaveTextContent("62%");
  });

  it("popover memuat kedua window + plan", () => {
    render(<CodexLimitBadge />);
    act(() => { push!({ t: "codexLimits", limits: dto() }); });
    fireEvent.click(screen.getByTitle("Limit Codex"));
    expect(screen.getByText("Sesi 5 jam")).toBeInTheDocument();
    expect(screen.getByText("Mingguan")).toBeInTheDocument();
    expect(screen.getByText(/pro/)).toBeInTheDocument();
  });

  it("frame `limits` claude TIDAK menggerakkan badge codex (grup terpisah)", () => {
    const { container } = render(<CodexLimitBadge />);
    act(() => { push!({ t: "limits", limits: { status: "ok", windows: dto().windows, fetchedAt: null } }); });
    expect(container.textContent).toBe("");
  });

  it("severity critical mewarnai badge", () => {
    render(<CodexLimitBadge />);
    act(() => {
      push!({ t: "codexLimits", limits: dto({ windows: [
        { key: "codex:primary:300", label: "Sesi 5 jam", usedPct: 95, resetsAt: null, severity: "critical", isActive: true },
      ] }) });
    });
    const b = screen.getByTitle("Limit Codex");
    expect(b).toHaveTextContent("95%");
    expect(b.getAttribute("style")).toContain("--status-err");
  });
});
