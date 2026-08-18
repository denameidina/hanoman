import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientAccessPanel } from "../src/screens/ClientAccessPanel";

vi.mock("../src/api/client", () => ({
  api: {
    listClientAccounts: vi.fn(), createClientAccount: vi.fn(),
    updateClientAccount: vi.fn(), deleteClientAccount: vi.fn(), listProjects: vi.fn(),
  },
}));
import { api } from "../src/api/client";

const ACCOUNT = { id: "u1", email: "klien@x.co", disabled: false, createdAt: "2026-08-01T00:00:00Z", projects: ["p1"] };
// Kontrol DS menaruh aria-label PADA elemen ber-role (sejak 9f344904), jadi peran + nama
// aksesibelnya yang dicari — bukan bentuk DOM-nya.
const pick = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name }));

beforeEach(() => {
  (api.listClientAccounts as any).mockResolvedValue({ items: [ACCOUNT] });
  (api.listProjects as any).mockResolvedValue({ items: [
    { id: "p1", name: "Toko Mekar" }, { id: "p2", name: "Warung Sedap" }] });
  (api.createClientAccount as any).mockResolvedValue({ ...ACCOUNT, id: "u2", email: "baru@x.co", projects: ["p2"] });
  (api.updateClientAccount as any).mockResolvedValue({ ...ACCOUNT, disabled: true });
  (api.deleteClientAccount as any).mockResolvedValue(undefined);
});

describe("ClientAccessPanel (SPEC-617)", () => {
  // Yang harus terbaca bukan sekadar "nama project muncul di layar" (ia muncul juga di form
  // buat-akun), melainkan project mana yang SUDAH diberikan ke akun ini.
  it("menampilkan akun klien beserta project yang boleh ia lihat", async () => {
    render(<ClientAccessPanel />);
    expect(await screen.findByText("klien@x.co")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "klien@x.co · Toko Mekar" })
        .getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByRole("checkbox", { name: "klien@x.co · Warung Sedap" })
      .getAttribute("aria-checked")).toBe("false");
  });

  it("membuat akun klien dengan project terpilih", async () => {
    render(<ClientAccessPanel />);
    await screen.findByText("klien@x.co");
    fireEvent.change(screen.getByLabelText("Email klien"), { target: { value: "baru@x.co" } });
    fireEvent.change(screen.getByLabelText("Password awal"), { target: { value: "password9" } });
    pick("Beri akses Warung Sedap");
    fireEvent.click(screen.getByRole("button", { name: /buat akun/i }));
    await waitFor(() => expect(api.createClientAccount).toHaveBeenCalledWith(
      { email: "baru@x.co", password: "password9", projects: ["p2"] }));
  });

  it("menonaktifkan akun", async () => {
    render(<ClientAccessPanel />);
    await screen.findByText("klien@x.co");
    fireEvent.click(screen.getByRole("button", { name: /nonaktifkan/i }));
    await waitFor(() => expect(api.updateClientAccount).toHaveBeenCalledWith("u1", { disabled: true }));
  });

  it("mengubah project yang boleh dilihat akun yang sudah ada", async () => {
    render(<ClientAccessPanel />);
    await screen.findByText("klien@x.co");
    pick("klien@x.co · Warung Sedap");
    await waitFor(() => expect(api.updateClientAccount).toHaveBeenCalledWith("u1", { projects: ["p1", "p2"] }));
  });

  it("menghapus akun", async () => {
    render(<ClientAccessPanel />);
    await screen.findByText("klien@x.co");
    fireEvent.click(screen.getByRole("button", { name: /hapus/i }));
    await waitFor(() => expect(api.deleteClientAccount).toHaveBeenCalledWith("u1"));
  });

  it("belum ada akun → keadaan kosong", async () => {
    (api.listClientAccounts as any).mockResolvedValue({ items: [] });
    render(<ClientAccessPanel />);
    expect(await screen.findByText(/belum ada akun klien/i)).toBeTruthy();
  });
});
