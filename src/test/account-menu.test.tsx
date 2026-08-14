import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("klik akun → popover email; Keluar memanggil logout", () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    render(<Harness user={me} logout={logout} />);
    // popover tertutup: email belum tampil
    expect(screen.queryByText("dena@nafanesia.id")).toBeNull();
    fireEvent.click(screen.getByLabelText("Akun"));
    expect(screen.getByText("dena@nafanesia.id")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keluar"));
    expect(logout).toHaveBeenCalled();
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
