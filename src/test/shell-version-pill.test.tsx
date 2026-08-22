import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import type { EventMsg, UpdateStatus } from "@hanoman/shared";

// SPEC-906 · penjaga bahwa versi terpasang benar-benar TERBACA di topbar saat tak ada update —
// keadaan yang dulu berarti topbar kosong. Sengaja lewat frame WS asli (store `api/update` tak
// dipatok) supaya rantai penuh — frame → useUpdate → pil → popover — yang diuji, pola
// shell-reload-badge.
const handlers = new Set<(m: EventMsg) => void>();
const emit = (m: EventMsg) => { for (const h of handlers) h(m); };
vi.mock("../src/api/events", () => ({
  subscribe: (h: (m: EventMsg) => void) => { handlers.add(h); return () => handlers.delete(h); },
}));
vi.mock("../src/api/client", async (orig) => ({
  ...(await orig<typeof import("../src/api/client")>()),
  api: {
    listNotifications: vi.fn().mockResolvedValue({ items: [], unread: 0 }),
    getLimits: vi.fn().mockResolvedValue(null),
    getCodexLimits: vi.fn().mockResolvedValue(null),
    getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
  },
}));
import { Shell } from "../src/ds";

const frame = (u: Partial<UpdateStatus>): EventMsg => ({
  t: "update",
  update: {
    currentVersion: "0.1.56", latestVersion: "0.1.56",
    registry: { status: "ok", checkedAt: "2026-08-22T03:00:00.000Z" },
    updateAvailable: false, command: "", canApply: false, ...u,
  } satisfies UpdateStatus,
} as EventMsg);

describe("topbar · versi terpasang (SPEC-906)", () => {
  it("instance sudah terkini → pil versi mengikuti currentVersion, klik menyebut terpasang & tersedia", async () => {
    render(<Shell active="overview" title="Overview">isi</Shell>);
    await act(async () => { emit(frame({})); });

    const pill = screen.getByRole("button", { name: /versi terpasang/i });
    expect(pill.textContent).toContain("v0.1.56");
    fireEvent.click(pill);
    expect(screen.getByText(/terpasang 0\.1\.56 · tersedia 0\.1\.56/)).toBeTruthy();
    expect(screen.getByText(/Registry npm diperiksa/)).toBeTruthy();
  });

  it("update terbit → pil yang sama berganti wajah jadi 'Update · x.y.z'", async () => {
    render(<Shell active="overview" title="Overview">isi</Shell>);
    await act(async () => {
      emit(frame({ latestVersion: "0.2.0", updateAvailable: true, command: "npm i -g hanoman@latest" }));
    });

    expect(screen.queryByRole("button", { name: /versi terpasang/i })).toBeNull();
    expect(screen.getByRole("button", { name: /update tersedia/i }).textContent).toContain("Update · 0.2.0");
  });
});
