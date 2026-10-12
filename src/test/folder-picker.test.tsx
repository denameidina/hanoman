import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Audit UI/UX 2026-10 (P0): FolderPicker memilih hanya path yang BENAR-BENAR dimuat server.
vi.mock("../src/api/client", () => ({
  api: { browseFs: vi.fn() },
  ApiError: class extends Error {},
}));
import { FolderPicker } from "../src/screens/FolderPicker";
import { api } from "../src/api/client";

const listing = (path: string) => ({
  path, parent: path === "/" ? null : "/home",
  entries: [{ name: "kirana", path: `${path}/kirana` }],
});

beforeEach(() => {
  vi.mocked(api.browseFs).mockReset();
  vi.mocked(api.browseFs).mockImplementation((async (p?: string) => listing(p ?? "/home/dena")) as never);
});

describe("FolderPicker (audit 2026-10)", () => {
  it("baris folder adalah <button> native sehingga bisa difokus dan diaktifkan dengan keyboard", async () => {
    render(<FolderPicker open onClose={() => {}} onPick={() => {}} />);
    const row = await screen.findByRole("button", { name: "kirana" });
    expect(row.tagName).toBe("BUTTON");
    row.focus();
    expect(row).toHaveFocus();
  });

  it("klik folder memuat isinya dan kolom path mengikuti path yang dimuat", async () => {
    render(<FolderPicker open onClose={() => {}} onPick={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "kirana" }));
    await waitFor(() => expect(api.browseFs).toHaveBeenCalledWith("/home/dena/kirana"));
    expect((screen.getByLabelText("Path folder") as HTMLInputElement).value).toBe("/home/dena/kirana");
  });

  it("Pilih folder ini nonaktif sampai path yang diketik berhasil dimuat (Buka)", async () => {
    const onPick = vi.fn();
    render(<FolderPicker open onClose={() => {}} onPick={onPick} />);
    const pick = await screen.findByRole("button", { name: "Pilih folder ini" });
    await waitFor(() => expect(pick).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Path folder"), { target: { value: "/tmp/ketikan" } });
    expect(pick).toBeDisabled();   // belum divalidasi: tak boleh bisa dipilih
    fireEvent.click(pick);
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Buka" }));
    await waitFor(() => expect(pick).toBeEnabled());
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledWith("/tmp/ketikan");
  });

  it("Enter pada kolom path memuat path-nya, dan path yang gagal tak bisa dipilih", async () => {
    render(<FolderPicker open onClose={() => {}} onPick={() => {}} />);
    const pick = await screen.findByRole("button", { name: "Pilih folder ini" });
    await waitFor(() => expect(pick).toBeEnabled());

    vi.mocked(api.browseFs).mockRejectedValueOnce(new Error("GET /fs/browse → 400"));
    const input = screen.getByLabelText("Path folder");
    fireEvent.change(input, { target: { value: "/nope" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/Tak bisa membuka folder ini: GET \/fs\/browse → 400/)).toBeInTheDocument();
    expect(pick).toBeDisabled();
  });
});
