import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemberView, TaskView } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    listTasks: vi.fn(), createTask: vi.fn(), patchTask: vi.fn(), deleteTask: vi.fn(),
    listMembers: vi.fn(), createMember: vi.fn(), patchMember: vi.fn(), deleteMember: vi.fn(),
    getConfig: vi.fn(async () => ({ sync: { running: false } })),
  },
  ApiError: class extends Error {},
}));
// Langganan WS bukan subjek berkas ini; muat awal HTTP-lah yang diuji.
vi.mock("../src/api/live", () => ({
  useLiveTopic: () => {},
  useEventsStatus: () => ({ connected: true, since: 0, paused: false }),
}));

import { TeamScreen } from "../src/screens/TeamScreen";
import { api } from "../src/api/client";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p1", title: "Desain", detail: null, status: "backlog",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
  ...over,
});
const member = (): MemberView => ({
  id: "dena@x.id", name: "Dena", email: "dena@x.id", role: null, active: true,
  createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
});
const page = <T,>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 200 });

beforeEach(() => {
  localStorage.clear();
  // Riwayat panggilan bocor antar-test tanpa ini: `mock.calls[0]` milik test SEBELUMNYA.
  vi.clearAllMocks();
  vi.mocked(api.listMembers).mockResolvedValue(page([member()]));
  vi.mocked(api.listTasks).mockImplementation(async (p) =>
    p?.status === "backlog" ? page([task()]) : page([]));
  vi.mocked(api.patchTask).mockResolvedValue(task({ status: "done" }));
});

const projects = [{ id: "p1", name: "Project Satu" }] as never;
const view = (projectFilter = "all") => {
  const onProjectFilter = vi.fn(), onToast = vi.fn();
  render(<TeamScreen projects={projects} projectFilter={projectFilter}
    onProjectFilter={onProjectFilter} onToast={onToast} />);
  return { onProjectFilter, onToast };
};

describe("TeamScreen · toolbar", () => {
  it("semua kontrol punya nama yang bisa dipegang", async () => {
    view();
    await screen.findByTestId("team-board");
    expect(screen.getByRole("tablist", { name: "Mode tampilan" })).toBeInTheDocument();
    for (const label of ["Cari tugas", "Filter project", "Filter kolom", "Filter anggota"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /tugas baru/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^anggota$/i })).toBeInTheDocument();
  });

  /* Satu langganan & satu fetch PER KOLOM: `order` bermakna DI DALAM kolom, jadi potongan 200
     atas himpunan gabungan memotong keempat kolom di titik yang sewenang-wenang (ADR-0151). */
  it("memuat satu halaman per kolom dengan plafon 200", async () => {
    view();
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    const statuses = vi.mocked(api.listTasks).mock.calls.map((c) => c[0]!.status);
    expect(statuses.sort()).toEqual(["backlog", "doing", "done", "review"]);
    for (const c of vi.mocked(api.listTasks).mock.calls) {
      expect(c[0]!.limit).toBe(200);
      expect(c[0]!.page).toBe(1);
    }
  });

  it("penyaring project & anggota menyeberang ke query", async () => {
    view("p1");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalled());
    expect(vi.mocked(api.listTasks).mock.calls[0]![0]!.projectId).toBe("p1");
    vi.mocked(api.listTasks).mockClear();
    fireEvent.change(screen.getByLabelText("Filter anggota"), { target: { value: "dena@x.id" } });
    await waitFor(() => expect(vi.mocked(api.listTasks).mock.calls[0]![0]!.memberId).toBe("dena@x.id"));
  });

  it("sentinel 'all' tidak ikut menyeberang sebagai penyaring", async () => {
    view("all");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalled());
    expect(vi.mocked(api.listTasks).mock.calls[0]![0]!.projectId).toBeUndefined();
  });

  /* Menyaring kolom di sebuah PAPAN berarti mempersempit kolom yang tampil — dan hanya kolom
     yang tampil yang dimuat & dilanggan, jadi biaya servernya ikut mengecil. */
  it("filter kolom mempersempit papan ke satu kolom", async () => {
    view();
    await screen.findByTestId("team-col-doing");
    vi.mocked(api.listTasks).mockClear();
    fireEvent.change(screen.getByLabelText("Filter kolom"), { target: { value: "doing" } });
    await waitFor(() => expect(screen.queryByTestId("team-col-backlog")).toBeNull());
    expect(screen.getByTestId("team-col-doing")).toBeInTheDocument();
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(1));
  });
});

describe("TeamScreen · mutasi", () => {
  it("pindah kolom mengirim status & order tujuan, lalu kartunya pindah tanpa menunggu refetch", async () => {
    view();
    await screen.findByTestId("team-card-t1");
    fireEvent.change(screen.getByLabelText("Pindah kolom: Desain"), { target: { value: "done" } });
    await waitFor(() => expect(api.patchTask).toHaveBeenCalledWith("t1", { status: "done", order: 0 }));
    expect(screen.getByTestId("team-col-done")).toHaveTextContent("Desain");
  });

  it("PATCH gagal mengembalikan kartu ke kolom asal", async () => {
    vi.mocked(api.patchTask).mockRejectedValueOnce(new Error("boom"));
    const { onToast } = view();
    await screen.findByTestId("team-card-t1");
    fireEvent.change(screen.getByLabelText("Pindah kolom: Desain"), { target: { value: "done" } });
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(screen.getByTestId("team-col-backlog")).toHaveTextContent("Desain");
  });
});

describe("TeamScreen · modal", () => {
  it("Tugas baru membuka form kosong", async () => {
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("button", { name: /tugas baru/i }));
    expect(await screen.findByLabelText("Judul tugas")).toHaveValue("");
  });

  it("judul kartu membuka form berisi kartunya", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Desain" }));
    expect(await screen.findByLabelText("Judul tugas")).toHaveValue("Desain");
  });

  // Anggota dikelola DI SINI, bukan di SettingsScreen yang sudah 93 KB.
  it("Anggota membuka modal kelola anggota", async () => {
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("button", { name: /^anggota$/i }));
    expect(await screen.findByLabelText("Email anggota baru")).toBeInTheDocument();
  });
});

describe("TeamScreen · keadaan", () => {
  it("papan kosong menawarkan pintu masuk, bukan layar kosong", async () => {
    vi.mocked(api.listTasks).mockResolvedValue(page([]));
    view();
    expect(await screen.findByText(/papan tim masih kosong/i)).toBeInTheDocument();
  });

  it("muat awal gagal menawarkan coba lagi", async () => {
    vi.mocked(api.listTasks).mockRejectedValue(new Error("boom"));
    view();
    expect(await screen.findByRole("button", { name: /coba lagi/i })).toBeInTheDocument();
  });
});
