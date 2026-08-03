import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SchedulerScreen } from "../src/screens/SchedulerScreen";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const item = (i: number) => ({
  id: `q${i}`, specId: `SPEC-${i}`, projectId: "p1", source: "backlog", priority: "sedang",
  status: "queued", sessionId: null, note: null,
  enqueuedAt: "2026-08-04T00:00:00.000Z", launchedAt: null,
});

const getSchedulerQueue = vi.fn(async (p: { status?: string; page?: number; limit?: number } = {}) => ({
  items: p.status === "queued" ? [item((p.page ?? 1) === 1 ? 1 : 99)] : [],
  total: p.status === "queued" ? 30 : 0, page: p.page ?? 1, pageSize: 10,
}));

vi.mock("../src/api/client", () => ({
  api: {
    getSchedulerState: vi.fn(async () => ({
      config: SCHEDULER_DEFAULTS, cap: 2, liveCount: 0,
      sources: [{ id: "backlog", enabled: false, everyMin: 15, lastRunAt: null, nextRunAt: null }],
      queueCounts: { queued: 30, launched: 0, done: 0, failed: 0 },
      sessions: [],
    })),
    getSchedulerQueue: (p?: never) => getSchedulerQueue(p ?? {}),
    putSchedulerConfig: vi.fn(),
    updateProject: vi.fn(),
  },
}));

const props = {
  projects: [], backlog: [], onProjectChanged: vi.fn(), onToast: vi.fn(), onGotoTerminal: vi.fn(),
} as unknown as Parameters<typeof SchedulerScreen>[0];

beforeEach(() => vi.clearAllMocks());

describe("SchedulerScreen antrean berhalaman (SPEC-523)", () => {
  it("meminta antrean per status lewat endpoint daftar, bukan dari state", async () => {
    render(<SchedulerScreen {...props} />);
    await waitFor(() => expect(screen.getByText("SPEC-1")).toBeInTheDocument());
    expect(getSchedulerQueue).toHaveBeenCalledWith({ status: "queued", page: 1, limit: 10 });
  });

  it("menekan Berikutnya meminta halaman 2 untuk status itu saja", async () => {
    render(<SchedulerScreen {...props} />);
    await waitFor(() => expect(screen.getByText("SPEC-1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Berikutnya")[0]!);
    await waitFor(() => expect(getSchedulerQueue).toHaveBeenCalledWith({ status: "queued", page: 2, limit: 10 }));
  });
});
