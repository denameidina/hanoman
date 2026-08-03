import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GithubIssuesPanel } from "../src/screens/TriageScreen";

const issue = (i: number) => ({
  id: `g${i}`, projectId: "p1", repoSlug: "o/r", number: i, title: `issue ${i}`,
  body: "", url: `https://x/${i}`, authorLogin: "rekan", labels: [], issueState: "open",
  status: "new", specId: null,
  issueCreatedAt: "2026-08-04T00:00:00.000Z", issueUpdatedAt: "2026-08-04T00:00:00.000Z",
  pulledAt: "2026-08-04T00:00:00.000Z",
});

const listGithubIssues = vi.fn(async (_id: string, p: { page?: number; limit?: number } = {}) => ({
  items: [issue((p.page ?? 1) === 1 ? 1 : 99)], total: 45, page: p.page ?? 1, pageSize: 20,
}));

vi.mock("../src/api/client", () => ({
  api: { listGithubIssues: (id: string, p?: never) => listGithubIssues(id, p ?? {}) },
  ApiError: class extends Error { },
}));

beforeEach(() => vi.clearAllMocks());

describe("GithubIssuesPanel paginasi (SPEC-523)", () => {
  it("Berikutnya mengganti isi dengan halaman 2", async () => {
    render(<GithubIssuesPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText("issue 1")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText("issue 99")).toBeInTheDocument());
    expect(listGithubIssues).toHaveBeenLastCalledWith("p1", { page: 2, limit: 20 });
  });
});
