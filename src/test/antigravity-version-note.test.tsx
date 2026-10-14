import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
