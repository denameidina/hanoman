import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-868 · pola sama dengan update-indicator.test.tsx: badge self-fetch lewat hook, jadi hook-nya
// yang dipatok. `reloadPage` dipisah ke modul api justru supaya bisa dipatok di sini — `location`
// milik jsdom tak bisa diganti dengan bersih.
let restartedTo: string | null = null;
const reloadSpy = vi.fn();
vi.mock("../src/api/update", async (orig) => ({
  ...(await orig<typeof import("../src/api/update")>()),
  useServerRestartedTo: () => restartedTo,
  reloadPage: () => reloadSpy(),
}));
import { ReloadBadge } from "../src/screens/UpdateIndicator";

beforeEach(() => { reloadSpy.mockReset(); restartedTo = null; });

describe("ReloadBadge (SPEC-868)", () => {
  it("tak render selama versi server masih sama dengan versi tab ini", () => {
    const { container } = render(<ReloadBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("server pindah versi → ajakan muat ulang muncul, menyebut versi barunya", () => {
    restartedTo = "0.1.54";
    render(<ReloadBadge />);
    const btn = screen.getByRole("button", { name: /muat ulang/i });
    expect(btn.textContent).toContain("0.1.54");
  });

  it("judulnya menjelaskan halaman ini masih versi lama, bukan sekadar 'muat ulang'", () => {
    restartedTo = "0.1.54";
    render(<ReloadBadge />);
    expect(screen.getByRole("button", { name: /muat ulang/i }).title).toMatch(/versi lama/i);
  });

  it("klik memuat ulang halaman", () => {
    restartedTo = "0.1.54";
    render(<ReloadBadge />);
    fireEvent.click(screen.getByRole("button", { name: /muat ulang/i }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
