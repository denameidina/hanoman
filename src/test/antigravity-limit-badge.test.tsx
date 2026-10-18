import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Store limits berlangganan WS lewat api/events — sumbernya di-mock supaya test bisa mendorong frame.
let push: ((m: unknown) => void) | null = null;
vi.mock("../src/api/events", () => ({
  subscribe: (cb: (m: unknown) => void) => { push = cb; return () => { push = null; }; },
}));

import { AntigravityLimitBadge } from "../src/screens/LimitIndicator";
import { _resetAntigravityLimitsStore } from "../src/api/antigravity-limits";

const dto = (over: object = {}) => ({
  status: "ok",
  fetchedAt: new Date(Date.now() - 60_000).toISOString(),
  windows: [
    { key: "antigravity:gemini-weekly", label: "Gemini · Mingguan", usedPct: 3, resetsAt: null, severity: "normal", isActive: false },
    { key: "antigravity:3p-weekly", label: "Claude/GPT · Mingguan", usedPct: 24, resetsAt: null, severity: "normal", isActive: false },
  ], ...over,
});

beforeEach(() => { push = null; _resetAntigravityLimitsStore(); });

describe("AntigravityLimitBadge (ADR-0224)", () => {
  it("agy belum terbaca (unavailable) → badge tak dirender", () => {
    const { container } = render(<AntigravityLimitBadge />);
    expect(container.textContent).toBe("");
  });

  it("ada data → badge menampilkan persen window terburuk, dengan penanda belah ketupat", () => {
    const { container } = render(<AntigravityLimitBadge />);
    act(() => { push!({ t: "antigravityLimits", limits: dto() }); });
    expect(screen.getByTitle("Limit Antigravity")).toHaveTextContent("24%");
    expect(container.querySelector(".hn-lim-dot-diamond")).not.toBeNull();
  });

  it("popover memuat window per grup model", () => {
    render(<AntigravityLimitBadge />);
    act(() => { push!({ t: "antigravityLimits", limits: dto() }); });
    fireEvent.click(screen.getByTitle("Limit Antigravity"));
    expect(screen.getByText("Gemini · Mingguan")).toBeInTheDocument();
    expect(screen.getByText("Claude/GPT · Mingguan")).toBeInTheDocument();
  });

  it("data lama ditandai `lama`", () => {
    render(<AntigravityLimitBadge />);
    act(() => { push!({ t: "antigravityLimits", limits: dto({ status: "stale" }) }); });
    expect(screen.getByTitle("Limit Antigravity")).toHaveTextContent("lama");
  });

  it("frame `codexLimits` TIDAK menggerakkan badge Antigravity (grup terpisah)", () => {
    const { container } = render(<AntigravityLimitBadge />);
    act(() => { push!({ t: "codexLimits", limits: { ...dto(), plan: null } }); });
    expect(container.textContent).toBe("");
  });
});
