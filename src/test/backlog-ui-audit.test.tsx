import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import type { Spec } from "../src/screens/types";

// Audit UI/UX 2026-10 · Backlog: label konsisten, prioritas satu sumber, StageBar sebagai progressbar,
// CTA jalankan agen untuk item belum selesai, indikator muat ringan, dan hint drag yang terlihat.
const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "judul", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
     ...over }) as Spec;

const projects = [{ id: "p", name: "p" }] as never;
const screenWith = (backlog: Spec[], extra: Record<string, unknown> = {}) =>
  render(<BacklogScreen backlog={backlog} projects={projects} projectFilter="all"
    onProjectFilter={() => {}} {...extra} />);

describe("prioritas: satu helper label untuk grid dan board", () => {
  it("'tinggi' tampil sebagai 'Tinggi' dengan tooltip, di grid maupun board", () => {
    screenWith([spec({ priority: "tinggi" })]);
    expect(screen.getByTitle("Prioritas Tinggi").textContent).toBe("Tinggi");
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.getByTitle("Prioritas Tinggi").textContent).toBe("Tinggi");
  });
});

describe("StageBar: tahap sebagai progressbar yang dibaca pembaca layar", () => {
  it("nama aksesibel 'Status <tahap>', nilai = indeks tahap, teks nilai = nama tahap", () => {
    screenWith([spec({ stage: "objective" })]);
    const bar = screen.getByRole("progressbar", { name: "Status Objective" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
    expect(bar).toHaveAttribute("aria-valuetext", "Objective");
  });
});

describe("detail item belum selesai punya CTA jalankan agen", () => {
  it("item planned: 'Lanjutkan' di detail memanggil onStart", () => {
    const onStart = vi.fn();
    screenWith([spec({ id: "SPEC-2", title: "wip", stage: "planned" })], { onStart });
    fireEvent.click(screen.getByText("wip"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Lanjutkan" }));
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

  it("item selesai tak menampilkan CTA jalankan agen di detail", () => {
    screenWith([spec({ id: "SPEC-4", title: "beres", stage: "done" })], { onStart: vi.fn() });
    fireEvent.click(screen.getByText("beres"));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("button", { name: "Lanjutkan" })).toBeNull();
    expect(dialog.queryByRole("button", { name: "Mulai" })).toBeNull();
    expect(dialog.getByRole("button", { name: "Buka sesi lagi" })).toBeTruthy();
  });
});

describe("kartu: satu aksi utama, sisanya di menu ⋯", () => {
  it("Dokumen, Tandai selesai, dan Review perubahan ada di menu, bukan sejajar di kartu", () => {
    screenWith([spec({ id: "SPEC-5", title: "kartu" })], { onOpenReview: vi.fn(), onMarkDone: vi.fn() });
    expect(screen.queryByRole("button", { name: "Lihat dokumen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tandai selesai" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain SPEC-5" }));
    expect(screen.getByRole("button", { name: "Lihat dokumen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tandai selesai" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review perubahan" })).toBeTruthy();
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

describe("board: hint drag terlihat di layar", () => {
  it("menjelaskan seret ke Brainstorm, bukan hanya lewat title kartu", () => {
    screenWith([spec()]);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.getByTestId("board-drag-hint")).toHaveTextContent(
      "Seret kartu dari kolom Backlog ke Brainstorm untuk memulai sesi");
  });
});

describe("tab sumber dengan istilah teknis punya keterangan", () => {
  it("tab Audit menjelaskan apa itu audit dan jalan lanjutnya", () => {
    screenWith([spec()]);
    expect(screen.queryByTestId("backlog-tab-hint")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Audit" }));
    expect(screen.getByTestId("backlog-tab-hint")).toHaveTextContent(/Audit: hasil pemeriksaan project/);
  });
});
