import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AccountLimitsDTO } from "@hanoman/shared";
import { AccountField } from "./AccountField";
import { accountMarker, accountOptionLabel, defaultAccountId } from "./session-runtime";
import { resetPassed } from "../lib/limit-reset";

const win = (pct: number, resetsAt: string | null = null) =>
  ({ key: "session", label: "Sesi 5 jam", usedPct: pct, resetsAt, severity: "normal" as const, isActive: false });
const a = (o: Partial<AccountLimitsDTO>): AccountLimitsDTO => ({
  accountId: "default:claude", runtime: "claude", label: "Default", builtin: true, isDefault: true, loginStatus: "aktif",
  limits: { status: "ok", windows: [win(10)], fetchedAt: null }, ...o,
});
const two = [a({}), a({ accountId: "a1b2c3d4", label: "Kantor", builtin: false, isDefault: false, limits: { status: "ok", windows: [win(93)], fetchedAt: null } })];

describe("logika akun", () => {
  it("marker ⚠ ≥70, ‼ ≥90", () => {
    expect(accountMarker(69)).toBe(""); expect(accountMarker(70)).toBe(" ⚠"); expect(accountMarker(90)).toBe(" ‼");
  });
  it("label opsi memuat persen terburuk + marker; belum login ditandai", () => {
    expect(accountOptionLabel(two[1]!)).toBe("Kantor · 93% ‼");
    expect(accountOptionLabel(a({ label: "X", loginStatus: "belum-login", limits: { status: "unavailable", windows: [], fetchedAt: null } }))).toBe("X · belum login");
  });
  it("window stale yang resetnya lewat dianggap 0%", () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    expect(resetPassed(win(99, old), "stale")).toBe(true);
    expect(resetPassed(win(99, old), "ok")).toBe(false);
    expect(accountOptionLabel(a({ label: "Y", limits: { status: "stale", windows: [win(99, old)], fetchedAt: null } }))).toBe("Y · sudah reset");
  });
  it("default = isDefault, lalu bawaan", () => {
    expect(defaultAccountId(two, "claude")).toBe("default:claude");
    expect(defaultAccountId([], "codex")).toBe("default:codex");
  });
});

describe("<AccountField>", () => {
  it("tersembunyi bila runtime punya < 2 akun", () => {
    const { container } = render(<AccountField agent="claude" accounts={[a({})]} value="default:claude" onChange={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("tampil dengan ≥2 akun; akun belum login nonaktif; memilih memanggil onChange", () => {
    const onChange = vi.fn();
    const list = [...two, a({ accountId: "ffffffff", label: "Baru", builtin: false, isDefault: false, loginStatus: "belum-login" })];
    render(<AccountField agent="claude" accounts={list} value="default:claude" onChange={onChange} />);
    const sel = screen.getByLabelText("Akun") as HTMLSelectElement;
    expect([...sel.options].find((o) => o.value === "ffffffff")!.disabled).toBe(true);
    fireEvent.change(sel, { target: { value: "a1b2c3d4" } });
    expect(onChange).toHaveBeenCalledWith("a1b2c3d4");
  });
});
