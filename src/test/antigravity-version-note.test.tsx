import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
vi.mock("../src/api/client", () => ({ api: { getAntigravityVersion: vi.fn() } }));
import { api } from "../src/api/client";
import { AntigravityVersionNote } from "../src/screens/settings/fields";

describe("Antigravity version note", () => {
  it("shows safe unavailable reason and official installation/auth documentation", () => {
    render(<AntigravityVersionNote info={{ version: null, error: "Biner Antigravity tidak ditemukan." }} />);
    expect(screen.getByTestId("antigravity-version-note")).toHaveTextContent("tak terdeteksi");
    expect(screen.getByText(/Biner Antigravity tidak ditemukan/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Panduan pemasangan dan login resmi" })).toHaveAttribute("href", "https://antigravity.google/docs/cli");
    expect(screen.getByText(/Host\/lab saja/)).toHaveTextContent("sandbox belum didukung");
  });
  it("shows the detected version without installing or authenticating", () => {
    render(<AntigravityVersionNote info={{ version: "1.3.4", error: null }} />);
    expect(screen.getByTestId("antigravity-version-note")).toHaveTextContent("1.3.4");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

afterEach(() => vi.resetAllMocks());
it.each(["resolved", "rejected"])("announces the asynchronous %s version result", async (outcome) => {
  const pending = (() => { let resolve!: (v: { version: string | null; error: string | null }) => void; let reject!: (e: Error) => void; const promise = new Promise<{ version: string | null; error: string | null }>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; })();
  vi.mocked(api.getAntigravityVersion).mockReturnValue(pending.promise);
  render(<AntigravityVersionNote />);
  expect(screen.getByRole("status")).toHaveTextContent("tak terdeteksi");
  if (outcome === "resolved") pending.resolve({ version: "1.3.4", error: null }); else pending.reject(new Error("fixture"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(outcome === "resolved" ? "1.3.4" : "tidak dapat diperiksa"));
});
