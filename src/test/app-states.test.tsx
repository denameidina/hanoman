import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

let failNext = true;
const projects = vi.fn(async () => {
  if (failNext) throw new Error("boom");
  return { items: [], total: 0, page: 1, pageSize: 20 };
});
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    // SPEC-884 · App memuat status setup begitu auth diketahui; mock `api` parsial tanpa ini
    // melempar di efek dan terbaca seperti App-nya yang rusak (jebakan yang sama SPEC-739/786).
    setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
      hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
    listProjects: (...a: unknown[]) => projects(...(a as [])),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })), listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })), // SPEC-180 · provider poll
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

// Toast galat juga ber-role=alert (Fase 2B); tes ini menilai alert inline (state block) saja.
const inlineAlerts = () => screen.queryAllByRole("alert").filter((el) => !el.closest("[data-hn-toast-host]"));

describe("app load states", () => {
  it("shows the error state on a failed fetch, then the empty state after retry", async () => {
    render(<App />);
    const retry = await screen.findByText("Coba lagi");
    expect(inlineAlerts()).toHaveLength(1);
    expect(screen.getByTestId("illustration-PST-006")).toBeInTheDocument();

    failNext = false;
    retry.click();
    // Overview tanpa project: kartu onboarding "Selamat datang" dengan ajakan "Buat project pertama"
    // (audit UI/UX 2026-10). Menggantikan empty state lama yang berderet "Belum ada project".
    await waitFor(() => expect(screen.getByRole("button", { name: "Buat project pertama" })).toBeInTheDocument());
    expect(screen.getByText("Selamat datang di hanoman")).toBeInTheDocument();
    expect(inlineAlerts()).toHaveLength(0);
    expect(screen.getByTestId("illustration-PST-001")).toBeInTheDocument();
  });
});
