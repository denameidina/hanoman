import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { METHODS, METHOD_IDS, DEFAULT_METHOD } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    getSettings: vi.fn(), putSettings: vi.fn(), startSession: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

import { StartSessionModal } from "../src/App";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const spec: any = { id: "SPEC-734", source: "brief", title: "t", stage: "planned" };
const settings = (method: string) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  verifyScope: "changed", method,
});

const optionsOf = (el: HTMLElement) => [...(el as HTMLSelectElement).options];

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings("matt") as any);
  vi.mocked(api.startSession).mockResolvedValue({ id: "spec-734" } as any);
});

describe("StartSessionModal · picker Metode (SPEC-734)", () => {
  // AC-1 · seluruh METHOD_IDS muncul, terpilih pada Setting.method.
  it("AC-1 · menampilkan seluruh METHOD_IDS dan terpilih pada Setting.method", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue("matt"));
    const values = optionsOf(screen.getByLabelText("Metode")).map((o) => o.value);
    expect(values).toEqual([...METHOD_IDS]);
  });

  // AC-10 · opsi + labelnya datang dari katalog, bukan daftar hardcode di berkas ini: entri
  // METHODS ketiga muncul di picker tanpa satu pun perubahan di server maupun web.
  it("AC-10 · label opsi datang dari METHODS", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue("matt"));
    const opts = optionsOf(screen.getByLabelText("Metode"));
    for (const id of METHOD_IDS) {
      expect(opts.find((o) => o.value === id)!.textContent).toContain(METHODS[id]!.label);
    }
  });

  it("mengirim method terpilih ke startSession", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue("matt"));
    fireEvent.change(screen.getByLabelText("Metode"), { target: { value: "superpowers" } });
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-734", method: "superpowers" })));
  });

  // AC-9 · id dari hub yang belum ada di build ini tak boleh mengosongkan picker.
  it("AC-9 · Setting.method tak dikenal → picker jatuh ke DEFAULT_METHOD", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings("tak-ada-metode-ini") as any);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue(DEFAULT_METHOD));
  });

  it("menampilkan prasyarat instalasi metode terpilih", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue("matt"));
    for (const r of METHODS.matt!.requires) expect(screen.getByTestId("method-requires")).toHaveTextContent(r);
  });
});

// AC-1/AC-10 · picker KEDUA: default global di Settings → tab "Sesi", sekamar dengan kartu
// Scope verifikasi (SPEC-376) yang bentuknya memang dicerminkan kartu ini.
describe("SettingsScreen · picker Metode default (SPEC-734)", () => {
  const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
  const full = (over: object = {}) => ({ ...settings("matt"), agent: "claude",
    codex: { model: "gpt-5.6-sol", effort: "xhigh" },
    conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" }, ...over });

  const openSesi = () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sesi" }));
  };

  beforeEach(() => {
    vi.mocked(api.getSettings).mockResolvedValue(full() as any);
    vi.mocked(api.putSettings).mockResolvedValue(full() as any);
  });

  it("AC-1 · menampilkan seluruh METHOD_IDS, terpilih pada Setting.method", async () => {
    openSesi();
    await waitFor(() => expect(screen.getByLabelText("Metode default")).toHaveValue("matt"));
    expect(optionsOf(screen.getByLabelText("Metode default")).map((o) => o.value))
      .toEqual([...METHOD_IDS]);
  });

  it("AC-10 · label opsi datang dari METHODS", async () => {
    openSesi();
    const opts = optionsOf(await screen.findByLabelText("Metode default"));
    for (const id of METHOD_IDS) {
      expect(opts.find((o) => o.value === id)!.textContent).toContain(METHODS[id]!.label);
    }
  });

  // AC-8 · menyimpan default lewat PUT /settings — tanpa migration, tanpa endpoint khusus.
  it("AC-8 · mengubah default menyimpannya lewat putSettings", async () => {
    openSesi();
    await waitFor(() => expect(screen.getByLabelText("Metode default")).toHaveValue("matt"));
    fireEvent.change(screen.getByLabelText("Metode default"), { target: { value: "superpowers" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ method: "superpowers" })));
  });

  // AC-9 · id dari hub yang belum ada di build ini tak mengosongkan picker Settings juga.
  it("AC-9 · method tak dikenal → picker jatuh ke DEFAULT_METHOD", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(full({ method: "tak-ada-metode-ini" }) as any);
    openSesi();
    await waitFor(() => expect(screen.getByLabelText("Metode default")).toHaveValue(DEFAULT_METHOD));
  });
});
