import { eventsStub } from "./helpers/events-stub";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api/events", () => ({ ...eventsStub,
  eventsStatus: () => ({ connected: true, since: 0, paused: false }), subscribeStatus: () => () => {},
}));
vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return { ...actual, api: { ...actual.api,
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false, prerequisites: [] })),
    listProjects: vi.fn(), listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []), listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    reverseDocs: vi.fn(), scaffoldDocs: vi.fn(), startPrd: vi.fn(), startBreakdown: vi.fn(),
  } };
});
// App owns the launch callbacks; these children supply only their user-action boundary.
vi.mock("../src/screens/ProjectDetailScreen", () => ({ ProjectDetailScreen:
  ({ onReverse, onScaffold }: { onReverse?: () => void; onScaffold?: () => void }) => <>
    {onReverse && <button onClick={onReverse}>Reverse docs</button>}
    {onScaffold && <button onClick={onScaffold}>Scaffold docs</button>}
  </>,
}));
vi.mock("../src/screens/PrdScreen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/PrdScreen")>();
  return { ...actual, PrdScreen: ({ onNewPrd, onStartBreakdown }: {
    onNewPrd: (project: string, brief: { title: string; context: string; outcome: string }) => void;
    onStartBreakdown: (project: string, path: string) => void;
  }) => <>
    <button onClick={() => onNewPrd("p1", { title: "T", context: "Context", outcome: "Outcome" })}>PRD start</button>
    <button onClick={() => onStartBreakdown("p1", "docs/prd/original.md")}>Breakdown start</button>
  </> };
});
vi.mock("../src/screens/TerminalScreen", () => ({ TerminalScreen: () => <div>Terminal terbuka</div> }));
import App from "../src/App";
import { api, ApiError } from "../src/api/client";

beforeEach(() => {
  vi.mocked(api.listProjects).mockResolvedValue({ items: [{ id: "p1", name: "Project", kind: "existing", binding: "/repo" }],
    total: 1, page: 1, pageSize: 20 } as never);
});

describe("Human project launches (SPEC-1108)", () => {
  it("ordinary retry never forces and cancellation does not launch again", async () => {
    window.history.replaceState({}, "", "/projects/p1");
    vi.mocked(api.reverseDocs).mockReset().mockRejectedValue(new ApiError(409, "409", {
      error: "Cap penuh", kind: "capacity", admission: { enabled: true, liveCount: 6, liveAgentCount: 4,
        maxConcurrent: 6, loadPerCore: 1.5, maxLoadPerCore: 2.5, loadStatus: "available" },
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Reverse docs" }));
    await screen.findByRole("alert", {}, { timeout: 1000 });
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(api.reverseDocs).toHaveBeenCalledTimes(2));
    expect(api.reverseDocs).toHaveBeenLastCalledWith("p1");
    await screen.findByRole("alert", {}, { timeout: 1000 });
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.reverseDocs).toHaveBeenCalledTimes(2);
  });

  it.each([
    { method: "reverseDocs", label: "Reverse docs", path: "/projects/p1", args: ["p1"] },
    { method: "scaffoldDocs", label: "Scaffold docs", path: "/projects/p1", args: ["p1"] },
    { method: "startPrd", label: "PRD start", path: "/prd", args: ["p1", { title: "T", context: "Context", outcome: "Outcome" }] },
    { method: "startBreakdown", label: "Breakdown start", path: "/prd", args: ["p1", "docs/prd/original.md"] },
  ] as const)("shows admission and preserves $method arguments when manually forced", async ({ method, label, path, args }) => {
    if (method === "scaffoldDocs") vi.mocked(api.listProjects).mockResolvedValue({ items: [
      { id: "p1", name: "Project", kind: "from-scratch", binding: "/repo" },
    ], total: 1, page: 1, pageSize: 20 } as never);
    window.history.replaceState({}, "", path);
    const launch = vi.mocked(api[method]);
    launch.mockReset().mockRejectedValueOnce(new ApiError(409, "409", {
      error: "Cap penuh", kind: "capacity", admission: { enabled: true, liveCount: 6, liveAgentCount: 4,
        maxConcurrent: 6, loadPerCore: null, maxLoadPerCore: 2.5, loadStatus: "unsupported" },
    })).mockResolvedValueOnce({ id: "launched" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: label }));
    const note = await screen.findByRole("alert", {}, { timeout: 1000 });
    expect(note).toHaveTextContent("6 sesi hidup");
    expect(note).toHaveTextContent("4 agen terstruktur");
    expect(note).toHaveTextContent("cap 6");
    expect(note).toHaveTextContent(/load per core: tidak tersedia/i);
    expect(note).toHaveTextContent("2.5");
    expect(launch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Mulai tetap" }));
    await waitFor(() => expect(launch).toHaveBeenLastCalledWith(...args, { force: true }));
    expect(await screen.findByText("Terminal terbuka")).toBeInTheDocument();
  });
});
