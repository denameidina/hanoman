import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subKey } from "@hanoman/shared";
import { eventsStub, resetEventsStub, setTopics, emitTopic, lastSubParams, allSubs } from "./helpers/events-stub";

// SPEC-908 · LeadScreen berhenti men-poll HTTP. Satu topik membawa status + decisions + flows
// sekaligus, cermin `load()` yang memang sudah satu `Promise.all`.

const { getLeadStatus, getLeadDecisions, getLeadFlows } = vi.hoisted(() => ({
  getLeadStatus: vi.fn(), getLeadDecisions: vi.fn(), getLeadFlows: vi.fn(),
}));
vi.mock("../src/api/client", () => ({
  api: {
    getLeadStatus, getLeadDecisions, getLeadFlows,
    putLeadConfig: vi.fn(), overrideLeadDecision: vi.fn(), cancelLeadDecision: vi.fn(),
    updateProject: vi.fn(), submitLeadFlow: vi.fn(), cancelLeadFlow: vi.fn(),
  },
  ApiError: class extends Error {},
}));
vi.mock("../src/api/events", () => eventsStub);

const { LeadScreen } = await import("../src/screens/LeadScreen");

const CONFIG = {
  enabled: true, paused: false, pausedProjects: [], everyMin: 5, timeoutSec: 120,
  maxAutoAnswers: 3, requireGreenBeforeIntegrate: true,
  engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
};
const STATUS = {
  config: CONFIG,
  projects: [{ projectId: "a", name: "Alpha", optIn: true, paused: false, decisions24h: 4, openSessions: 1 }],
  queue: [], deciding: [], waiting: [],
  lastPulseAt: "2026-07-31T00:00:00.000Z",
};
const decision = (id: string, question: string) => ({
  id, projectId: "a", specId: "SPEC-1", sessionId: "spec-1",
  gate: "detected", kind: "answer", question, answer: "Kolom baru.",
  reason: "Waktu lahir sebuah baris tak bisa dihitung ulang.", refs: [],
  confidence: "tinggi", action: "none", status: "berlaku", weighty: false,
  choice: null, choiceIndex: null, options: [], missing: [],
  supersededById: null, createdAt: "2026-07-31T00:00:00.000Z",
});
const paged = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });

const projects = [{ id: "a", name: "Alpha", leadOptIn: true }] as never;
const view = () => (
  <LeadScreen projects={projects} onProjectChanged={vi.fn()} onToast={vi.fn()} onGotoTerminal={vi.fn()} />
);

beforeEach(() => {
  resetEventsStub();
  localStorage.clear();
  getLeadStatus.mockReset(); getLeadStatus.mockResolvedValue(STATUS);
  getLeadDecisions.mockReset(); getLeadDecisions.mockResolvedValue(paged([decision("d1", "Pertanyaan awal?")]));
  getLeadFlows.mockReset(); getLeadFlows.mockResolvedValue(paged([]));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); });

describe("SPEC-908 · LeadScreen live", () => {
  it("nol poll HTTP saat WS mendukung — ketiga endpoint masing-masing 1×", async () => {
    setTopics(["lead"]);
    render(view());
    expect(await screen.findByText(/Pertanyaan awal\?/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getLeadStatus).toHaveBeenCalledTimes(1);
    expect(getLeadDecisions).toHaveBeenCalledTimes(1);
    expect(getLeadFlows).toHaveBeenCalledTimes(1);
  });

  it("satu frame menyetel status DAN jejak sekaligus — tak ada campuran dua generasi", async () => {
    setTopics(["lead"]);
    render(view());
    await screen.findByText(/Pertanyaan awal\?/);
    await act(async () => {
      emitTopic({
        t: "lead", key: subKey("lead", { decPage: 1, flowPage: 1, limit: 20 }),
        status: { ...STATUS, projects: [{ ...STATUS.projects[0]!, decisions24h: 11 }] } as never,
        decisions: paged([decision("d2", "Pertanyaan baru?")]) as never,
        flows: paged([]) as never,
      });
    });
    expect(screen.getByText(/Pertanyaan baru\?/)).toBeTruthy();
    expect(screen.queryByText(/Pertanyaan awal\?/)).toBeNull();
    expect(screen.queryByText(/Memuat/i)).toBeNull();
  });

  it("berlangganan dengan filter project & kedua nomor halaman yang aktif", async () => {
    setTopics(["lead"]);
    localStorage.setItem("hn.ui.v1.lead.filter", '"a"');
    render(view());
    await act(async () => {});
    expect(lastSubParams("lead")).toMatchObject({ projectId: "a", decPage: 1, flowPage: 1, limit: 20 });
  });

  it("frame yang mendarat di halaman aktif tak melempar operator ke halaman 1", async () => {
    setTopics(["lead"]);
    // Halaman 2 dicapai lewat jalur operator supaya pager ikut teruji; persistensinya sendiri
    // dijaga scheduler-lead-state-persist.test.tsx.
    getLeadDecisions.mockResolvedValue(
      { items: [decision("d5", "Keputusan halaman satu?")], total: 60, page: 1, pageSize: 20 });
    render(view());
    await screen.findByText(/Keputusan halaman satu\?/);
    getLeadDecisions.mockResolvedValue(
      { items: [decision("d6", "Keputusan halaman dua?")], total: 60, page: 2, pageSize: 20 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Berikutnya" })); });
    await screen.findByText(/Keputusan halaman dua\?/);
    expect(allSubs("lead")).toEqual([expect.objectContaining({ decPage: 2, flowPage: 1 })]);

    await act(async () => {
      emitTopic({
        t: "lead", key: subKey("lead", { decPage: 2, flowPage: 1, limit: 20 }),
        status: STATUS as never,
        decisions: { items: [decision("d7", "Keputusan halaman dua, diperbarui?")], total: 60, page: 2, pageSize: 20 } as never,
        flows: paged([]) as never,
      });
    });
    expect(screen.getByText(/Keputusan halaman dua, diperbarui\?/)).toBeTruthy();
    // Satu frame menyetel tiga state sekaligus; nomor halaman KEDUA daftar wajib selamat.
    expect(allSubs("lead")).toEqual([expect.objectContaining({ decPage: 2, flowPage: 1 })]);
    expect(screen.getByText(/21.40 dari 60 keputusan/)).toBeTruthy();
  });

  it("frame berkunci lain tak mendarat", async () => {
    setTopics(["lead"]);
    render(view());
    await screen.findByText(/Pertanyaan awal\?/);
    await act(async () => {
      emitTopic({
        t: "lead", key: subKey("lead", { decPage: 5, flowPage: 1, limit: 20 }),
        status: STATUS as never,
        decisions: paged([decision("d9", "Pertanyaan halaman lima?")]) as never,
        flows: paged([]) as never,
      });
    });
    expect(screen.queryByText(/Pertanyaan halaman lima\?/)).toBeNull();
    expect(screen.getByText(/Pertanyaan awal\?/)).toBeTruthy();
  });
});
