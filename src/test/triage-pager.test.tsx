import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TriageScreen } from "../src/screens/TriageScreen";

const ticket = (i: number) => ({
  id: `t${i}`, projectId: "p1", number: i, category: "bug", title: `keluhan ${i}`,
  reporterEmail: "a@b.c", status: "new", specId: null, attachmentCount: 0,
  createdAt: "2026-08-04T00:00:00.000Z",
});

const listTickets = vi.fn(async (p: { page?: string; limit?: string } = {}) => ({
  items: [ticket((p.page ?? "1") === "1" ? 1 : 99)],
  total: 45, page: Number(p.page ?? 1), pageSize: 20, unreviewed: 45,
}));

vi.mock("../src/api/client", () => ({
  api: { listTickets: (p?: never) => listTickets(p ?? {}) },
  ApiError: class extends Error { },
}));

const props = { projects: [], onAccepted: vi.fn(), onToast: vi.fn() } as unknown as Parameters<typeof TriageScreen>[0];

beforeEach(() => vi.clearAllMocks());

describe("TriageScreen paginasi tiket (SPEC-523)", () => {
  it("meminta halaman lewat page/limit", async () => {
    render(<TriageScreen {...props} />);
    await waitFor(() => expect(screen.getByText(/keluhan 1/)).toBeInTheDocument());
    expect(listTickets).toHaveBeenCalledWith(expect.objectContaining({ page: "1", limit: "20" }));
    expect(screen.getByText("1–20 dari 45 tiket")).toBeInTheDocument();
  });

  it("Berikutnya mengganti isi daftar", async () => {
    render(<TriageScreen {...props} />);
    await waitFor(() => expect(screen.getByText(/keluhan 1/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText(/keluhan 99/)).toBeInTheDocument());
    expect(screen.queryByText(/keluhan 1$/)).not.toBeInTheDocument();
  });
});
