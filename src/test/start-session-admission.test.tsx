import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { zSetting, type Spec } from "@hanoman/shared";
import { StartSessionModal } from "../src/App";
import { api, ApiError } from "../src/api/client";

vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return { ...actual, api: { ...actual.api,
    getSettings: vi.fn(), startSession: vi.fn(),
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null }),
  } };
});

const spec = { id: "SPEC-1108", source: "qa", projectId: "p1" } as Spec;
const admission = { enabled: true, liveCount: 6, liveAgentCount: 4, maxConcurrent: 6,
  loadPerCore: 3.75, maxLoadPerCore: 2.5, loadStatus: "available" };
const rejection = (overrides = {}) => new ApiError(409, "409", {
  error: "Host menolak peluncuran", kind: "capacity", admission: { ...admission, ...overrides },
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(zSetting.parse({ autoDefault: true, autoScaffold: true, notifyFail: true }));
  vi.mocked(api.startSession).mockReset();
});

describe("Start backlog admission (SPEC-1108)", () => {
  it("shows rejection numbers before offering manual force, then sends force only on that action", async () => {
    vi.mocked(api.startSession).mockRejectedValueOnce(rejection()).mockResolvedValueOnce({ id: "spec-1108" });
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    expect(screen.queryByRole("button", { name: "Mulai tetap" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mulai" }));
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("6 sesi hidup");
    expect(note).toHaveTextContent("4 agen");
    expect(note).toHaveTextContent("cap 6");
    expect(note).toHaveTextContent("3.75");
    expect(note).toHaveTextContent("2.5");
    expect(vi.mocked(api.startSession).mock.calls[0]![0]).not.toHaveProperty("force");
    fireEvent.click(screen.getByRole("button", { name: "Mulai tetap" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("spec-1108", undefined));
    expect(vi.mocked(api.startSession).mock.calls[1]![0]).toHaveProperty("force", true);
  });

  it("offers ordinary retry and never treats unavailable load as zero", async () => {
    vi.mocked(api.startSession).mockRejectedValueOnce(rejection({ loadPerCore: null, loadStatus: "unsupported" }))
      .mockResolvedValueOnce({ id: "spec-1108" });
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    fireEvent.click(screen.getByRole("button", { name: "Mulai" }));
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent(/load per core: tidak tersedia/i);
    expect(note).not.toHaveTextContent(/load per core: 0/);
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(vi.mocked(api.startSession).mock.calls[1]![0]).not.toHaveProperty("force");
  });

  it("clears a rejected launch when opening a different backlog", async () => {
    vi.mocked(api.startSession).mockRejectedValueOnce(rejection());
    const props = { open: true, spec, onClose: () => {}, onStarted: () => {} };
    const { rerender } = render(<StartSessionModal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Mulai" }));
    await screen.findByRole("alert");
    await act(async () => { rerender(<StartSessionModal {...props} spec={{ ...spec, id: "SPEC-1109" }} />); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mulai tetap" })).not.toBeInTheDocument();
  });

  it("does not offer force for an unrelated HTTP error", async () => {
    const error = new ApiError(409, "dependency error", { error: "dependency error", blockedBy: [] });
    vi.mocked(api.startSession).mockRejectedValueOnce(error);
    const onError = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Mulai" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(screen.queryByRole("button", { name: "Mulai tetap" })).not.toBeInTheDocument();
  });
});
