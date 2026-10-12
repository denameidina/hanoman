import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import type { Spec } from "../src/screens/types";

// Audit UI/UX 2026-10 · Backlog: label konsisten, prioritas satu sumber, StageBar sebagai progressbar
// (di detail), CTA jalankan agen untuk semua tahap, indikator muat ringan, dan hint drag yang terlihat.
const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "judul", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
     ...over }) as Spec;

const projects = [{ id: "p", name: "p" }] as never;
const screenWith = (backlog: Spec[], extra: Record<string, unknown> = {}) =>
  render(<BacklogScreen backlog={backlog} projects={projects} projectFilter="all"
    onProjectFilter={() => {}} {...extra} />);

describe("prioritas: satu helper label untuk daftar dan papan", () => {
  it("'tinggi' tampil sebagai titik dengan nama aksesibel 'Prioritas Tinggi', di daftar maupun papan", () => {
    screenWith([spec({ priority: "tinggi" })]);
    expect(screen.getByTitle(/^Prioritas Tinggi/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Papan" }));
    expect(screen.getByTitle(/^Prioritas Tinggi/)).toBeInTheDocument();
  });
});

describe("StageBar: tahap sebagai progressbar yang dibaca pembaca layar", () => {
  it("nama aksesibel 'Status <tahap>', nilai = indeks tahap, teks nilai = nama tahap", () => {
    screenWith([spec({ id: "SPEC-7", title: "bertahap", stage: "objective" })]);
    fireEvent.click(screen.getByText("bertahap"));          // progres penuh ada di detail
    const bar = within(screen.getByRole("dialog")).getByRole("progressbar", { name: "Status Objective" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
    expect(bar).toHaveAttribute("aria-valuetext", "Objective");
  });
});

describe("detail: CTA jalankan agen untuk semua tahap", () => {
  it("item planned: 'Jalankan' di detail memanggil onStart", () => {
    const onStart = vi.fn();
    screenWith([spec({ id: "SPEC-2", title: "wip", stage: "planned" })], { onStart });
    fireEvent.click(screen.getByText("wip"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Jalankan" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart.mock.calls[0]![0].id).toBe("SPEC-2");
  });

  it("item yang sedang berjalan: 'Buka sesi' di detail memanggil onOpenRun", () => {
    const onOpenRun = vi.fn();
    screenWith([spec({ id: "SPEC-3", title: "jalan", stage: "executing" })],
      { onStart: vi.fn(), onOpenRun, activeSpecs: new Set(["SPEC-3"]) });
    fireEvent.click(screen.getByText("jalan"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Buka sesi" }));
    expect(onOpenRun).toHaveBeenCalledOnce();
  });

  it("item selesai tetap punya 'Jalankan' (lanjut sisa kerja), tanpa 'Mulai' atau 'Lanjutkan'", () => {
    screenWith([spec({ id: "SPEC-4", title: "beres", stage: "done" })], { onStart: vi.fn() });
    fireEvent.click(screen.getByText("beres"));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("button", { name: "Lanjutkan" })).toBeNull();
    expect(dialog.queryByRole("button", { name: "Mulai" })).toBeNull();
    expect(dialog.getByRole("button", { name: "Jalankan" })).toBeTruthy();
  });
});

describe("baris dan kartu: satu aksi utama, sisanya di menu ⋯", () => {
  it("Dokumen, Tandai selesai, dan Review perubahan ada di menu, bukan sejajar", () => {
    screenWith([spec({ id: "SPEC-5", title: "kartu" })], { onOpenReview: vi.fn(), onMarkDone: vi.fn() });
    expect(screen.queryByRole("menuitem", { name: "Lihat dokumen" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Tandai selesai" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain SPEC-5" }));
    expect(screen.getByRole("menuitem", { name: "Lihat dokumen" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Tandai selesai" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Review perubahan" })).toBeTruthy();
  });
});

describe("indikator muat saat refetch: ringan, daftar lama tetap tampil", () => {
  it("'Memuat…' dan aria-busy selama refetch, lalu hilang setelah data baru datang", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.listSpecs).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    screenWith([spec({ id: "SPEC-9", title: "daftar lama" })]);
    expect(screen.getByTestId("backlog-refreshing")).toHaveTextContent("Memuat…");
    expect(screen.getByText("daftar lama")).toBeTruthy();
    expect(screen.getByTestId("backlog-scroll")).toHaveAttribute("aria-busy", "true");

    // Id berbeda: item yang id-nya sudah ada di prop `backlog` memakai judul dari prop (mergeSlim).
    resolve({ items: [spec({ id: "SPEC-10", title: "daftar baru" })], total: 1, page: 1, pageSize: 20 });
    await waitFor(() => expect(screen.queryByTestId("backlog-refreshing")).toBeNull());
    expect(screen.getByText("daftar baru")).toBeTruthy();
    expect(screen.getByTestId("backlog-scroll")).not.toHaveAttribute("aria-busy");
  });
});

describe("papan: hint drag terlihat di layar", () => {
  it("menjelaskan seret ke Brainstorm, bukan hanya lewat title kartu", () => {
    screenWith([spec()]);
    fireEvent.click(screen.getByRole("button", { name: "Papan" }));
    expect(screen.getByTestId("board-drag-hint")).toHaveTextContent(
      "Seret kartu dari kolom Backlog ke Brainstorm untuk memulai sesi");
  });
});

describe("sumber dengan istilah teknis punya keterangan", () => {
  it("sumber Audit (dipilih di popover Filter) menjelaskan apa itu audit dan jalan lanjutnya", () => {
    screenWith([spec()]);
    expect(screen.queryByTestId("backlog-tab-hint")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    fireEvent.change(screen.getByLabelText("Filter sumber"), { target: { value: "audit" } });
    expect(screen.getByTestId("backlog-tab-hint")).toHaveTextContent(/Audit: hasil pemeriksaan project/);
  });
});

describe("muat pertama: skeleton, bukan layar kosong palsu", () => {
  it("daftar yang belum pernah termuat tampil sebagai skeleton sampai server menjawab", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.listSpecs).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    screenWith([]);
    expect(screen.getByText("Memuat backlog")).toBeInTheDocument();
    expect(screen.queryByText("Backlog masih kosong")).toBeNull();
    resolve({ items: [], total: 0, page: 1, pageSize: 20 });
    await waitFor(() => expect(screen.getByText("Backlog masih kosong")).toBeInTheDocument());
  });
});

// Perubahan prioritas reversibel: lewat toast dengan "Urungkan". Hapus tetap lewat konfirmasi (diuji
// di backlog-delete-confirm.test.tsx), jadi tak ada urung di jalur itu.
describe("ubah prioritas di detail bisa diurungkan", () => {
  it("memilih prioritas baru lalu Urungkan mengembalikan prioritas semula", () => {
    const onEditSpec = vi.fn();
    const editable = spec({ id: "SPEC-20", title: "bisa diubah", stage: "brainstorming", baseSha: null,
      priority: "sedang", payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } });
    screenWith([editable], { onEditSpec, onStart: vi.fn() });
    fireEvent.click(screen.getByText("bisa diubah"));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Prioritas item ini"), { target: { value: "tinggi" } });
    expect(onEditSpec).toHaveBeenLastCalledWith(expect.objectContaining({ id: "SPEC-20" }), { priority: "tinggi" });
    fireEvent.click(screen.getByRole("button", { name: "Urungkan" }));
    expect(onEditSpec).toHaveBeenLastCalledWith(expect.objectContaining({ id: "SPEC-20" }), { priority: "sedang" });
  });
});
