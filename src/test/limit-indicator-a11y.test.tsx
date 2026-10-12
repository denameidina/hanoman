import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { LimitsDTO } from "@hanoman/shared";

// Audit UI/UX 2026-10 · 1G (a11y) — pil limit: nama aksesibel memuat persen + status, severity ditulis
// sebagai kata, status "data lama" ditulis sebagai teks, dan meter punya nama + aria-valuetext.
let hookDto: LimitsDTO;
vi.mock("../src/api/limits", async (orig) => ({
  ...(await orig<typeof import("../src/api/limits")>()),
  useLimits: () => hookDto,
}));
import { LimitBadge, LimitWindows } from "../src/screens/LimitIndicator";

const dto: LimitsDTO = {
  status: "ok", fetchedAt: "2026-07-11T06:00:00Z",
  windows: [
    { key: "session", label: "Sesi 5 jam", usedPct: 19, resetsAt: "2026-07-11T09:00:00Z", severity: "normal", isActive: false },
    { key: "weekly_all", label: "Mingguan", usedPct: 40, resetsAt: "2026-07-15T00:00:00Z", severity: "warning", isActive: true },
  ],
};

describe("LimitBadge · nama aksesibel (Audit 1G)", () => {
  it("nama tombol memuat persen dan status; teks visibelnya ikut memuat keduanya", () => {
    hookDto = dto;   // worst = Mingguan 40%, peringatan
    render(<LimitBadge />);
    const btn = screen.getByRole("button", { name: "Limit Claude, 40% terpakai, peringatan" });
    expect(btn.textContent).toContain("40% · peringatan");
  });

  it("kritis ditulis sebagai kata, tidak hanya warna", () => {
    hookDto = { ...dto, windows: [{ ...dto.windows[1]!, usedPct: 97, severity: "critical" }] };
    render(<LimitBadge />);
    expect(screen.getByRole("button", { name: "Limit Claude, 97% terpakai, kritis" })).toBeTruthy();
  });

  it("status stale ditulis sebagai teks, bukan hanya redup", () => {
    hookDto = { ...dto, status: "stale" };
    render(<LimitBadge />);
    const btn = screen.getByRole("button", { name: /data lama/ });
    expect(btn.textContent).toContain("lama");
  });
});

describe("LimitWindows · meter (Audit 1G)", () => {
  it("setiap meter punya nama window dan aria-valuetext berisi persen serta status", () => {
    render(<LimitWindows dto={dto} />);
    const bar = screen.getByRole("progressbar", { name: "Mingguan" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuetext", "40% terpakai, peringatan");
  });

  it("status stale pada daftar window ditulis sebagai kalimat", () => {
    render(<LimitWindows dto={{ ...dto, status: "stale" }} />);
    expect(screen.getByText(/^Data lama · terakhir diperbarui/)).toBeTruthy();
  });
});
