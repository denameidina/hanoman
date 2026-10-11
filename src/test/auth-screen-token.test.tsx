import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthScreen, authErrorMessage } from "../src/screens/AuthScreen";
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

// Respons 400 setup: pesan menyebut bidang yang benar-benar ditolak server (zod `fieldErrors`),
// tak lagi selalu "Password minimal 8 karakter" untuk setiap 400.
describe("authErrorMessage · setup 400 dibedakan dari fieldErrors", () => {
  const bad400 = (fieldErrors: Record<string, string[]>) =>
    Object.assign(new ApiError(400, "x"), { status: 400, detail: { error: { formErrors: [], fieldErrors } } });

  it("password terlalu pendek menyebut password, bukan email", () => {
    expect(authErrorMessage(bad400({ password: ["String must contain at least 8 character(s)"] }), true))
      .toBe("Password minimal 8 karakter.");
  });

  it("email tak valid menyebut format email", () => {
    expect(authErrorMessage(bad400({ email: ["Invalid email"] }), true)).toBe("Format email belum valid.");
  });

  it("dua bidang salah disebut keduanya", () => {
    expect(authErrorMessage(bad400({ email: ["Invalid email"], password: ["min 8"] }), true))
      .toBe("Format email belum valid. Password minimal 8 karakter.");
  });

  it("400 tanpa fieldErrors jatuh ke pesan generik yang jujur, tanpa menebak password", () => {
    const msg = authErrorMessage(Object.assign(new ApiError(400, "x"), { status: 400, detail: null }), true);
    expect(msg).toBe("Data akun belum valid. Periksa email dan password, lalu coba lagi.");
    expect(msg).not.toMatch(/minimal 8/);
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

// Audit UI/UX 2026-10 · Fase 3 (3N): penomoran jujur. "setup 2/2" hanya bila wizard tadi tampil
// (layar induk memberi `setupStep`); tanpa itu, layar akun tak mengklaim nomor langkah.
describe("AuthScreen · penomoran setup (Fase 3N)", () => {
  it("langkah ke-2 dari 2 bila layar induk memberi setupStep", () => {
    render(<AuthScreen needsSetup setupStep={2} onDone={() => {}} />);
    expect(screen.getByText("hanoman · setup 2/2")).toBeTruthy();
  });

  it("tanpa setupStep, tak ada nomor langkah yang diklaim", () => {
    render(<AuthScreen needsSetup onDone={() => {}} />);
    expect(screen.getByText("hanoman · setup")).toBeTruthy();
  });

  it("tombol 'Buat akun & masuk' memberi alasan saat belum lengkap", () => {
    render(<AuthScreen needsSetup setupStep={2} onDone={() => {}} />);
    expect(screen.getByRole("button", { name: /Buat akun & masuk/ })).toBeDisabled();
    expect(screen.getByText("Isi email yang valid.")).toBeTruthy();
  });
});
