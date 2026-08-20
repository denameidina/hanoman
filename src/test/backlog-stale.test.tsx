import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import type { Spec } from "../src/screens/types";

const spec = (id: string) =>
  ({ id, projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
     createdAt: "2026-07-01T00:00:00.000Z", startedAt: null }) as Spec;

const items = [spec("SPEC-1"), spec("SPEC-2")];

function backlog(onToast?: (m: string, k?: string, i?: string) => void) {
  render(<BacklogScreen backlog={items} projects={[{ id: "p", name: "p" }] as never}
    projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onToast={onToast} />);
}

beforeEach(() => { vi.mocked(api.listSpecs).mockReset(); });

// SPEC-857 · ADR-0131 · kegagalan refetch dulu ditelan `.catch(() => { })`, jadi jumlah backlog
// membeku pada muatan terakhir yang berhasil dan tampil seolah kebenaran. Di hub yang tercekik
// `P1008` sebagian refetch gagal & sisanya lolos → angkanya berubah-ubah dan terbaca sebagai
// "backlog saya berkurang", padahal tak satu baris pun hilang dari DB.
describe("kegagalan menyegarkan backlog terlihat (SPEC-857)", () => {
  it("saat refetch gagal, jumlahnya ditandai basi dan operator ditoast", async () => {
    vi.mocked(api.listSpecs).mockRejectedValue(new Error("P1008"));
    const toast = vi.fn();
    backlog(toast);

    // Seed prop tetap terpakai — daftarnya tak dikosongkan; yang berubah cuma penandanya.
    await waitFor(() => expect(screen.getByText(/2 spec · basi/)).toBeTruthy());
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![0]).toMatch(/basi/i);
    expect(toast.mock.calls[0]![1]).toBe("warn");
  });

  it("saat refetch berhasil, tak ada penanda basi maupun toast", async () => {
    vi.mocked(api.listSpecs).mockResolvedValue({ items, total: 2, page: 1, pageSize: 20 });
    const toast = vi.fn();
    backlog(toast);

    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(screen.getByText("2 spec")).toBeTruthy();
    expect(screen.queryByText(/basi/)).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });
});
