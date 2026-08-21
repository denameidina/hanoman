import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { EventMsg, UpdateStatus } from "@hanoman/shared";

// SPEC-868 · penjaga bahwa ajakan muat ulang benar-benar TERPASANG di topbar, bukan sekadar ada
// sebagai komponen. Sengaja lewat frame WS asli (store `api/update` tak dipatok) supaya rantai
// penuh — frame → trackServerVersion → hook → badge — yang diuji.
// Topbar punya beberapa pelanggan feed (update, limits, notifikasi) — siarkan ke SEMUA, jangan
// simpan handler terakhir saja.
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

const frame = (currentVersion: string): EventMsg => ({
  t: "update",
  update: {
    currentVersion, latestVersion: currentVersion,
    registry: { status: "ok", checkedAt: null },
    updateAvailable: false, command: "", canApply: false,
  } satisfies UpdateStatus,
} as EventMsg);

describe("topbar · ajakan muat ulang (SPEC-868)", () => {
  it("server pindah versi di bawah tab yang terbuka → ajakan muncul di topbar", async () => {
    render(<Shell active="overview" title="Overview">isi</Shell>);
    await act(async () => { emit(frame("0.1.53")); });
    expect(screen.queryByRole("button", { name: /muat ulang/i })).toBeNull();

    await act(async () => { emit(frame("0.1.54")); });
    expect(screen.getByRole("button", { name: /muat ulang/i }).textContent).toContain("0.1.54");
  });
});
