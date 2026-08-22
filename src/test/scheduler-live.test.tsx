import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subKey } from "@hanoman/shared";
import { eventsStub, resetEventsStub, setTopics, emitTopic, lastSubParams, allSubs } from "./helpers/events-stub";

// SPEC-908 · SchedulerScreen berhenti men-poll HTTP, dan penanda `nonce` SPEC-523 dicabut karena
// tiap QueueSection kini berlangganan (status, halaman)-nya sendiri.

const { getSchedulerState, getSchedulerQueue, listCrons } = vi.hoisted(() => ({
  getSchedulerState: vi.fn(),
  getSchedulerQueue: vi.fn(),
  listCrons: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 10 })),
}));
vi.mock("../src/api/client", () => ({
  api: {
    getSchedulerState, getSchedulerQueue, listCrons,
    putSchedulerConfig: vi.fn(), updateProject: vi.fn(),
    cancelSchedulerQueueItem: vi.fn(), requeueSchedulerQueueItem: vi.fn(),
  },
  ApiError: class extends Error {},
}));
vi.mock("../src/api/events", () => eventsStub);

const { SchedulerScreen } = await import("../src/screens/SchedulerScreen");

const STATE = {
  config: {
    enabled: true, paused: false, maxConcurrent: 2, autonomy: "butuh-keputusan",
    sources: { backlog: { enabled: true, everyMin: 15 }, triase: { enabled: false, everyMin: 30 } },
  },
  cap: 2, liveCount: 1,
  sources: [
    { id: "backlog", enabled: true, everyMin: 15, lastRunAt: "2026-07-22T00:00:00.000Z", nextRunAt: "2026-07-22T00:15:00.000Z" },
    { id: "triase", enabled: false, everyMin: 30, lastRunAt: null, nextRunAt: null },
  ],
  queueCounts: { queued: 1, launched: 0, done: 0, failed: 1, canceled: 0 },
  sessions: [],
};
const row = (id: string, specId: string, status: string) => ({
  id, specId, projectId: "a", source: "backlog", priority: "sedang", status,
  sessionId: null, note: null, enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: null,
});
const QUEUE_ROWS: Record<string, Array<Record<string, unknown>>> = {
  queued: [row("q1", "SPEC-1", "queued")],
  failed: [row("q3", "SPEC-3", "failed")],
};

const projects = [{ id: "a", name: "Alpha", schedulerOptIn: false }] as never;
const backlog = [
  { id: "SPEC-1", title: "Judul satu" }, { id: "SPEC-3", title: "Judul tiga" },
  { id: "SPEC-9", title: "Judul sembilan" },
] as never;
const view = () => (
  <SchedulerScreen projects={projects} backlog={backlog}
    onProjectChanged={vi.fn()} onToast={vi.fn()} onGotoTerminal={vi.fn()} />
);
beforeEach(() => {
  resetEventsStub();
  localStorage.clear();
  getSchedulerState.mockReset();
  getSchedulerState.mockResolvedValue(STATE);
  getSchedulerQueue.mockReset();
  getSchedulerQueue.mockImplementation(async (p: { status?: string } = {}) => {
    const items = QUEUE_ROWS[p.status ?? ""] ?? [];
    return { items, total: items.length, page: 1, pageSize: 10 };
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); });

describe("SPEC-908 · SchedulerScreen live", () => {
  it("nol poll HTTP saat WS mendukung — state 1×, tiap seksi antrean 1×", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    render(view());
    expect(await screen.findByText(/Judul satu/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getSchedulerState).toHaveBeenCalledTimes(1);
    // Empat seksi (queued/canceled/done/failed) = empat muat awal, bukan lebih.
    expect(getSchedulerQueue).toHaveBeenCalledTimes(4);
  });

  it("empat seksi berlangganan dengan `status` masing-masing", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    render(view());
    await screen.findByText(/Judul satu/);
    const subs = allSubs("schedulerQueue");
    expect(subs).toHaveLength(4);
    expect(subs.map((s) => s.status).sort()).toEqual(["canceled", "done", "failed", "queued"]);
    for (const s of subs) expect(s).toMatchObject({ page: 1, limit: 10 });
  });

  it("layar berlangganan `schedulerState` tanpa parameter", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    render(view());
    await screen.findByText(/Judul satu/);
    expect(lastSubParams("schedulerState")).toEqual({});
  });

  it("frame schedulerState memperbarui layar tanpa berkedip ke loading", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    render(view());
    await screen.findByText(/Judul satu/);
    await act(async () => {
      emitTopic({
        t: "schedulerState", key: subKey("schedulerState", {}),
        state: { ...STATE, liveCount: 7 } as never,
      });
    });
    expect(screen.getByText(/7 \/ 2 sesi hidup/)).toBeTruthy();
    expect(screen.queryByText(/Memuat/i)).toBeNull();
  });

  it("frame yang mendarat di halaman aktif tak melempar seksi ke halaman 1", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    localStorage.setItem("hn.ui.v1.scheduler.queue-queued-page", "2");
    getSchedulerQueue.mockImplementation(async (p: { status?: string } = {}) => {
      const items = QUEUE_ROWS[p.status ?? ""] ?? [];
      return { items, total: p.status === "queued" ? 60 : items.length, page: 1, pageSize: 10 };
    });
    render(view());
    await screen.findByText(/Judul satu/);
    const queued = () => allSubs("schedulerQueue").filter((s) => s.status === "queued");
    expect(queued()).toEqual([expect.objectContaining({ page: 2 })]);

    await act(async () => {
      emitTopic({
        t: "schedulerQueue",
        key: subKey("schedulerQueue", { status: "queued", page: 2, limit: 10 }),
        data: { items: [row("q9", "SPEC-9", "queued")], total: 60, page: 2, pageSize: 10 } as never,
      });
    });
    expect(screen.getByText(/Judul sembilan/)).toBeTruthy();
    expect(queued()).toEqual([expect.objectContaining({ page: 2 })]);
    expect(screen.getByText(/11.20 dari 60 item/)).toBeTruthy();
  });

  it("frame schedulerQueue hanya mendarat di seksi yang kuncinya cocok", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    render(view());
    await screen.findByText(/Judul satu/);

    // Kunci yang TAK ada pelanggannya (halaman 2) tak boleh mengubah apa pun.
    await act(async () => {
      emitTopic({
        t: "schedulerQueue",
        key: subKey("schedulerQueue", { status: "queued", page: 2, limit: 10 }),
        data: { items: [row("q9", "SPEC-9", "queued")], total: 1, page: 2, pageSize: 10 } as never,
      });
    });
    expect(screen.queryByText(/Judul sembilan/)).toBeNull();
    expect(screen.getByText(/Judul satu/)).toBeTruthy();

    // Kunci seksi `failed` mendarat; seksi `queued` tak tersentuh.
    await act(async () => {
      emitTopic({
        t: "schedulerQueue",
        key: subKey("schedulerQueue", { status: "failed", page: 1, limit: 10 }),
        data: { items: [row("q9", "SPEC-9", "failed")], total: 1, page: 1, pageSize: 10 } as never,
      });
    });
    expect(screen.getByText(/Judul sembilan/)).toBeTruthy();
    expect(screen.getByText(/Judul satu/)).toBeTruthy();
    expect(screen.queryByText(/Judul tiga/)).toBeNull();   // baris `failed` lama tergantikan
  });
});
