import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UpdateStatus } from "@hanoman/shared";

// Badge self-fetch via useUpdate(); pakai nilai tetap agar render deterministik (pola limit-indicator).
let hook: UpdateStatus;
const applySpy = vi.fn();
vi.mock("../src/api/update", async (orig) => ({
  ...(await orig<typeof import("../src/api/update")>()),
  useUpdate: () => hook,
  applyUpdate: (confirm: boolean) => applySpy(confirm),
}));
import { UpdateBadge } from "../src/screens/UpdateIndicator";

const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentVersion: "0.1.0", latestVersion: "0.1.0",
  registry: { status: "ok", checkedAt: null }, updateAvailable: false, command: "", canApply: false, ...o,
});
const avail = (o: Partial<UpdateStatus> = {}) =>
  mk({ updateAvailable: true, latestVersion: "0.2.0", command: "npm i -g hanoman@latest", ...o });

beforeEach(() => applySpy.mockReset());

describe("UpdateBadge", () => {
  it("tak render saat up-to-date", () => {
    hook = mk({});
    const { container } = render(<UpdateBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("render pill + popover + perintah npm saat versi baru terbit", () => {
    hook = avail();
    render(<UpdateBadge />);
    const btn = screen.getByTitle("Update tersedia");
    expect(btn.textContent).toContain("Update · 0.2.0");
    fireEvent.click(btn);
    expect(screen.getByText(/hanoman 0\.2\.0 tersedia/)).toBeTruthy();
    expect(screen.getByText(/npm i -g hanoman@latest/)).toBeTruthy();
    expect(screen.getByText(/terpasang 0\.1\.0 · tersedia 0\.2\.0/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Update tersedia" })).toBeInTheDocument();
  });

  // SPEC-405 · ADR-0088 · gerbang supervised-only. Tanpa supervisor, menekan tombol akan
  // mematikan instance yang tak akan pernah hidup lagi — jadi tombolnya tak boleh ADA.
  it("canApply false → tombol pasang TIDAK ada, perintah salin tetap ada", () => {
    hook = avail({ canApply: false });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    expect(screen.queryByText("Pasang & mulai ulang")).toBeNull();
    expect(screen.getByText(/npm i -g hanoman@latest/)).toBeTruthy();
  });

  it("klik pertama TIDAK pernah mengirim confirm — ia meminta jumlah sesi dulu", async () => {
    hook = avail({ canApply: true });
    applySpy.mockResolvedValueOnce({ kind: "confirm", liveSessions: 2, from: "0.1.0", to: "0.2.0" });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    fireEvent.click(screen.getByText("Pasang & mulai ulang"));
    await waitFor(() => expect(screen.getByText(/2 sesi sedang berjalan/)).toBeTruthy());
    expect(applySpy).toHaveBeenCalledWith(false);
  });

  it("klik kedua mengirim confirm lalu masuk keadaan memasang", async () => {
    hook = avail({ canApply: true });
    applySpy
      .mockResolvedValueOnce({ kind: "confirm", liveSessions: 0, from: "0.1.0", to: "0.2.0" })
      .mockResolvedValueOnce({ kind: "accepted", liveSessions: 0, from: "0.1.0", to: "0.2.0" });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    fireEvent.click(screen.getByText("Pasang & mulai ulang"));
    await waitFor(() => expect(screen.getByText("Ya, pasang")).toBeTruthy());
    fireEvent.click(screen.getByText("Ya, pasang"));
    await waitFor(() => expect(screen.getByText(/Memasang/)).toBeTruthy());
    expect(applySpy).toHaveBeenNthCalledWith(2, true);
  });

  it("Batal kembali ke keadaan awal tanpa mengirim apa pun lagi", async () => {
    hook = avail({ canApply: true });
    applySpy.mockResolvedValueOnce({ kind: "confirm", liveSessions: 1, from: "0.1.0", to: "0.2.0" });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    fireEvent.click(screen.getByText("Pasang & mulai ulang"));
    await waitFor(() => expect(screen.getByText("Batal")).toBeTruthy());
    fireEvent.click(screen.getByText("Batal"));
    expect(screen.getByText("Pasang & mulai ulang")).toBeTruthy();
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("error dari server ditampilkan apa adanya", async () => {
    hook = avail({ canApply: true });
    applySpy.mockResolvedValueOnce({ kind: "error", message: "Versi terpasang ternyata sudah terkini." });
    render(<UpdateBadge />);
    fireEvent.click(screen.getByTitle("Update tersedia"));
    fireEvent.click(screen.getByText("Pasang & mulai ulang"));
    await waitFor(() => expect(screen.getByText(/sudah terkini/)).toBeTruthy());
  });
});
