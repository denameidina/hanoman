import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
  conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" }, ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.getCodexVersion).mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

// SPEC-383 · Temuan B · ADR-0081 · sesi penyelesai konflik rebase/merge punya default sendiri.
describe("SPEC-383 · kartu default sesi konflik", () => {
  it("kartu ada di tab Model sesi", async () => {
    openModel();
    expect(await screen.findByText("Konflik rebase & merge")).toBeInTheDocument();
  });

  // Opt-in: mati = warisan penuh. Kartunya HARUS menyebut nilai warisannya, kalau tidak operator
  // ditinggal bertanya "lalu sekarang konflik pakai apa?".
  it("mati → tak ada picker, nilai warisan ditampilkan", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } }) as any);
    openModel();
    const inh = await screen.findByTestId("conflict-inherited");
    expect(inh).toHaveTextContent("Codex CLI");
    expect(inh).toHaveTextContent("gpt-5.6-terra");
    expect(inh).toHaveTextContent("high");
    expect(screen.queryByLabelText("Agen konflik")).toBeNull();
  });

  it("menyalakan override → PUT settings conflict.enabled true", async () => {
    openModel();
    // Switch DS menaruh aria-label PADA elemen ber-role (sejak 9f344904) — dicari lewat peran +
    // nama aksesibelnya, bukan lewat bentuk DOM-nya.
    fireEvent.click(await screen.findByRole("switch", { name: "Override agen konflik" }));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ conflict: expect.objectContaining({ enabled: true }) })));
  });

  it("hidup → picker muncul; ganti model → PUT", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({
      conflict: { enabled: true, agent: "claude", model: "claude-opus-5", effort: "xhigh" } }) as any);
    openModel();
    const sel = await screen.findByLabelText("Model konflik");
    fireEvent.change(sel, { target: { value: "claude-haiku-4-5" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ conflict: {
        enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "xhigh" } })));
  });

  // Mengganti agen HARUS menukar model+effort sekalian — kalau tidak sesi lahir `codex -m
  // claude-opus-5` (pelajaran SPEC-338, dijaga pickAgent di StartSessionModal).
  it("ganti agen konflik ke codex → model & effort ikut pindah ke katalog codex", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({
      codex: { model: "gpt-5.6-terra", effort: "high" },
      conflict: { enabled: true, agent: "claude", model: "claude-opus-5", effort: "xhigh" } }) as any);
    openModel();
    const sel = await screen.findByLabelText("Agen konflik");
    fireEvent.change(sel, { target: { value: "codex" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ conflict: {
        enabled: true, agent: "codex", model: "gpt-5.6-terra", effort: "high" } })));
  });

  // SPEC-339 · effort adalah properti MODEL: Luna tak punya `ultra`.
  it("memilih model codex Luna saat effort ultra ikut menurunkan effort", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({
      conflict: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "ultra" } }) as any);
    openModel();
    const sel = await screen.findByLabelText("Model konflik");
    fireEvent.change(sel, { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ conflict: {
        enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" } })));
  });

  it("daftar model konflik mengikuti agen terpilih", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({
      conflict: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" } }) as any);
    openModel();
    const sel = await screen.findByLabelText("Model konflik");
    const opts = [...sel.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]);
  });

  // Respons GET /settings yang ter-cache dari sebelum SPEC-383 belum punya kunci ini — layar
  // Settings tak boleh mati total karena `undefined.enabled`.
  it("respons tanpa blok conflict tetap render (fallback default)", async () => {
    const s: any = settings();
    delete s.conflict;
    vi.mocked(api.getSettings).mockResolvedValue(s);
    openModel();
    expect(await screen.findByLabelText("Override agen konflik")).toBeInTheDocument();
    expect(screen.getByTestId("conflict-inherited")).toBeInTheDocument();
  });
});
