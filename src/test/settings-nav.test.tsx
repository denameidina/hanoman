import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";
import { mockViewport, resetViewport } from "./viewport";

vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), listUsers: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

beforeEach(() => {
  localStorage.clear();
  (api.getSettings as any).mockResolvedValue({ model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true, notifyDone: true, notifySound: "short", goal: { enabled: false, condition: "" } });   // SPEC-332 · blok goal selalu ada (zod default)
  (api.listUsers as any).mockResolvedValue([{ id: "u1", email: "a@b.c", createdAt: new Date().toISOString() }]);
  (api.putSettings as any).mockResolvedValue({});
});
afterEach(resetViewport);

const me = { id: "u1", email: "a@b.c" } as any;

describe("SettingsScreen sidebar", () => {
  it("offers every settings section through a mobile picker without changing persisted tab state", async () => {
    mockViewport(390);
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    const picker = await screen.findByRole("combobox", { name: "Bagian pengaturan" });
    expect(Array.from((picker as HTMLSelectElement).options).map((option) => option.text))
      .toEqual(expect.arrayContaining([
        "Lanjutan · Akun", "Lanjutan · Pengguna", "Integrasi & akses · Akses klien",
        "Lanjutan · Konfigurasi", "Integrasi & akses · Webhook", "Agen & model", "Sesi harian",
      ]));
    fireEvent.change(picker, { target: { value: "model" } });
    // Override per fungsi (Konflik, Lead, obrolan portal) kini di Agen & model.
    expect(await screen.findByText("Konflik rebase & merge")).toBeInTheDocument();
    expect(document.querySelector(".hn-settings-layout")).toHaveAttribute("data-layout", "mobile");
    expect(JSON.parse(localStorage.getItem("hn.ui.v1.settings.tab")!)).toBe("model");
  });
  it("uses the compact settings rail at the tablet breakpoint", async () => {
    mockViewport(768);
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await screen.findByText("Sesi & notifikasi");
    // Kolom rel ditentukan CSS (settings.css) lewat data-layout; jsdom tak memuat stylesheet.
    expect(document.querySelector(".hn-settings-layout")).toHaveAttribute("data-layout", "tablet");
  });
  it("mulai di Sesi harian, lalu pindah ke Akun (Lanjutan) dan niat lain lewat navigasi", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    // default = Sesi harian; Akun (form ganti password) bukan layar awal, dan Lanjutan tertutup.
    expect(await screen.findByText("Sesi & notifikasi")).toBeInTheDocument();
    expect(screen.queryByText("Ganti password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Akun" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lanjutan" }));
    fireEvent.click(screen.getByRole("button", { name: "Akun" }));
    expect(await screen.findByText("Ganti password")).toBeInTheDocument();
    // pindah ke Agen & model → override muncul, form password hilang
    fireEvent.click(screen.getByRole("button", { name: "Agen & model" }));
    await waitFor(() => expect(screen.queryByText("Ganti password")).toBeNull());
    expect(await screen.findByText("Konflik rebase & merge")).toBeInTheDocument();
    // kembali ke Sesi harian → toggle full-auto ada di sana, dan reset ada di Zona bahaya
    fireEvent.click(screen.getByRole("button", { name: "Sesi harian" }));
    expect(await screen.findByText("Full-auto sebagai default")).toBeInTheDocument();
    // Lanjutan sudah terbuka sejak kunjungan ke Akun (disclosure tetap terbuka sampai ditutup).
    fireEvent.click(screen.getByRole("button", { name: "Zona bahaya" }));
    expect(await screen.findByRole("button", { name: "Reset ke default" })).toBeInTheDocument();
  });

  it("tab Sesi mem-PUT notifyDone saat toggle (SPEC-180)", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sesi harian" }));
    expect(await screen.findByText("Notifikasi backlog selesai")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("switch")[0]!); // toggle pertama = notifyDone
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    const arg = (api.putSettings as any).mock.calls.at(-1)[0];
    expect(arg).toHaveProperty("notifyDone", false);
  });
});
