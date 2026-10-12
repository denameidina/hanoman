// Audit UI/UX 2026-10 · Fase 3C · "Cari pengaturan": filter baris & kartu berdasar judul+penjelasan,
// daftar bagian yang cocok lintas niat, dan pesan "tak ada yang cocok". Dua lapis diuji: fungsi filter
// murni di atas DOM, lalu integrasinya di SettingsScreen.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { applySettingsFilter, searchSections } from "../src/screens/settings/SettingsSearch";

vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), listUsers: vi.fn(), putSettings: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me = { id: "u1", email: "a@b.c" } as any;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.getSettings).mockResolvedValue({
    model: "sonnet", effort: "medium", autoDefault: true, autoScaffold: true, notifyFail: true,
    notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
    goal: { enabled: false, condition: "" },
  } as any);
  vi.mocked(api.listUsers).mockResolvedValue([]);
  vi.mocked(api.putSettings).mockResolvedValue({} as any);
});
afterEach(() => { history.replaceState(null, "", window.location.pathname); });

/** Kerangka DOM kecil yang berbentuk seperti Pengaturan: kartu → baris, plus baris tanpa kartu. */
function fixture() {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-setting-card data-search="sesi & notifikasi sesi">
      <div data-setting-row data-search="Notifikasi backlog selesai toast"></div>
      <div data-setting-row data-search="Sound notifikasi durasi nada"></div>
    </div>
    <div data-setting-card data-search="akun password logout">
      <div data-setting-row data-search="Masuk sebagai email"></div>
    </div>
    <div data-setting-card data-search="setup awal peruntukan">
    </div>
    <div data-setting-row data-search="Baris tanpa kartu catatan"></div>`;
  document.body.appendChild(root);
  return root;
}

describe("applySettingsFilter · fungsi murni di atas DOM", () => {
  it("kueri kosong menampilkan semuanya dan menghitung baris serta kartu tanpa-baris", () => {
    const root = fixture();
    const count = applySettingsFilter(root, "");
    expect(root.querySelectorAll("[hidden]")).toHaveLength(0);
    // 4 baris + 1 kartu tanpa baris (setup)
    expect(count).toBe(5);
    root.remove();
  });

  it("baris yang judul/penjelasannya cocok tampil; kartunya ikut tampil bila ada baris yang cocok", () => {
    const root = fixture();
    const count = applySettingsFilter(root, "sound");
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-setting-row]"));
    expect(rows[0]!.hidden).toBe(true);            // Notifikasi backlog selesai
    expect(rows[1]!.hidden).toBe(false);           // Sound notifikasi
    expect(rows[2]!.hidden).toBe(true);            // Masuk sebagai
    expect((root.querySelectorAll("[data-setting-card]")[0] as HTMLElement).hidden).toBe(false);
    expect((root.querySelectorAll("[data-setting-card]")[1] as HTMLElement).hidden).toBe(true);
    expect(count).toBe(1);
    root.remove();
  });

  it("judul kartu yang cocok menampilkan seluruh barisnya, walau baris itu sendiri tak memuat kueri", () => {
    const root = fixture();
    applySettingsFilter(root, "password");
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-setting-row]"));
    expect(rows[2]!.hidden).toBe(false);           // Masuk sebagai ikut tampil karena kartu "akun password logout"
    expect(rows[0]!.hidden).toBe(true);
    root.remove();
  });

  it("kartu tanpa baris ikut tersaring berdasar atributnya sendiri", () => {
    const root = fixture();
    applySettingsFilter(root, "peruntukan");
    expect((root.querySelectorAll("[data-setting-card]")[2] as HTMLElement).hidden).toBe(false);
    expect((root.querySelectorAll("[data-setting-card]")[0] as HTMLElement).hidden).toBe(true);
    root.remove();
  });

  it("baris di luar kartu diuji dengan atributnya sendiri, dan kueri tanpa cocok mengembalikan nol", () => {
    const root = fixture();
    expect(applySettingsFilter(root, "catatan")).toBe(1);
    expect(applySettingsFilter(root, "tidakadayangcocok")).toBe(0);
    expect(root.querySelectorAll("[data-setting-row]:not([hidden])")).toHaveLength(0);
    root.remove();
  });

  it("kueri dibandingkan tanpa memedulikan huruf besar-kecil", () => {
    const root = fixture();
    applySettingsFilter(root, "BACKLOG");
    expect((root.querySelector("[data-setting-row]") as HTMLElement).hidden).toBe(false);
    root.remove();
  });
});

describe("searchSections · daftar bagian lintas niat", () => {
  it("kueri kosong tak menghasilkan daftar", () => {
    expect(searchSections("   ")).toEqual([]);
  });

  it("'telegram' menemukan bagian Telegram dengan jalur niatnya", () => {
    expect(searchSections("telegram")).toEqual([
      { key: "telegram", path: "Integrasi & akses · Telegram" },
    ]);
  });

  it("kata kunci (bukan hanya label) ikut dicari", () => {
    const keys = searchSections("sinkron").map((h) => h.key);
    expect(keys).toContain("perangkat");
  });
});

describe("SettingsScreen · Cari pengaturan", () => {
  it("mengetik kueri menyembunyikan baris yang tak cocok di bagian aktif", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await screen.findByText("Notifikasi backlog selesai");
    fireEvent.change(screen.getByRole("searchbox", { name: "Cari pengaturan" }), { target: { value: "notifikasi" } });
    // Judul kartu "Sesi & notifikasi" cocok → kartu & semua barisnya tampil.
    await waitFor(() => expect(screen.getByText("Notifikasi backlog selesai").closest("[data-setting-row]")).toBeVisible());
    // Kartu "Perilaku sesi" tak memuat kata "notifikasi" → tersembunyi.
    expect(screen.getByText("Full-auto sebagai default").closest("[data-setting-card]")).not.toBeVisible();
  });

  it("kueri yang tak cocok di bagian ini menampilkan pesan dan tautan bagian yang cocok", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await screen.findByText("Notifikasi backlog selesai");
    fireEvent.change(screen.getByRole("searchbox", { name: "Cari pengaturan" }), { target: { value: "telegram" } });
    expect(await screen.findByText(/Tak ada pengaturan di bagian ini yang cocok dengan “telegram”/)).toBeInTheDocument();
    // Bagian yang cocok lintas niat ditawarkan sebagai tautan.
    expect(screen.getByRole("button", { name: "Integrasi & akses · Telegram" })).toBeInTheDocument();
  });

  it("memilih bagian dari hasil pencarian berpindah ke bagian itu", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await screen.findByText("Notifikasi backlog selesai");
    fireEvent.change(screen.getByRole("searchbox", { name: "Cari pengaturan" }), { target: { value: "zona" } });
    fireEvent.click(await screen.findByRole("button", { name: "Lanjutan · Zona bahaya" }));
    expect(await screen.findByRole("button", { name: "Reset ke default" })).toBeInTheDocument();
  });

  it("Escape di kotak cari mengosongkan kueri", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await screen.findByText("Notifikasi backlog selesai");
    const box = screen.getByRole("searchbox", { name: "Cari pengaturan" });
    fireEvent.change(box, { target: { value: "xyz" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveValue("");
    expect(screen.queryByText(/Tak ada pengaturan di bagian ini/)).toBeNull();
  });
});
