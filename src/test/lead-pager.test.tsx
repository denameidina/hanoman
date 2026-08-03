import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LeadScreen } from "../src/screens/LeadScreen";

const decision = (i: number) => ({
  id: `d${i}`, projectId: "p1", specId: null, sessionId: null,
  gate: "detected", kind: "answer", question: `pertanyaan ${i}`, answer: `jawaban ${i}`,
  reason: "r", refs: [], confidence: "tinggi", action: "none",
  choice: null, choiceIndex: null, options: [], missing: [], choices: [], select: null,
  flowId: null, step: null, status: "berlaku", weighty: false, supersededById: null,
  createdAt: "2026-08-04T00:00:00.000Z",
});

const getLeadDecisions = vi.fn(async (p: { page?: number; limit?: number } = {}) => ({
  items: [decision((p.page ?? 1) === 1 ? 1 : 99)], total: 30, page: p.page ?? 1, pageSize: 20,
}));

vi.mock("../src/api/client", () => ({
  api: {
    getLeadStatus: vi.fn(async () => ({
      config: { enabled: false, maxConcurrent: 2 }, projects: [], deciding: [], queued: [], waiting: [],
      lastPulseAt: null, gate: { inFlight: 0, waiting: 0, capacity: 2 },
    })),
    getLeadDecisions: (p?: never) => getLeadDecisions(p ?? {}),
    getLeadFlows: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    putLeadConfig: vi.fn(),
    updateProject: vi.fn(),
  },
  ApiError: class extends Error { },
}));

const props = {
  projects: [], backlog: [], onProjectChanged: vi.fn(), onToast: vi.fn(), onGotoTerminal: vi.fn(),
} as unknown as Parameters<typeof LeadScreen>[0];

beforeEach(() => vi.clearAllMocks());

describe("LeadScreen paginasi jejak keputusan (SPEC-523)", () => {
  it("meminta halaman lewat page/limit, bukan take", async () => {
    render(<LeadScreen {...props} />);
    await waitFor(() => expect(screen.getByText(/pertanyaan 1/)).toBeInTheDocument());
    expect(getLeadDecisions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
  });

  it("Berikutnya mengganti isi jejak dengan halaman 2", async () => {
    render(<LeadScreen {...props} />);
    await waitFor(() => expect(screen.getByText(/pertanyaan 1/)).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Berikutnya")[0]!);
    await waitFor(() => expect(screen.getByText(/pertanyaan 99/)).toBeInTheDocument());
    expect(screen.queryByText(/pertanyaan 1$/)).not.toBeInTheDocument();
  });
});
