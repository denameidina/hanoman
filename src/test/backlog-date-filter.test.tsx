import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import type { Spec } from "../src/screens/types";

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
     createdAt: "2026-07-01T00:00:00.000Z", startedAt: null, ...over }) as Spec;

const envelope = (items: Spec[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const lastCall = () => vi.mocked(api.listSpecs).mock.calls.at(-1)![0]!;

// Rentang tanggal ada di popover "Filter" (progressive disclosure): buka dulu.
const openFilter = () => fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));

function backlog(items: Spec[] = [spec()]) {
  vi.mocked(api.listSpecs).mockResolvedValue(envelope(items));
  render(<BacklogScreen backlog={items} projects={[{ id: "p", name: "p" }] as never}
    projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} />);
  openFilter();
}

beforeEach(() => { vi.mocked(api.listSpecs).mockReset(); });

// SPEC-408 · ADR-0090 · filter dikirim ke server (ADR-0038: penyaringan di layer response),
// jadi yang diuji adalah PARAM yang menyeberang, bukan jumlah baris yang dirender klien.
describe("filter rentang tanggal backlog (SPEC-408)", () => {
  it("tiga kontrolnya ada di popover Filter", () => {
    backlog();
    expect(screen.getByLabelText("Filter tanggal berdasarkan")).toBeTruthy();
    expect(screen.getByLabelText("Tanggal dari")).toBeTruthy();
    expect(screen.getByLabelText("Tanggal sampai")).toBeTruthy();
  });

  it("tanpa tanggal terisi, tak ada param tanggal yang dikirim", async () => {
    backlog();
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(lastCall().from).toBeUndefined();
    expect(lastCall().to).toBeUndefined();
    expect(lastCall().dateField).toBeUndefined();
  });

  it("mengisi dari+sampai mengirim from/to/dateField", async () => {
    backlog();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("Tanggal sampai"), { target: { value: "2026-07-31" } });
    await waitFor(() => expect(lastCall().to).toBe("2026-07-31"));
    expect(lastCall().from).toBe("2026-07-01");
    expect(lastCall().dateField).toBe("created");
  });

  it("memilih Dikerjakan mengubah sumbu yang dikirim", async () => {
    backlog();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("Filter tanggal berdasarkan"), { target: { value: "started" } });
    await waitFor(() => expect(lastCall().dateField).toBe("started"));
    expect(lastCall().from).toBe("2026-07-01");
  });

  it("satu batas saja sudah mengaktifkan filter", async () => {
    backlog();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    await waitFor(() => expect(lastCall().from).toBe("2026-07-01"));
    expect(lastCall().to).toBeUndefined();
    expect(lastCall().dateField).toBe("created");
  });

  it("rentang aktif tampil sebagai chip yang bisa dilepas", () => {
    backlog();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    expect(screen.getByRole("button", { name: /Hapus filter Tanggal dibuat/ })).toBeInTheDocument();
  });

  it("Reset filter mengosongkan tanggal DAN mengembalikan sumbu ke Dibuat", async () => {
    // server mengembalikan 0 item → StateBlock "Tidak ada spec untuk filter ini" muncul
    // (prop `backlog` tetap terisi). Reset ada di baris chip DAN di StateBlock: ambil yang pertama.
    vi.mocked(api.listSpecs).mockResolvedValue(envelope([]));
    render(<BacklogScreen backlog={[spec()]} projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} />);
    openFilter();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("Filter tanggal berdasarkan"), { target: { value: "started" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Reset filter" }))[0]!);
    expect((screen.getByLabelText("Tanggal dari") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Filter tanggal berdasarkan") as HTMLSelectElement).value).toBe("created");
    await waitFor(() => expect(lastCall().from).toBeUndefined());
  });
});
