import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LOCAL_DEVICE_ID, type PresenceView, type PresenceDeviceView, type HandledByEntry } from "@hanoman/shared";
import { startTargets } from "../src/api/start-targets";

// SPEC-1216 · ADR-0165 §11 · Task 11 bagian 2 — render StartSessionModal. Pola cermin
// src/test/start-session-agent.test.tsx: mock `../src/api/client` penuh, StartSessionModal
// diimpor SESUDAH vi.mock (hoisted), `api` diimpor untuk memasang mock per test.
vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), startSession: vi.fn(), getCodexVersion: vi.fn(),
    presence: vi.fn(), getProject: vi.fn(),
  },
  createApi: vi.fn(() => ({ startSession: vi.fn() })),
  ApiError: class extends Error { status = 0 },
}));

import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

const dev = (o: Partial<PresenceDeviceView> & { deviceId: string }): PresenceDeviceView => ({
  name: o.deviceId, local: o.deviceId === LOCAL_DEVICE_ID, online: true, lastSeenAt: null,
  sessions: [], control: { state: "available", protocol: 1, version: "v", capabilities: ["sessions:spawn"], since: "t" },
  capacity: { enabled: true, liveCount: 0, liveAgentCount: 0, maxConcurrent: 5, loadPerCore: 0.1, maxLoadPerCore: 1, loadStatus: "available",
    memAvailablePct: 50, minMemAvailablePct: 15, memStatus: "available" },
  ...o,
});
const handledBy = (deviceId: string, name = deviceId): HandledByEntry[] => [{ deviceId, name }];

describe("startTargets (SPEC-1216 · AC-B7/B8)", () => {
  it("urutan: hub ini dulu, lalu handledBy, lalu device lain", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: LOCAL_DEVICE_ID }), dev({ deviceId: "dB" }), dev({ deviceId: "dA" })], hubVersion: "1.0.0" };
    const out = startTargets(view, handledBy("dA"));
    expect(out.map((t) => t.deviceId)).toEqual([LOCAL_DEVICE_ID, "dA", "dB"]);
  });
  it("eligible = online ∧ control available ∧ sessions:spawn ∧ kapasitas tak penuh", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA" })], hubVersion: "1.0.0" };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: true });
  });
  it.each([
    ["offline", { online: false }, "offline"],
    ["control null", { control: null }, "control-off"],
    ["protocol-mismatch", { control: { state: "protocol-mismatch", protocol: 2, version: "v", capabilities: [], since: "t" } }, "protocol-mismatch"],
    ["tanpa sessions:spawn", { control: { state: "available", protocol: 1, version: "v", capabilities: ["sessions:read"], since: "t" } }, "no-spawn"],
    ["kapasitas penuh (liveAgentCount≥max)", { capacity: { enabled: true, liveCount: 5, liveAgentCount: 5, maxConcurrent: 5, loadPerCore: 0.1, maxLoadPerCore: 1, loadStatus: "available" } }, "capacity-full"],
    ["kapasitas penuh (load>ambang)", { capacity: { enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 5, loadPerCore: 2, maxLoadPerCore: 1, loadStatus: "available" } }, "capacity-full"],
  ] as const)("%s → reason %s", (_label, over, reason) => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA", ...(over as Partial<PresenceDeviceView>) })], hubVersion: "1.0.0" };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: false, reason });
  });
  it("capacity === null bukan alasan menolak", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA", capacity: null })], hubVersion: "1.0.0" };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: true });
  });
});

const fixtureSpec: any = { id: "SPEC-1216", projectId: "proj1", source: "brief", title: "t", stage: "planned" };
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, ...over,
});
const viewWithDA: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA", name: "laptop-dA" })], hubVersion: "1.0.0" };
const viewAllOffline: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA", online: false })], hubVersion: "1.0.0" };

describe("StartSessionModal — target picker (SPEC-1216 · AC-B7/B8)", () => {
  beforeEach(() => {
    vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
    vi.mocked(api.startSession).mockResolvedValue({ id: "sess-1216" } as any);
    vi.mocked(api.getCodexVersion).mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
    vi.mocked(api.presence).mockReset();
    vi.mocked(api.getProject).mockReset();
  });
  it("default = handledBy pertama eligible; tak memanggil startSession sebelum klik", async () => {
    vi.mocked(api.presence).mockResolvedValue(viewWithDA);
    vi.mocked(api.getProject).mockResolvedValue({ handledBy: handledBy("dA", "laptop-dA") } as any);
    render(<StartSessionModal open spec={fixtureSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/target/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText(/target/i)).toHaveValue("dA"));
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("tanpa kandidat eligible → default hub ini", async () => {
    vi.mocked(api.presence).mockResolvedValue(viewAllOffline);
    vi.mocked(api.getProject).mockResolvedValue({ handledBy: handledBy("dA", "laptop-dA") } as any);
    render(<StartSessionModal open spec={fixtureSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/target/i)).toHaveValue(LOCAL_DEVICE_ID));
  });

  it("target remote → tombol force ('Mulai tetap') tak dirender", async () => {
    vi.mocked(api.presence).mockResolvedValue(viewWithDA);
    vi.mocked(api.getProject).mockResolvedValue({ handledBy: handledBy("dA", "laptop-dA") } as any);
    render(<StartSessionModal open spec={fixtureSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/target/i)).toHaveValue("dA"));
    expect(screen.queryByText("Mulai tetap")).toBeNull();
  });

  // S4b · sesi lahir di device target dengan Setting LOCAL-only miliknya — pratinjau (Setting & versi
  // codex hub) tak boleh tampil seolah rencana final.
  it("S4b · target remote → pratinjau menyatakan rencana final ditentukan device target", async () => {
    vi.mocked(api.presence).mockResolvedValue(viewWithDA);
    vi.mocked(api.getProject).mockResolvedValue({ handledBy: handledBy("dA", "laptop-dA") } as any);
    render(<StartSessionModal open spec={fixtureSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/target/i)).toHaveValue("dA"));
    const note = await screen.findByTestId("phase-plan-remote-note");
    expect(note).toHaveTextContent("laptop-dA");
    expect(note).toHaveTextContent("ditentukan Setting device itu");
    expect(note).toHaveTextContent("bisa diabaikan");
    fireEvent.change(screen.getByLabelText(/target/i), { target: { value: LOCAL_DEVICE_ID } });
    expect(screen.queryByTestId("phase-plan-remote-note")).toBeNull();
  });
});
