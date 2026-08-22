import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const { logout } = vi.hoisted(() => ({ logout: vi.fn(async () => {}) }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    // SPEC-884 · App memuat status setup begitu auth diketahui; mock `api` parsial tanpa ini
    // melempar di efek dan terbaca seperti App-nya yang rusak (jebakan yang sama SPEC-739/786).
    setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
      hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
    listProjects: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    logout,
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

describe("logout dari topbar", () => {
  it("tombol Akun → Keluar memanggil api.logout dan kembali ke Login", async () => {
    render(<App />);
    // sudah login: menu Akun muncul di topbar
    const acct = await screen.findByLabelText("Akun");
    fireEvent.click(acct);
    expect(screen.getByText("a@b.co")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keluar"));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    // kembali ke AuthScreen: field email login (placeholder unik) muncul, menu Akun hilang
    await waitFor(() => expect(screen.getByPlaceholderText("kamu@nafanesia.id")).toBeInTheDocument());
    expect(screen.queryByLabelText("Akun")).toBeNull();
  });
});
