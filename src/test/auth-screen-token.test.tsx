import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthScreen } from "../src/screens/AuthScreen";
import { api } from "../src/api/client";

// SPEC-884 · ADR-0139 · sebelum spec ini form mengunci tombol setiap kali `needsSetup` benar, tanpa
// pernah membaca `setupTokenRequired` yang SUDAH dikirim /auth/status — jadi walau server tak
// meminta token, akun pertama tak bisa dibuat dari UI sama sekali.
vi.mock("../src/api/client", () => ({
  api: { setup: vi.fn(async () => ({ user: { id: "u1", email: "a@b.co", role: "admin", createdAt: "" } })) },
  ApiError: class extends Error { status = 0 },
}));

beforeEach(() => vi.clearAllMocks());

const fill = () => {
  fireEvent.change(screen.getByPlaceholderText("kamu@nafanesia.id"), { target: { value: "a@b.co" } });
  fireEvent.change(screen.getAllByPlaceholderText("••••••••")[0]!, { target: { value: "password1" } });
};

describe("AuthScreen · setup token (SPEC-884)", () => {
  it("tak menampilkan field token dan bisa submit saat token tak diwajibkan", async () => {
    render(<AuthScreen needsSetup setupTokenRequired={false} onDone={() => {}} />);
    expect(screen.queryByText("Setup token")).toBeNull();
    fill();
    const btn = screen.getByRole("button", { name: /Buat akun & masuk/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(api.setup).toHaveBeenCalledWith({ email: "a@b.co", password: "password1" }));
  });

  it("tetap mewajibkan token saat server memintanya", () => {
    render(<AuthScreen needsSetup setupTokenRequired onDone={() => {}} />);
    expect(screen.getByText("Setup token")).toBeTruthy();
    fill();
    expect(screen.getByRole("button", { name: /Buat akun & masuk/ })).toBeDisabled();
  });
});
