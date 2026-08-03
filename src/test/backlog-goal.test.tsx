import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    // SPEC-521 · `vi.fn()` polos memulangkan undefined, dan BacklogScreen memanggilnya sebagai
    // `api.listSpecs?.(…)` lalu `p?.then(…)` — rantainya putus, jadi test lama di berkas ini
    // tetap membaca prop `backlog` apa adanya. Hanya describe tab Goal yang memberinya nilai.
    listSpecs: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { NewSpecModal } from "../src/App";

const projects = [{ id: "p1", name: "P1" }] as any;
beforeEach(() => vi.clearAllMocks());

// SPEC-407 · ADR-0089 · backlog goal punya bentuk payload SENDIRI. Server mengikat source ↔
// bentuk payload (zCreateSpec superRefine), jadi mengirim bentuk brief dari sini = 400.
describe("NewSpecModal · tab Goal (SPEC-407)", () => {
  it("mengirim payload goal, bukan payload brief", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Goal"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Turunkan latensi" } });
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "p95 < 200 ms" } });
    fireEvent.change(screen.getByLabelText("Selesai bila"), { target: { value: "benchmark < 200 ms" } });
    fireEvent.click(screen.getByText("Buat goal → sesi goal"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      kind: "goal", title: "Turunkan latensi", goal: "p95 < 200 ms", done: "benchmark < 200 ms",
    })));
  });

  // Objective spec diturunkan dari `goal`; tanpa isi, sesi lahir tanpa sasaran.
  it("goal kosong tak bisa disubmit", () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Goal"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "t" } });
    fireEvent.click(screen.getByText("Buat goal → sesi goal"));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("prefill kind goal (dari PRD) membuka tab Goal dengan goal terisi", async () => {
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={() => {}}
      prefill={{ project: "p1", kind: "goal", title: "Jadwal Invoice", goal: "Wujudkan PRD docs/prd/jadwal-invoice.md" }} />);
    await waitFor(() => expect((screen.getByLabelText("Goal") as HTMLTextAreaElement).value)
      .toBe("Wujudkan PRD docs/prd/jadwal-invoice.md"));
  });

  // Tab lain tak boleh ikut bergeser: bentuk payload-nya masing-masing yang menjaga gerbang server.
  it("tab brief tetap mengirim konteks/outcome", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Fitur" } });
    fireEvent.click(screen.getByText("Buat brief → brainstorm"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: "brief" })));
  });
});

import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";

const goalSpec: any = {
  id: "SPEC-407", projectId: "p1", title: "Turunkan latensi", source: "goal", stage: "executing",
  priority: "tinggi", author: "Goal · a@b.c", objective: "p95 < 200 ms",
  payload: { goal: "p95 < 200 ms", done: "benchmark < 200 ms", constraints: "tanpa cache", priority: "tinggi" },
  branchFrom: null, baseSha: null,
};

// SPEC-407 · item goal harus terbaca sebagai goal di backlog — bukan jatuh ke label "feature
// brief" (fallback SOURCE_META) dan bukan menampilkan field konteks/outcome yang tak pernah diisi.
describe("BacklogScreen · item goal (SPEC-407)", () => {
  it("badge Goal muncul dan detail mengeja goal, selesai bila, batasan", async () => {
    render(<BacklogScreen backlog={[goalSpec]} projects={[{ id: "p1", name: "P1" }] as never}
      projectFilter="all" onProjectFilter={() => {}} />);
    // SPEC-521 · "Goal" kini muncul di tab filter DAN badge kartu → findByText cocok ganda
    // dan melempar. Pola yang sama dipakai untuk "Audit" di backlog-board.test.tsx.
    await waitFor(() => expect(screen.getAllByText("Goal").length).toBeGreaterThan(1));
    fireEvent.click(screen.getByText("Turunkan latensi"));
    await waitFor(() => expect(screen.getByText("Selesai bila")).toBeTruthy());
    expect(screen.getByText("benchmark < 200 ms")).toBeTruthy();
    expect(screen.getByText("tanpa cache")).toBeTruthy();
    expect(screen.queryByText("Konteks")).toBeNull();
  });

  it("edit inline menyimpan payload goal, bukan payload brief", async () => {
    const onEditSpec = vi.fn();
    render(<BacklogScreen backlog={[{ ...goalSpec, stage: "brainstorming", baseSha: null }]}
      projects={[{ id: "p1", name: "P1" }] as never} onEditSpec={onEditSpec}
      projectFilter="all" onProjectFilter={() => {}} />);
    fireEvent.click(await screen.findByText("Turunkan latensi"));
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.click(screen.getByText("Simpan"));
    await waitFor(() => expect(onEditSpec).toHaveBeenCalledWith(
      expect.objectContaining({ id: "SPEC-407" }),
      expect.objectContaining({ payload: expect.objectContaining({ goal: "p95 < 200 ms" }) })));
  });
});

// SPEC-521 · filter goal = tab kelima di deret tab sumber, ditopang GET /specs?source=goal.
// Penyaringan hidup di SERVER (ADR-0038), jadi yang diuji adalah PARAM yang menyeberang —
// menghitung baris yang dirender klien hanya akan menguji mock, bukan produk.
describe("BacklogScreen · tab Goal (SPEC-521)", () => {
  const briefSpec: any = {
    id: "SPEC-1", projectId: "p1", title: "form invoice", source: "brief", stage: "planned",
    priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
  };
  const mount = () => {
    vi.mocked(api.listSpecs).mockResolvedValue(
      { items: [briefSpec], total: 1, page: 1, pageSize: 20 } as never);
    render(<BacklogScreen backlog={[briefSpec]} projects={[{ id: "p1", name: "P1" }] as never}
      projectFilter="all" onProjectFilter={() => {}} />);
  };
  // getByRole("tab") — BUKAN getByText: badge kartu item goal berlabel "Goal" juga
  // (SOURCE_META.goal), jadi pencarian berbasis teks cocok ganda begitu ada item goal di layar.
  const tab = (name: string) => screen.getByRole("tab", { name });
  const lastCall = () => vi.mocked(api.listSpecs).mock.calls.at(-1)![0]!;

  it("tab Goal ada di deret tab sumber", () => {
    mount();
    expect(tab("Goal")).toBeTruthy();
    // Tab lama tak boleh hilang.
    expect(tab("Semua spec")).toBeTruthy();
    expect(tab("Dari brief")).toBeTruthy();
    expect(tab("Dari QA")).toBeTruthy();
    expect(tab("Audit")).toBeTruthy();
  });

  it("mengklik tab Goal mengirim source=goal ke server", async () => {
    mount();
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(lastCall().source).toBeUndefined();
    fireEvent.click(tab("Goal"));
    await waitFor(() => expect(lastCall().source).toBe("goal"));
  });

  it("kembali ke Semua spec mengirim source undefined, bukan sentinel \"all\"", async () => {
    mount();
    fireEvent.click(tab("Goal"));
    await waitFor(() => expect(lastCall().source).toBe("goal"));
    fireEvent.click(tab("Semua spec"));
    await waitFor(() => expect(lastCall().source).toBeUndefined());
  });
});
