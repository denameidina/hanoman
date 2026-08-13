import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// SPEC-492 · runtime/model/effort KHUSUS sesi operator Telegram. Sebelum ini sesi operator selalu
// mengikuti default global sesi kerja, padahal bebannya beda jauh (baca API + rangkum vs tulis kode).
vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),

    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn(),
    getLeadConfig: vi.fn(), putLeadConfig: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const ENGINE = { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" };
const LEAD = {
  enabled: false, paused: false, pausedProjects: [], everyMin: 5, timeoutSec: 600,
  maxAutoAnswers: 3, maxConcurrent: 2, queueWaitSec: 120, flowTtlMin: 60,
  requireGreenBeforeIntegrate: true, engine: { ...ENGINE },
};
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
  conflict: { ...ENGINE }, lead: LEAD,
  telegram: { enabled: true, progress: true, engine: { ...ENGINE } },
  ...over,
});
const tg = (engine: object, over: object = {}) =>
  settings({ telegram: { enabled: true, progress: true, engine }, ...over });

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockImplementation(async (b: any) => b);
  vi.mocked(api.getCodexVersion).mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
  vi.mocked(api.getLeadConfig).mockResolvedValue(LEAD as any);
  vi.mocked(api.putLeadConfig).mockImplementation(async (c: any) => c);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SPEC-492 · kartu agen operator Telegram", () => {
  it("kartu ada di tab Model sesi, bersebelahan dengan kartu lead", async () => {
    openModel();
    expect(await screen.findByText("Agen operator Telegram")).toBeInTheDocument();
    expect(screen.getByText("Agen hanoman-lead")).toBeInTheDocument();
  });

  // Opt-in mati = warisan penuh, dan kartunya HARUS menyebut nilai warisannya (pelajaran SPEC-383).
  it("mati → tak ada picker, nilai warisan ditampilkan", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      tg({ ...ENGINE }, { agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } }) as any);
    openModel();
    const inh = await screen.findByTestId("telegram-engine-inherited");
    expect(inh).toHaveTextContent("Codex CLI");
    expect(inh).toHaveTextContent("gpt-5.6-terra");
    expect(screen.queryByLabelText("Runtime Telegram")).toBeNull();
  });

  // AC-6 · deskripsi kartu wajib menyatakan kapan perubahan berlaku — sesi yang sedang jalan tidak
  // di-restart diam-diam.
  it("deskripsi kartu menyatakan bahwa sesi berjalan tidak di-restart", async () => {
    openModel();
    const desc = await screen.findByTestId("telegram-engine-desc");
    expect(desc).toHaveTextContent(/berikutnya/i);
    expect(desc).toHaveTextContent("/engine restart");
  });

  it("menyalakan override → PUT /settings dengan telegram.engine.enabled true", async () => {
    openModel();
    const wrap = await screen.findByLabelText("Override agen Telegram");
    fireEvent.click(within(wrap).getByRole("switch"));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telegram: expect.objectContaining({
        engine: expect.objectContaining({ enabled: true }) }) })));
  });

  // Blok `telegram` punya penulis KEDUA sejak SPEC-492: command `/runtime|/model|/effort` dari chat.
  // Menulis dari snapshot yang dimuat saat mount akan mengembalikannya tanpa satu klik pun.
  it("menulis dari GET yang segar, bukan snapshot saat mount", async () => {
    openModel();
    await screen.findByText("Agen operator Telegram");
    vi.mocked(api.getSettings).mockResolvedValue(
      tg({ enabled: true, agent: "codex", model: "gpt-5.5", effort: "medium" }) as any);
    const wrap = screen.getByLabelText("Override agen Telegram");
    fireEvent.click(within(wrap).getByRole("switch"));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telegram: expect.objectContaining({
        engine: expect.objectContaining({ agent: "codex", model: "gpt-5.5" }) }) })));
  });

  it("menukar runtime ke codex → model & effort ikut bertukar ke katalog codex", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(tg({ ...ENGINE, enabled: true }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Runtime Telegram"), { target: { value: "codex" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telegram: expect.objectContaining({
        engine: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" } }) })));
  });

  it("memilih model codex yang tak mendukung effort tersimpan → effort dikoersi", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      tg({ enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "ultra" }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Model Telegram"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telegram: expect.objectContaining({
        engine: expect.objectContaining({ model: "gpt-5.6-luna", effort: "xhigh" }) }) })));
  });

  it("picker effort codex hanya menawarkan effort yang didukung model terpilih", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      tg({ enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" }) as any);
    openModel();
    const sel = await screen.findByLabelText("Effort Telegram");
    const values = Array.from(sel.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).not.toContain("ultra");
    expect(values).toContain("max");
  });
});
