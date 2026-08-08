import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

let failNext = true;
const projects = vi.fn(async () => {
  if (failNext) throw new Error("boom");
  return { items: [], total: 0, page: 1, pageSize: 20 };
});
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: (...a: unknown[]) => projects(...(a as [])),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })), listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })), // SPEC-180 · provider poll
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

describe("app load states", () => {
  it("shows the error state on a failed fetch, then the empty state after retry", async () => {
    render(<App />);
    const retry = await screen.findByText("Coba lagi");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("illustration-PST-006")).toBeInTheDocument();

    failNext = false;
    retry.click();
    // overview with zero projects: every panel falls back to its empty state
    await waitFor(() => expect(screen.getByText("Belum ada project")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("illustration-PST-005")).toBeInTheDocument();
  });
});
