import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RuntimeAccountDTO } from "@hanoman/shared";

const acc = (o: Partial<RuntimeAccountDTO>): RuntimeAccountDTO => ({
  id: "default:claude", runtime: "claude", label: "Default", builtin: true, isDefault: true, status: "aktif",
  identity: null, drift: [], createdAt: null, lastLoginAt: null, ...o,
});
const list = vi.fn();
const create = vi.fn();
const setDefault = vi.fn();
const login = vi.fn();
const check = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    listRuntimeAccounts: (...a: unknown[]) => list(...a), createRuntimeAccount: (...a: unknown[]) => create(...a),
    setDefaultRuntimeAccount: (...a: unknown[]) => setDefault(...a), loginRuntimeAccount: (...a: unknown[]) => login(...a),
    checkRuntimeAccount: (...a: unknown[]) => check(...a), renameRuntimeAccount: vi.fn(), deleteRuntimeAccount: vi.fn(),
  },
}));
vi.mock("../../api/account-limits", () => ({ useAccountLimits: () => [] }));
import { RuntimeAccounts } from "./RuntimeAccounts";

beforeEach(() => {
  list.mockResolvedValue({ sandbox: false, accounts: [
    acc({}), acc({ id: "a1b2c3d4", label: "Kantor", builtin: false, isDefault: false, status: "belum-login" }),
    acc({ id: "default:codex", runtime: "codex" }),
  ] });
  check.mockImplementation(async (id: string) => acc({ id, label: "Kantor", builtin: false, isDefault: false, status: "belum-login" }));
  create.mockReset(); setDefault.mockReset(); login.mockReset();
});

describe("RuntimeAccounts", () => {
  it("menampilkan akun per runtime dengan status, dan memeriksa ulang akun yang belum login", async () => {
    render(<RuntimeAccounts />);
    expect(await screen.findByText("Kantor")).toBeTruthy();
    expect(screen.getByText("belum login")).toBeTruthy();
    await waitFor(() => expect(check).toHaveBeenCalledWith("a1b2c3d4"));
  });

  it("radio default memanggil setDefaultRuntimeAccount", async () => {
    setDefault.mockResolvedValue({ sandbox: false, accounts: [] });
    render(<RuntimeAccounts />);
    fireEvent.click(await screen.findByRole("radio", { name: /Kantor/ }));
    await waitFor(() => expect(setDefault).toHaveBeenCalledWith("claude", "a1b2c3d4"));
  });

  it("Login membuka sesi terminal login", async () => {
    login.mockResolvedValue({ id: "acct-login-a1b2c3d4" });
    const onToast = vi.fn();
    render(<RuntimeAccounts onToast={onToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "Login Kantor" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a1b2c3d4", {}));
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("Terminal"), "ok", "terminal");
  });

  it("email sama di runtime yang sama → peringatan duplikat", async () => {
    list.mockResolvedValue({ sandbox: false, accounts: [
      acc({ identity: { email: "dena@x.id" } }),
      acc({ id: "a1b2c3d4", label: "Kantor", builtin: false, isDefault: false, identity: { email: "dena@x.id" } }),
    ] });
    render(<RuntimeAccounts />);
    expect(await screen.findByText(/Email sama dengan akun "Default"/)).toBeTruthy();
  });

  it("Tambah akun mengirim runtime + label", async () => {
    create.mockResolvedValue(acc({ id: "ffffffff", label: "Cadangan", builtin: false }));
    render(<RuntimeAccounts />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Tambah akun/ }))[0]!);
    fireEvent.change(screen.getByLabelText("Label akun"), { target: { value: "Cadangan" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan akun" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ runtime: "claude", label: "Cadangan" }));
  });
});
