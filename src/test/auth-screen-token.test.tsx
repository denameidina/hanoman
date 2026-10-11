import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthScreen } from "../src/screens/AuthScreen";
import { api, ApiError } from "../src/api/client";

// SPEC-884 · ADR-0139 · sebelum spec ini form mengunci tombol setiap kali `needsSetup` benar, tanpa
// pernah membaca `setupTokenRequired` yang SUDAH dikirim /auth/status — jadi walau server tak
// meminta token, akun pertama tak bisa dibuat dari UI sama sekali.
vi.mock("../src/api/client", () => ({
  api: {
    setup: vi.fn(async () => ({ user: { id: "u1", email: "a@b.co", role: "admin", createdAt: "" } })),
    login: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

beforeEach(() => vi.clearAllMocks());

const fill = () => {
  fireEvent.change(screen.getByPlaceholderText("mis. kamu@nafanesia.id"), { target: { value: "a@b.co" } });
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

describe("AuthScreen · galat dibedakan dan alasan tombol nonaktif (audit)", () => {
  const apiError = (status: number) => Object.assign(new ApiError(status, "x"), { status });
  const submitLogin = async () => {
    fireEvent.change(screen.getByPlaceholderText("mis. kamu@nafanesia.id"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Masuk" }));
  };

  it("kredensial salah (401) menyebut itu, di role=alert", async () => {
    vi.mocked(api.login).mockRejectedValueOnce(apiError(401));
    render(<AuthScreen needsSetup={false} onDone={() => {}} />);
    await submitLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("Email atau password salah.");
  });

  it("terlalu banyak percobaan (429) dibedakan dari salah password", async () => {
    vi.mocked(api.login).mockRejectedValueOnce(apiError(429));
    render(<AuthScreen needsSetup={false} onDone={() => {}} />);
    await submitLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("Terlalu banyak percobaan masuk");
  });

  it("gagal jaringan (bukan respons HTTP) disebut jaringan, bukan kredensial", async () => {
    vi.mocked(api.login).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<AuthScreen needsSetup={false} onDone={() => {}} />);
    await submitLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("Tidak bisa terhubung ke server");
  });

  it("tombol nonaktif menjelaskan alasannya", () => {
    render(<AuthScreen needsSetup={false} onDone={() => {}} />);
    expect(screen.getByRole("button", { name: "Masuk" })).toBeDisabled();
    expect(screen.getByText("Isi email yang valid.")).toBeTruthy();
  });

  it("hint setup token menyebut lokasi berkas konkret", () => {
    render(<AuthScreen needsSetup setupTokenRequired onDone={() => {}} />);
    expect(screen.getByText(/~\/\.hanoman\/setup\.token/)).toBeTruthy();
  });
});
