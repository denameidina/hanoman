import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountMenu } from "../src/auth/AccountMenu";
import { AuthContext } from "../src/auth/AuthContext";

function Harness({ user, logout }: { user: any; logout?: () => Promise<void> }) {
  return (
    <AuthContext.Provider value={{ user, logout: logout ?? (async () => {}) }}>
      <AccountMenu />
    </AuthContext.Provider>
  );
}
const me = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };

describe("AccountMenu", () => {
  it("tak merender apa-apa tanpa user (default aman)", () => {
    const { container } = render(<AccountMenu />);
    expect(container.firstChild).toBeNull();
  });

  it("menampilkan inisial email di tombol akun", () => {
    render(<Harness user={me} />);
    expect(screen.getByLabelText("Akun")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
  });

  // Audit UI/UX 2026-10 · pointer kasar: trigger wajib ≥44×44. Kelas `hn-touch-target` yang
  // memaksanya (app.css), jadi kelasnya yang diuji — ukuran nyata hanya bisa dibuktikan di browser.
  it("trigger memakai kelas hn-touch-target untuk area sentuh 44 px", () => {
    render(<Harness user={me} />);
    expect(screen.getByLabelText("Akun")).toHaveClass("hn-touch-target");
  });

  it("klik akun → popover email; Keluar meminta konfirmasi lalu memanggil logout", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    render(<Harness user={me} logout={logout} />);
    // popover tertutup: email belum tampil
    expect(screen.queryByText("dena@nafanesia.id")).toBeNull();
    fireEvent.click(screen.getByLabelText("Akun"));
    expect(screen.getByText("dena@nafanesia.id")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keluar"));
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByText("Keluar dari hanoman?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it("Tetap masuk di dialog membatalkan keluar tanpa memanggil logout", () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    render(<Harness user={me} logout={logout} />);
    fireEvent.click(screen.getByLabelText("Akun"));
    fireEvent.click(screen.getByText("Keluar"));
    fireEvent.click(screen.getByRole("button", { name: "Tetap masuk" }));
    expect(screen.queryByText("Keluar dari hanoman?")).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

  it("memindahkan fokus ke menu lalu Escape mengembalikannya ke trigger", () => {
    render(<Harness user={me} />);
    const trigger = screen.getByLabelText("Akun");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Keluar" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
