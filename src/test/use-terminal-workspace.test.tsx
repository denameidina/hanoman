import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalWorkspaceSnapshot, TerminalWorkspaceV1 } from "@hanoman/shared";

const mocks = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(public status: number, message: string, public detail: unknown = null) {
      super(message);
    }
  }
  return { get: vi.fn(), put: vi.fn(), FakeApiError };
});

vi.mock("../src/api/client", () => ({
  ApiError: mocks.FakeApiError,
  api: {
    getTerminalWorkspace: mocks.get,
    putTerminalWorkspace: mocks.put,
  },
}));

import { useTerminalWorkspace } from "../src/screens/use-terminal-workspace";
import * as W from "../src/screens/terminal-workspace";

const NOW = "2026-08-15T00:00:00.000Z";
const canonical = (name = "Utama", sessionId: string | null = "session-a"): TerminalWorkspaceV1 => ({
  version: 1,
  groups: [{ id: "g1", name, layout: { rows: 1, cols: 1, cells: [sessionId] } }],
});
const snapshot = (workspace: TerminalWorkspaceV1 | null, revision = 0): TerminalWorkspaceSnapshot => ({
  workspace,
  revision,
  updatedAt: revision ? NOW : null,
});

beforeEach(() => {
  mocks.get.mockReset();
  mocks.put.mockReset();
});

describe("useTerminalWorkspace", () => {
  it("loads the server before enabling writes and an empty browser never seeds empty state", async () => {
    mocks.get.mockResolvedValue(snapshot(null));
    mocks.put.mockResolvedValue(snapshot(canonical("Baru", null), 1));
    const { result } = renderHook(() => useTerminalWorkspace("u1"));

    expect(result.current.status).toBe("loading");
    expect(result.current.writable).toBe(false);
    expect(mocks.put).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mocks.put).not.toHaveBeenCalled();

    await act(async () => {
      expect(await result.current.mutate((view) => W.renameGroup(view, view.active, "Baru"))).toBe(true);
    });
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put.mock.calls[0]![0]).toMatchObject({ baseRevision: 0 });
  });

  it("seeds validated legacy state only after the server reports empty", async () => {
    const legacy = W.fromCanonical(canonical(), "g1");
    localStorage.setItem(W.KEY, JSON.stringify(legacy));
    mocks.get.mockResolvedValue(snapshot(null));
    mocks.put.mockResolvedValue(snapshot(canonical(), 1));

    const { result } = renderHook(() => useTerminalWorkspace("u1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mocks.get.mock.invocationCallOrder[0]).toBeLessThan(mocks.put.mock.invocationCallOrder[0]!);
    expect(mocks.put).toHaveBeenCalledWith({ baseRevision: 0, workspace: canonical() });
    expect(localStorage.getItem(W.KEY)).toBeNull();
  });

  it("lets server state win over legacy and clears legacy after adoption", async () => {
    localStorage.setItem(W.KEY, JSON.stringify(W.fromCanonical(canonical("Lokal"), "g1")));
    mocks.get.mockResolvedValue(snapshot(canonical("Server"), 5));
    const { result } = renderHook(() => useTerminalWorkspace("u1"));

    await waitFor(() => expect(result.current.workspace.groups[0]!.name).toBe("Server"));
    expect(mocks.put).not.toHaveBeenCalled();
    expect(localStorage.getItem(W.KEY)).toBeNull();
  });

  it("adopts the server winner when two legacy seeds race", async () => {
    localStorage.setItem(W.KEY, JSON.stringify(W.fromCanonical(canonical("Legacy"), "g1")));
    mocks.get.mockResolvedValue(snapshot(null));
    mocks.put.mockRejectedValue(new mocks.FakeApiError(409, "conflict", {
      code: "revision-conflict",
      current: snapshot(canonical("Perangkat lain"), 1),
    }));
    const { result } = renderHook(() => useTerminalWorkspace("u1"));

    await waitFor(() => expect(result.current.status).toBe("conflict"));
    expect(result.current.workspace.groups[0]!.name).toBe("Perangkat lain");
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(W.KEY)).toBeNull();
  });

  it("uses a per-user cache as read-only recovery when GET fails", async () => {
    W.writeCache("u1", { workspace: canonical("Cache"), revision: 7, active: "g1" });
    mocks.get.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useTerminalWorkspace("u1"));

    await waitFor(() => expect(result.current.status).toBe("recovering"));
    expect(result.current.workspace.groups[0]!.name).toBe("Cache");
    expect(result.current.writable).toBe(false);
    await act(async () => {
      expect(await result.current.mutate((view) => W.renameGroup(view, view.active, "Jangan kirim"))).toBe(false);
    });
    expect(mocks.put).not.toHaveBeenCalled();

    const second = renderHook(() => useTerminalWorkspace("u2"));
    await waitFor(() => expect(second.result.current.status).toBe("recovering"));
    expect(second.result.current.workspace.groups[0]!.name).toBe("Utama");
  });

  it("refreshes on focus and only on a visible visibilitychange", async () => {
    mocks.get.mockResolvedValueOnce(snapshot(canonical("Awal"), 1))
      .mockResolvedValueOnce(snapshot(canonical("Focus"), 2))
      .mockResolvedValueOnce(snapshot(canonical("Visible"), 3));
    const { result } = renderHook(() => useTerminalWorkspace("u1"));
    await waitFor(() => expect(result.current.workspace.groups[0]!.name).toBe("Awal"));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(result.current.workspace.groups[0]!.name).toBe("Focus"));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.get).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(result.current.workspace.groups[0]!.name).toBe("Visible"));
  });

  it("reapplies one mutation once on a two-device revision conflict", async () => {
    const remote = snapshot(canonical("Remote"), 2);
    mocks.get.mockResolvedValue(snapshot(canonical("Awal"), 1));
    mocks.put.mockRejectedValueOnce(new mocks.FakeApiError(409, "conflict", {
      code: "revision-conflict",
      current: remote,
    })).mockResolvedValueOnce(snapshot(canonical("Baru"), 3));
    const { result } = renderHook(() => useTerminalWorkspace("u1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      expect(await result.current.mutate((view) => W.renameGroup(view, "g1", "Baru"))).toBe(true);
    });
    expect(mocks.put).toHaveBeenNthCalledWith(1, { baseRevision: 1, workspace: canonical("Baru") });
    expect(mocks.put).toHaveBeenNthCalledWith(2, { baseRevision: 2, workspace: canonical("Baru") });
    expect(result.current.status).toBe("conflict");
    expect(result.current.workspace.groups[0]!.name).toBe("Baru");
  });

  it("keeps the last confirmed cache and disables writes after a mutation network error", async () => {
    mocks.get.mockResolvedValue(snapshot(canonical("Terkonfirmasi"), 6));
    mocks.put.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useTerminalWorkspace("u1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      expect(await result.current.mutate((view) => W.renameGroup(view, "g1", "Belum tersimpan"))).toBe(false);
    });
    expect(result.current.status).toBe("recovering");
    expect(result.current.writable).toBe(false);
    expect(W.readCache("u1")?.workspace.groups[0]!.name).toBe("Terkonfirmasi");
  });

  it("bounds repeated conflicts, refetches current state, and never sends a third PUT", async () => {
    mocks.get.mockResolvedValueOnce(snapshot(canonical("Awal"), 1))
      .mockResolvedValueOnce(snapshot(canonical("Pemenang"), 4));
    mocks.put.mockRejectedValueOnce(new mocks.FakeApiError(409, "first", {
      code: "revision-conflict",
      current: snapshot(canonical("Remote"), 2),
    })).mockRejectedValueOnce(new mocks.FakeApiError(409, "second"));
    const { result } = renderHook(() => useTerminalWorkspace("u1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      expect(await result.current.mutate((view) => W.renameGroup(view, "g1", "Baru"))).toBe(false);
    });
    expect(mocks.put).toHaveBeenCalledTimes(2);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("conflict");
    expect(result.current.workspace.groups[0]!.name).toBe("Pemenang");
  });
});
