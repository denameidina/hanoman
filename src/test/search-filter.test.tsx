import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-198 · search/filter via API: BacklogScreen mengirim q/priority ke listSpecs, server yang
// menyaring. Segmen tahap (Redesign 3D) dikelompokkan di KLIEN karena server hanya menerima satu
// nilai `stage` persis — jadi tahap tak ikut ke server, dan itu yang diuji di sini.
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";

const envelope = (items: unknown[] = []): any => ({ items, total: items.length, page: 1, pageSize: 20 });
beforeEach(() => { vi.mocked(api.listSpecs).mockReset(); vi.mocked(api.listSpecs).mockResolvedValue(envelope()); });
const lastParams = () => vi.mocked(api.listSpecs).mock.calls.at(-1)![0] as Record<string, unknown>;
const openFilter = () => fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));

const item = (id: string, stage: string, title: string) =>
  ({ id, projectId: "arta", title, source: "brief", stage, priority: "sedang", author: "a",
     objective: "o", payload: {}, branchFrom: null, baseSha: null, createdAt: "2026-07-01T00:00:00.000Z",
     startedAt: null, dependsOn: [], blockedBy: [] });

function renderBacklog(backlog: unknown[] = []) {
  return render(
    <BacklogScreen backlog={backlog as never}
      projects={[{ id: "arta", name: "arta" }] as never}
      projectFilter="all" onProjectFilter={() => {}} />
  );
}

describe("search + filter backlog via API (SPEC-178 → SPEC-198)", () => {
  it("mengirim q ke API saat mengetik (debounced)", async () => {
    renderBacklog();
    fireEvent.change(screen.getByLabelText("Cari backlog"), { target: { value: "csv" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ q: "csv" }));
  });

  it("segmen tahap disaring di klien: hanya item di tahap itu yang tampil, tahap tak dikirim", async () => {
    vi.mocked(api.listSpecs).mockResolvedValue(envelope([
      item("SPEC-1", "planned", "rencana"), item("SPEC-2", "executing", "kerjaan"),
    ]));
    renderBacklog();
    expect(await screen.findByText("rencana")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Dikerjakan/ }));
    expect(screen.getByText("kerjaan")).toBeTruthy();
    expect(screen.queryByText("rencana")).toBeNull();
    expect(lastParams()).not.toHaveProperty("stage");
  });

  it("mengirim priority ke API", async () => {
    renderBacklog();
    openFilter();
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "rendah" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ priority: "rendah" }));
  });

  it("kombinasi search + priority = satu query berisi keduanya; tahap tetap di klien", async () => {
    renderBacklog();
    fireEvent.change(screen.getByLabelText("Cari backlog"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("tab", { name: /Spec/ }));
    openFilter();
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ q: "alpha", priority: "tinggi" }));
    expect(lastParams()).not.toHaveProperty("stage");
  });

  it("tanpa filter: params tanpa q/priority (server balikkan himpunan penuh)", async () => {
    renderBacklog();
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(lastParams().q).toBeUndefined();
    expect(lastParams().priority).toBeUndefined();
    expect(lastParams()).not.toHaveProperty("page");
    expect(lastParams()).not.toHaveProperty("limit");
  });
});
