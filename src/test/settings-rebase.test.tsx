import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { rebaseEdits } from "../src/screens/settings-rebase";

// S5 · tab Settings yang terbuka melewati update/seed dulu mengirim SELURUH snapshot saat mount:
// server menandai `user` setiap nilai yang berbeda dari DB → model global & puluhan sel orkestrasi
// kembali ke id lama dan dikunci `user`. Hanya field yang benar-benar diubah operator yang boleh ikut.
describe("rebaseEdits (S5)", () => {
  const base = { model: "claude-sonnet-5", notifySound: "short",
    orchestration: { feature: { enabled: true, claude: { Spec: { model: "claude-opus-5", effort: "high" } } } } };
  const fresh = { model: "sonnet", notifySound: "short", extra: 1,
    orchestration: { feature: { enabled: true, claude: { Spec: { model: "opus", effort: "medium" } } } } };

  it("field yang tak diubah operator mengikuti DB terbaru; yang diubah menang", () => {
    const edited = { ...base, notifySound: "chime" };
    expect(rebaseEdits(base, edited, fresh)).toEqual({ ...fresh, notifySound: "chime" });
  });

  it("perubahan satu sel orkestrasi tak membalik sel lain yang di-seed ulang", () => {
    const edited = structuredClone(base);
    edited.orchestration.feature.claude.Spec.effort = "low";
    expect(rebaseEdits(base, edited, fresh)).toEqual({ ...fresh,
      orchestration: { feature: { enabled: true, claude: { Spec: { model: "opus", effort: "low" } } } } });
  });

  it("tanpa perubahan → persis DB terbaru; fresh bukan objek → edited apa adanya", () => {
    expect(rebaseEdits(base, structuredClone(base), fresh)).toEqual(fresh);
    const edited = { ...base, notifySound: "chime" };
    expect(rebaseEdits(base, edited, undefined)).toEqual(edited);
  });

  it("array diperlakukan atomik", () => {
    expect(rebaseEdits({ a: [1] }, { a: [1, 2] }, { a: [9] })).toEqual({ a: [1, 2] });
    expect(rebaseEdits({ a: [1] }, { a: [1] }, { a: [9] })).toEqual({ a: [9] });
  });
});

vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), putSettings: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const settings = (model: string, goalEnabled = false) => ({
  model, effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: goalEnabled, condition: "" },
});

describe("SettingsScreen · simpan dari tab basi (S5)", () => {
  beforeEach(() => {
    vi.mocked(api.getSettings).mockReset();
    vi.mocked(api.putSettings).mockReset().mockImplementation(async (b: any) => b);
  });
  it("mengubah satu toggle tak membalik model global yang di-seed ulang sesudah tab dibuka", async () => {
    vi.mocked(api.getSettings)
      .mockResolvedValueOnce(settings("claude-sonnet-5") as any)   // snapshot saat mount (basi)
      .mockResolvedValue(settings("sonnet") as any);               // DB sesudah seed alias
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sesi" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Mode goal default" }));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(api.putSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      model: "sonnet", goal: { enabled: true, condition: "" } }));
  });
});
