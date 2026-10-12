import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import { hasWorktree, scopeByWorktree } from "../src/screens/backlog-worktree";
import type { Spec } from "../src/screens/types";

// ADR-0214 · filter "Ber-worktree": predikat jujur = `baseSha` terisi (hanoman pernah membuat worktree).
// Bukan "perlu ditinjau": stage `done` sudah jadi segmen "Selesai", dan status tinjau/integrasi
// tak ada di SpecSlim. Tes ini mengunci predikatnya, bukan teks marketing-nya.

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
     createdAt: "2026-07-01T00:00:00.000Z", startedAt: null, ...over }) as Spec;

const ide = spec({ id: "SPEC-IDE", title: "Ide mentah", stage: "brainstorming", baseSha: null });
const kerja = spec({ id: "SPEC-KERJA", title: "Sedang dikerjakan", stage: "executing", baseSha: "a1b2c3d", startedAt: "2026-07-02T00:00:00.000Z" });
const manual = spec({ id: "SPEC-MANUAL", title: "Selesai manual", stage: "done", baseSha: null });

describe("predikat worktree (ADR-0214)", () => {
  it("hanya baseSha terisi yang dihitung punya worktree", () => {
    expect(hasWorktree({ baseSha: "a1b2c3d" })).toBe(true);
    expect(hasWorktree({ baseSha: null })).toBe(false);
    expect(hasWorktree({})).toBe(false);
    expect(hasWorktree({ baseSha: "" })).toBe(false);
  });

  it("scope 'all' mengembalikan semua item, 'worktree' hanya yang pernah punya worktree", () => {
    const items = [ide, kerja, manual];
    expect(scopeByWorktree(items, "all")).toHaveLength(3);
    expect(scopeByWorktree(items, "worktree").map((s) => s.id)).toEqual(["SPEC-KERJA"]);
  });
});

const envelope = (items: Spec[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const openFilter = () => fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
const pickWorktree = (value: "all" | "worktree") =>
  fireEvent.change(screen.getByLabelText("Filter worktree"), { target: { value } });

function renderBacklog(items: Spec[]) {
  vi.mocked(api.listSpecs).mockResolvedValue(envelope(items));
  render(<BacklogScreen backlog={items} projects={[{ id: "p", name: "p" }] as never}
    projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} />);
}

beforeEach(() => {
  vi.mocked(api.listSpecs).mockReset();
  try { window.localStorage.clear(); } catch { /* jsdom selalu punya; jaga-jaga */ }
});

describe("filter Ber-worktree di layar Backlog", () => {
  it("default 'Semua item': ketiga item tampil", async () => {
    renderBacklog([ide, kerja, manual]);
    expect(await screen.findByText("Ide mentah")).toBeTruthy();
    expect(screen.getByText("Sedang dikerjakan")).toBeTruthy();
    expect(screen.getByText("Selesai manual")).toBeTruthy();
  });

  it("memilih Ber-worktree menyembunyikan item tanpa worktree dan tampil sebagai chip", async () => {
    renderBacklog([ide, kerja, manual]);
    await screen.findByText("Ide mentah");
    openFilter();
    pickWorktree("worktree");
    expect(screen.getByText("Sedang dikerjakan")).toBeTruthy();
    expect(screen.queryByText("Ide mentah")).toBeNull();
    expect(screen.queryByText("Selesai manual")).toBeNull();
    expect(screen.getByRole("button", { name: /Hapus filter Ber-worktree/ })).toBeTruthy();
  });

  it("angka segmen tahap mengikuti himpunan yang disaring, bukan himpunan penuh", async () => {
    renderBacklog([ide, kerja, manual]);
    await screen.findByText("Ide mentah");
    const brainstorm = screen.getByRole("tab", { name: /Brainstorm/ });
    expect(within(brainstorm).getByText("1")).toBeTruthy();
    openFilter();
    pickWorktree("worktree");
    expect(within(screen.getByRole("tab", { name: /Brainstorm/ })).queryByText("1")).toBeNull();
    expect(within(screen.getByRole("tab", { name: /Dikerjakan/ })).getByText("1")).toBeTruthy();
  });

  it("filter tidak mengubah param yang dikirim ke server (penyaringan di klien)", async () => {
    renderBacklog([ide, kerja]);
    await screen.findByText("Ide mentah");
    openFilter();
    pickWorktree("worktree");
    await waitFor(() => expect(screen.queryByText("Ide mentah")).toBeNull());
    const last = vi.mocked(api.listSpecs).mock.calls.at(-1)![0]!;
    expect(Object.keys(last)).not.toContain("worktree");
    expect(Object.keys(last)).not.toContain("baseSha");
  });

  it("melepas chip mengembalikan daftar penuh", async () => {
    renderBacklog([ide, kerja]);
    await screen.findByText("Ide mentah");
    openFilter();
    pickWorktree("worktree");
    fireEvent.click(screen.getByRole("button", { name: /Hapus filter Ber-worktree/ }));
    expect(screen.getByText("Ide mentah")).toBeTruthy();
    expect((screen.getByLabelText("Filter worktree") as HTMLSelectElement).value).toBe("all");
  });

  it("Reset filter ikut mengembalikan cakupan worktree ke Semua item", async () => {
    renderBacklog([ide, kerja]);
    await screen.findByText("Ide mentah");
    openFilter();
    pickWorktree("worktree");
    fireEvent.click(screen.getAllByRole("button", { name: "Reset filter" })[0]!);
    expect(screen.getByText("Ide mentah")).toBeTruthy();
    expect((screen.getByLabelText("Filter worktree") as HTMLSelectElement).value).toBe("all");
  });
});
