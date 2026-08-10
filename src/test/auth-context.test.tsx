import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({ api: { logout: vi.fn() } }));

function Probe() {
  const { user, logout } = useAuth();
  return <button onClick={() => void logout()}>{user ? user.email : "no-user"}</button>;
}
const me = { id: "u1", email: "a@b.c", role: "admin" as const, createdAt: new Date().toISOString() };

beforeEach(() => { (api.logout as any).mockReset(); });

describe("AuthContext", () => {
  it("default aman: user null tanpa provider", () => {
    render(<Probe />);
    expect(screen.getByText("no-user")).toBeInTheDocument();
  });

  it("logout memanggil api.logout lalu onLoggedOut", async () => {
    (api.logout as any).mockResolvedValue(undefined);
    const onLoggedOut = vi.fn();
    render(<AuthProvider user={me} onLoggedOut={onLoggedOut}><Probe /></AuthProvider>);
    fireEvent.click(screen.getByText("a@b.c"));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
  });

  it("tetap membersihkan klien meski api.logout gagal", async () => {
    (api.logout as any).mockRejectedValue(new Error("net"));
    const onLoggedOut = vi.fn();
    render(<AuthProvider user={me} onLoggedOut={onLoggedOut}><Probe /></AuthProvider>);
    fireEvent.click(screen.getByText("a@b.c"));
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
  });
});
