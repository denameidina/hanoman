import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import type { TerminalSession } from "../src/api/client";
import { reviewSpecIdsOf, scopeByReview } from "../src/screens/backlog-worktree";
import { waitingSessions } from "../src/screens/pet-state";
import type { Spec } from "../src/screens/types";

// Gelombang 7 · filter "Perlu ditinjau". Predikatnya sesi item yang MENUNGGU jawaban manusia, kondisi yang
// sama dengan "Menunggu jawabanmu" di Overview dan pet. Tes ini mengunci predikat dan perilaku layarnya,
// bukan teks marketing-nya. Klausa "stage done" sengaja tak ada: lihat komentar di backlog-worktree.ts.

const sesi = (over: Partial<TerminalSession>): TerminalSession =>
  ({ id: "s", projectId: "p", cwd: "/repo", exited: false, ...over }) as TerminalSession;

describe("predikat Perlu ditinjau (gelombang 7)", () => {
  const sessions = [
    sesi({ id: "menunggu-a", specId: "SPEC-A", decision: true, deciding: false }),
    sesi({ id: "diputuskan-lead", specId: "SPEC-B", decision: true, deciding: true }),
    sesi({ id: "sudah-berakhir", specId: "SPEC-C", decision: true, exited: true, exitCode: 0 }),
    sesi({ id: "masih-jalan", specId: "SPEC-D", decision: false }),
    sesi({ id: "tanpa-spec", decision: true, deciding: false }),
    sesi({ id: "menunggu-e", specId: "SPEC-E", decision: true, deciding: false }),
  ];

  it("hanya sesi hidup, menunggu, dan tidak sedang diputuskan lead yang dihitung", () => {
    expect([...reviewSpecIdsOf(sessions)].sort()).toEqual(["SPEC-A", "SPEC-E"]);
  });

  it("konsisten dengan waitingSessions (sumber Overview dan pet): himpunan id-nya sama", () => {
    const dariPet = waitingSessions(sessions, []).map((s) => s.specId).filter((x): x is string => !!x).sort();
    expect([...reviewSpecIdsOf(sessions)].sort()).toEqual(dariPet);
  });

  it("scope 'all' mengembalikan semua item, 'review' hanya yang ada di himpunan", () => {
    const items = [{ id: "SPEC-A" }, { id: "SPEC-B" }];
    const ids: ReadonlySet<string> = new Set(["SPEC-A"]);
    expect(scopeByReview(items, "all", ids)).toHaveLength(2);
    expect(scopeByReview(items, "review", ids).map((s) => s.id)).toEqual(["SPEC-A"]);
  });
});

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
     createdAt: "2026-07-01T00:00:00.000Z", startedAt: null, ...over }) as Spec;

const ide = spec({ id: "SPEC-IDE", title: "Ide mentah", stage: "brainstorming", baseSha: null });
const kerja = spec({ id: "SPEC-KERJA", title: "Sedang dikerjakan", stage: "executing", baseSha: "a1b2c3d", startedAt: "2026-07-02T00:00:00.000Z" });
const manual = spec({ id: "SPEC-MANUAL", title: "Selesai manual", stage: "done", baseSha: null });
const tunggu = spec({ id: "SPEC-TUNGGU", title: "Menunggu jawaban", stage: "executing", baseSha: "9f8e7d6", startedAt: "2026-07-03T00:00:00.000Z" });
const tungguTanpaWt = spec({ id: "SPEC-TUNGGU2", title: "Menunggu tanpa worktree", stage: "planned", baseSha: null });
const semua = [ide, kerja, manual, tunggu, tungguTanpaWt];
const menunggu: ReadonlySet<string> = new Set(["SPEC-TUNGGU", "SPEC-TUNGGU2"]);

const envelope = (items: Spec[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const openFilter = () => fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
const pickReview = (value: "all" | "review") =>
  fireEvent.change(screen.getByLabelText("Filter perlu ditinjau"), { target: { value } });
const pickWorktree = (value: "all" | "worktree") =>
  fireEvent.change(screen.getByLabelText("Filter worktree"), { target: { value } });

function renderBacklog(items: Spec[], reviewSpecIds?: ReadonlySet<string>) {
  vi.mocked(api.listSpecs).mockResolvedValue(envelope(items));
  return render(<BacklogScreen backlog={items} projects={[{ id: "p", name: "p" }] as never}
    projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} reviewSpecIds={reviewSpecIds} />);
}

beforeEach(() => {
  vi.mocked(api.listSpecs).mockReset();
  try { window.localStorage.clear(); } catch { /* jsdom selalu punya; jaga-jaga */ }
});

describe("filter Perlu ditinjau di layar Backlog", () => {
  it("default 'Semua item': kelima item tampil", async () => {
    renderBacklog(semua, menunggu);
    expect(await screen.findByText("Ide mentah")).toBeTruthy();
    expect(screen.getByText("Sedang dikerjakan")).toBeTruthy();
    expect(screen.getByText("Selesai manual")).toBeTruthy();
    expect(screen.getByText("Menunggu jawaban")).toBeTruthy();
    expect(screen.getByText("Menunggu tanpa worktree")).toBeTruthy();
  });

  it("memilih Perlu ditinjau hanya menampilkan item yang sesinya menunggu, dan tampil sebagai chip", async () => {
    renderBacklog(semua, menunggu);
    await screen.findByText("Ide mentah");
    openFilter();
    pickReview("review");
    expect(screen.getByText("Menunggu jawaban")).toBeTruthy();
    expect(screen.getByText("Menunggu tanpa worktree")).toBeTruthy();
    expect(screen.queryByText("Ide mentah")).toBeNull();
    expect(screen.queryByText("Sedang dikerjakan")).toBeNull();
    expect(screen.queryByText("Selesai manual")).toBeNull();
    expect(screen.getByRole("button", { name: /Hapus filter Perlu ditinjau/ })).toBeTruthy();
  });

  it("digabung dengan Ber-worktree (AND): hanya item menunggu yang juga punya worktree", async () => {
    renderBacklog(semua, menunggu);
    await screen.findByText("Ide mentah");
    openFilter();
    pickReview("review");
    pickWorktree("worktree");
    expect(screen.getByText("Menunggu jawaban")).toBeTruthy();
    expect(screen.queryByText("Menunggu tanpa worktree")).toBeNull();
    expect(screen.getByRole("button", { name: /Hapus filter Ber-worktree/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hapus filter Perlu ditinjau/ })).toBeTruthy();
  });

  it("angka segmen tahap mengikuti himpunan yang disaring, bukan himpunan penuh", async () => {
    renderBacklog(semua, menunggu);
    await screen.findByText("Ide mentah");
    expect(within(screen.getByRole("tab", { name: /Brainstorm/ })).getByText("1")).toBeTruthy();
    openFilter();
    pickReview("review");
    expect(within(screen.getByRole("tab", { name: /Brainstorm/ })).queryByText("1")).toBeNull();
    expect(within(screen.getByRole("tab", { name: /Dikerjakan/ })).getByText("1")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /^Spec/ })).getByText("1")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Selesai/ })).queryByText("1")).toBeNull();
  });

  it("filter tidak mengubah param yang dikirim ke server (penyaringan di klien)", async () => {
    renderBacklog([ide, tunggu], menunggu);
    await screen.findByText("Ide mentah");
    openFilter();
    pickReview("review");
    await waitFor(() => expect(screen.queryByText("Ide mentah")).toBeNull());
    const last = vi.mocked(api.listSpecs).mock.calls.at(-1)![0]!;
    expect(Object.keys(last)).not.toContain("review");
    expect(Object.keys(last)).not.toContain("reviewSpecIds");
  });

  it("melepas chip mengembalikan daftar penuh dan pilihan kembali ke Semua item", async () => {
    renderBacklog([ide, tunggu], menunggu);
    await screen.findByText("Ide mentah");
    openFilter();
    pickReview("review");
    fireEvent.click(screen.getByRole("button", { name: /Hapus filter Perlu ditinjau/ }));
    expect(screen.getByText("Ide mentah")).toBeTruthy();
    expect((screen.getByLabelText("Filter perlu ditinjau") as HTMLSelectElement).value).toBe("all");
  });

  it("Reset filter ikut mengembalikan cakupan Perlu ditinjau", async () => {
    renderBacklog([ide, tunggu], menunggu);
    await screen.findByText("Ide mentah");
    openFilter();
    pickReview("review");
    fireEvent.click(screen.getAllByRole("button", { name: "Reset filter" })[0]!);
    expect(screen.getByText("Ide mentah")).toBeTruthy();
    expect((screen.getByLabelText("Filter perlu ditinjau") as HTMLSelectElement).value).toBe("all");
  });

  it("tanpa sesi yang menunggu, filter kosong dijawab keadaan filter, bukan 'tahap kosong'", async () => {
    renderBacklog(semua, new Set<string>());
    await screen.findByText("Ide mentah");
    openFilter();
    pickReview("review");
    expect(await screen.findByText("Tidak ada spec untuk filter ini")).toBeTruthy();
    expect(screen.queryByText(/Tidak ada spec di tahap/)).toBeNull();
  });

  it("tanpa prop reviewSpecIds (bawaan), filter Perlu ditinjau tetap aman: daftar kosong, tak crash", async () => {
    renderBacklog(semua);
    await screen.findByText("Ide mentah");
    openFilter();
    pickReview("review");
    expect(await screen.findByText("Tidak ada spec untuk filter ini")).toBeTruthy();
  });

  it("pilihan yang dipulihkan tetap menyala: chip terlihat setelah layar dimuat ulang", async () => {
    const { unmount } = renderBacklog(semua, menunggu);
    await screen.findByText("Ide mentah");
    openFilter();
    pickReview("review");
    unmount();
    renderBacklog(semua, menunggu);
    expect(await screen.findByRole("button", { name: /Hapus filter Perlu ditinjau/ })).toBeTruthy();
    expect(screen.queryByText("Ide mentah")).toBeNull();
  });
});
