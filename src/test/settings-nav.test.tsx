import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

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
  (api.getSettings as any).mockResolvedValue({ model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true, notifyDone: true, notifySound: "short", goal: { enabled: false, condition: "" } });   // SPEC-332 · blok goal selalu ada (zod default)
  (api.listUsers as any).mockResolvedValue([{ id: "u1", email: "a@b.c", createdAt: new Date().toISOString() }]);
  (api.putSettings as any).mockResolvedValue({});
});

const me = { id: "u1", email: "a@b.c" } as any;

describe("SettingsScreen sidebar", () => {
  it("mulai di Akun (form ganti password) lalu pindah tab lewat sidebar", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    // default tab = Akun
    expect(await screen.findByText("Ganti password")).toBeInTheDocument();
    // pindah ke Model sesi → kartu model muncul, form password hilang
    fireEvent.click(screen.getByText("Model sesi"));
    await waitFor(() => expect(screen.queryByText("Ganti password")).toBeNull());
    // SPEC-383 · tab ini kini punya baris "Effort" untuk claude MAUPUN codex (dua grup berlabel
    // agen), jadi identifikasi lewat label yang memang unik — bukan judul barisnya.
    expect(screen.getByLabelText("Effort claude")).toBeInTheDocument();
    // pindah ke Umum → toggle full-auto
    fireEvent.click(screen.getByText("Umum"));
    expect(await screen.findByText("Full-auto sebagai default")).toBeInTheDocument();
    expect(screen.getByText("Reset ke default")).toBeInTheDocument();
  });

  it("tab Sesi mem-PUT notifyDone saat toggle (SPEC-180)", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByText("Sesi"));
    expect(await screen.findByText("Notifikasi backlog selesai")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("switch")[0]!); // toggle pertama = notifyDone
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    const arg = (api.putSettings as any).mock.calls.at(-1)[0];
    expect(arg).toHaveProperty("notifyDone", false);
  });
});
