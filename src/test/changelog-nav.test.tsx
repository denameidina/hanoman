import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Widget topbar yang self-fetch / butuh provider → di-noop agar Shell bisa dirender terisolasi.
vi.mock("../src/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("../src/screens/LimitIndicator", () => ({ LimitBadge: () => null, CodexLimitBadge: () => null }));
vi.mock("../src/screens/UpdateIndicator", () => ({ UpdateBadge: () => null }));
vi.mock("../src/auth/AccountMenu", () => ({ AccountMenu: () => null }));

import { Shell, HN_NAV } from "../src/ds/shell";

describe("Shell nav · Changelog (SPEC-519)", () => {
  it("merender item nav Changelog dan memanggil onNavigate('changelog')", () => {
    const onNavigate = vi.fn();
    render(<Shell active="overview" title="x" onNavigate={onNavigate}><div /></Shell>);
    const item = screen.getByText("Changelog");
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onNavigate).toHaveBeenCalledWith("changelog");
  });

  // Kontrak yang menjaga kelas bug `runs`/`triggers` (SPEC-162): entri nav tanpa cabang di App
  // membuat App merender KOSONG — sidebar ikut hilang dan pengguna terjebak sampai reload.
  it("setiap key HN_NAV punya cabang section di App.tsx", () => {
    // `import.meta.url` di bawah transform Vite bukan URL ber-skema `file:`, jadi berkasnya
    // dicari dari cwd — yang berbeda antara run tingkat-paket (`src/`) dan tingkat-root.
    const candidates = [resolve(process.cwd(), "src/App.tsx"), resolve(process.cwd(), "src/src/App.tsx")];
    const appPath = candidates.find((c) => existsSync(c));
    expect(appPath, `App.tsx tak ketemu dari ${process.cwd()}`).toBeTruthy();
    const app = readFileSync(appPath!, "utf8");
    const missing = HN_NAV.map((n) => n.key).filter((k) => !app.includes(`section === "${k}"`));
    expect(missing).toEqual([]);
  });
});
