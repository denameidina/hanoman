import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionHistoryModal } from "../src/screens/SessionHistoryModal";

const row = (i: number) => ({
  id: `h${i}`, sessionId: `spec-${i}`, projectId: "p1", specId: `SPEC-${i}`,
  kind: "backlog", title: `sesi ${i}`, branch: null, flow: null, agent: null, model: null,
  startedAt: "2026-08-04T00:00:00.000Z", endedAt: "2026-08-04T00:10:00.000Z",
  exitCode: 0, transcriptBytes: null,
});

const listSessionHistory = vi.fn(async (p: { page?: number } = {}) => ({
  items: [row((p.page ?? 1) === 1 ? 1 : 99)], total: 45, page: p.page ?? 1, pageSize: 20,
}));

vi.mock("../src/api/client", () => ({
  api: { listSessionHistory: (p?: never) => listSessionHistory(p ?? {}) },
  ApiError: class extends Error { },
}));

const props = { projects: [{ id: "p1", name: "p1" }], onClose: vi.fn(), onRestart: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe("SessionHistoryModal berhalaman (SPEC-523)", () => {
  it("Berikutnya MENGGANTI isi, bukan menambah (muat-lebih dicabut)", async () => {
    render(<SessionHistoryModal {...props} />);
    await waitFor(() => expect(screen.getByText("sesi 1")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText("sesi 99")).toBeInTheDocument());
    expect(screen.queryByText("sesi 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Muat lebih")).not.toBeInTheDocument();
  });
});
