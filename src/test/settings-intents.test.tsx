// Audit UI/UX 2026-10 · Fase 3C · struktur empat niat Pengaturan: Sesi harian (default) · Agen & model ·
// Integrasi & akses · Lanjutan (tertutup default). Kunci lama tetap dibuka, deep link `#bagian=<kunci>`
// berfungsi tanpa route baru, dan tiap bagian ada di tempat yang dijanjikan.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SETTINGS_INTENTS, SECTION_KEYS, normalizeSection, readHashSection, intentOf, sectionPath } from "../src/screens/settings/model";
import { uiKey } from "../src/ui-state";

vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), listUsers: vi.fn(), putSettings: vi.fn(),
    // Bagian Telegram (dibuka lewat deep link) memuat status & kredensialnya.
    getTelegramStatus: vi.fn().mockResolvedValue({
      configured: false, enabled: false, running: false, readiness: "belum", botUsername: null,
      allowlistCount: 0, agentTokenConfigured: false, missingCapabilities: [], lastUpdateAt: null, lastError: null,
    }),
    getTelegramCredentials: vi.fn().mockResolvedValue({ fields: [] }),
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
  vi.mocked(api.listUsers).mockResolvedValue([{ id: "u1", email: "a@b.c", createdAt: new Date().toISOString() }] as any);
  vi.mocked(api.putSettings).mockResolvedValue({} as any);
});
afterEach(() => {
  cleanup();
  history.replaceState(null, "", window.location.pathname);
});

describe("struktur niat (Fase 3C)", () => {
  it("empat niat, dengan Lanjutan sebagai niat yang bisa dilipat", () => {
    expect(SETTINGS_INTENTS.map((i) => i.key)).toEqual(["sesi", "model", "integrasi", "lanjutan"]);
    expect(SETTINGS_INTENTS.find((i) => i.key === "lanjutan")?.collapsible).toBe(true);
    expect(SETTINGS_INTENTS.filter((i) => i.collapsible)).toHaveLength(1);
  });

  it("setiap bagian hanya muncul sekali dan termasuk di salah satu niat", () => {
    expect(new Set(SECTION_KEYS).size).toBe(SECTION_KEYS.length);
    const inIntents = SETTINGS_INTENTS.flatMap((i) => i.sections.map((s) => s.key));
    expect(inIntents.sort()).toEqual([...SECTION_KEYS].sort());
    expect(SECTION_KEYS).toHaveLength(15);
  });

  it("Integrasi & akses memuat Akses AI Agent, Telegram, Webhook, Akses klien, Perangkat, Kendali jarak jauh", () => {
    const keys = SETTINGS_INTENTS.find((i) => i.key === "integrasi")!.sections.map((s) => s.key);
    expect(keys).toEqual(["agent", "telegram", "webhook", "akses-klien", "perangkat", "kendali-jarak-jauh"]);
  });

  it("Lanjutan memuat Akun, Pengguna, Setup awal, Konfigurasi, Log aktivitas, Custom agent, Zona bahaya", () => {
    const labels = SETTINGS_INTENTS.find((i) => i.key === "lanjutan")!.sections.map((s) => s.label);
    expect(labels).toEqual(["Akun", "Pengguna", "Setup awal", "Konfigurasi", "Log aktivitas", "Custom agent", "Zona bahaya"]);
  });

  it("jalur tampilan: bagian dalam niat dengan banyak bagian memakai awalan niatnya", () => {
    expect(sectionPath("telegram")).toBe("Integrasi & akses · Telegram");
    expect(sectionPath("sesi")).toBe("Sesi harian");
    expect(intentOf("zona-bahaya").key).toBe("lanjutan");
  });
});

describe("kunci lama dan deep link", () => {
  it("kunci persist lama dipetakan ke bagian baru; kunci tak dikenal jatuh ke default", () => {
    expect(normalizeSection("umum")).toBe("sesi");
    expect(normalizeSection("orkestrasi")).toBe("model");
    expect(normalizeSection("telegram")).toBe("telegram");
    expect(normalizeSection("constructor")).toBe("sesi");
    expect(normalizeSection("rusak")).toBe("sesi");
    expect(normalizeSection(42)).toBe("sesi");
  });

  it("hash #bagian=<kunci> dibaca; parameter hash lain (spec=) tak mengganggu", () => {
    expect(readHashSection("#bagian=telegram")).toBe("telegram");
    expect(readHashSection("#spec=SPEC-1&bagian=akun")).toBe("akun");
    expect(readHashSection("#bagian=tidakada")).toBeNull();
    expect(readHashSection("")).toBeNull();
  });

  it("membuka /settings#bagian=akun langsung di bagian Akun (Lanjutan ikut terbuka)", async () => {
    history.replaceState(null, "", "#bagian=akun");
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    expect(await screen.findByText("Ganti password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjutan" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Akun" })).toHaveAttribute("aria-current", "page");
  });

  it("kunci persist lama 'umum' di storage membuka Sesi harian, bukan layar kosong", async () => {
    localStorage.setItem(uiKey("settings", "tab"), JSON.stringify("umum"));
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    expect(await screen.findByText("Full-auto sebagai default")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sesi harian" })).toHaveAttribute("aria-current", "page");
  });
});

describe("navigasi empat niat", () => {
  it("default: Sesi harian aktif, dan Lanjutan tertutup", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    expect(await screen.findByText("Sesi & notifikasi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sesi harian" })).toHaveAttribute("aria-current", "page");
    const lanjutan = screen.getByRole("button", { name: "Lanjutan" });
    expect(lanjutan).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Akun" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zona bahaya" })).toBeNull();
  });

  it("Lanjutan terbuka lewat disclosure dan menampilkan ketujuh bagiannya; klik lagi menutupnya", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await screen.findByText("Sesi & notifikasi");
    fireEvent.click(screen.getByRole("button", { name: "Lanjutan" }));
    for (const label of ["Akun", "Pengguna", "Setup awal", "Konfigurasi", "Log aktivitas", "Custom agent", "Zona bahaya"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Lanjutan" }));
    expect(screen.queryByRole("button", { name: "Akun" })).toBeNull();
  });

  it("niat Integrasi & akses menampilkan enam bagiannya di bawah bagian yang sedang aktif", async () => {
    // Lewat deep link ke Telegram: niat Integrasi terbuka tanpa memuat bagian lain yang butuh API-nya.
    history.replaceState(null, "", "#bagian=telegram");
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    expect(await screen.findByText("Kredensial Telegram")).toBeInTheDocument();
    for (const label of ["Akses AI Agent", "Telegram", "Webhook", "Akses klien", "Perangkat", "Kendali jarak jauh"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Telegram" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Sesi harian" })).not.toHaveAttribute("aria-current");
  });

  it("Agen & model memuat override per fungsi dan orkestrasi tanpa tab terpisah", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await screen.findByText("Sesi & notifikasi");
    fireEvent.click(screen.getByRole("button", { name: "Agen & model" }));
    expect(await screen.findByText("Konflik rebase & merge")).toBeInTheDocument();
    expect(screen.getByText("Agen hanoman-lead")).toBeInTheDocument();
    expect(screen.getByText("Obrolan portal klien")).toBeInTheDocument();
    expect(screen.getByText(/Override per fungsi/)).toBeInTheDocument();
  });

  it("Reset ke default hanya di Lanjutan › Zona bahaya, bukan di Sesi harian", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await screen.findByText("Sesi & notifikasi");
    expect(screen.queryByRole("button", { name: "Reset ke default" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lanjutan" }));
    fireEvent.click(screen.getByRole("button", { name: "Zona bahaya" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset ke default" })).toBeEnabled());
  });
});
