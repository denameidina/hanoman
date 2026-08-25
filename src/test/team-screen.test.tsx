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

import { TeamScreen, TEAM_VIEWS } from "../src/screens/TeamScreen";
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

/* Invariant yang dijanjikan spec & ADR-0151: kartu mendarat di UJUNG kolom tujuan, dan `order`
   naik monoton per kolom supaya item D/E bisa membacanya apa adanya. Drag menghitungnya lewat
   `nextOrder`; modal HARUS memakai perhitungan yang sama, kalau tidak "buat" menaruh kartu di ATAS
   sementara "drag" menaruhnya di BAWAH — dua aturan untuk satu tindakan, nol error. */
describe("TeamScreen · order kartu dari modal", () => {
  it("tugas baru mendarat di UJUNG kolom tujuan, bukan di order 0", async () => {
    // Kolom backlog sudah berisi satu kartu ber-order 4 → kartu baru harus lahir ber-order 5.
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([task({ order: 4 })]) : page([]));
    vi.mocked(api.createTask).mockResolvedValue(task({ id: "baru" }));
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("button", { name: /tugas baru/i }));
    fireEvent.change(await screen.findByLabelText("Judul tugas"), { target: { value: "Kartu baru" } });
    fireEvent.click(screen.getByRole("button", { name: /buat tugas/i }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(vi.mocked(api.createTask).mock.calls[0]![0]).toMatchObject({ status: "backlog", order: 5 });
  });

  it("ganti kolom lewat modal memakai order kolom BARU, bukan order kolom lama", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([task({ order: 4 })])
        : p?.status === "done" ? page([task({ id: "d1", title: "Sudah beres", status: "done", order: 9 })])
        : page([]));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Desain" }));
    fireEvent.change(await screen.findByLabelText("Kolom tugas"), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(api.patchTask).toHaveBeenCalled());
    expect(vi.mocked(api.patchTask).mock.calls[0]![1]).toMatchObject({ status: "done", order: 10 });
  });

  it("menyimpan tanpa memindah kolom TIDAK menyentuh order", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Desain" }));
    fireEvent.change(await screen.findByLabelText("Judul tugas"), { target: { value: "Desain v2" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(api.patchTask).toHaveBeenCalled());
    // Kartu yang cuma diganti judulnya tak boleh terlempar ke ujung kolomnya sendiri.
    expect(vi.mocked(api.patchTask).mock.calls[0]![1]).not.toHaveProperty("order");
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

/* SPEC-948 · mode kedua. Datanya `board` yang SUDAH dimuat mode Papan — berpindah mode tak boleh
   melahirkan satu pun request baru. */
describe("TeamScreen · mode Linimasa", () => {
  const dated = () => task({ id: "t1", title: "Desain", startDate: "2026-09-10T12:00:00.000Z" });

  it("tab Linimasa ada dan memilihnya mengganti papan dengan kanvas", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([dated()]) : page([]));
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("tab", { name: /linimasa/i }));
    expect(await screen.findByTestId("team-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("team-board")).toBeNull();
  });

  it("berpindah mode tidak memuat ulang data", async () => {
    view();
    await screen.findByTestId("team-board");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    vi.mocked(api.listTasks).mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /linimasa/i }));
    await screen.findByTestId("team-timeline");
    expect(api.listTasks).not.toHaveBeenCalled();
  });

  it("Select zoom hanya hidup di mode Linimasa", async () => {
    view();
    await screen.findByTestId("team-board");
    expect(screen.queryByLabelText("Zoom linimasa")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /linimasa/i }));
    const zoom = await screen.findByLabelText("Zoom linimasa");
    expect((zoom as HTMLSelectElement).value).toBe("week");
  });

  it("ganti zoom mengubah kerapatan sumbu tanpa menyentuh server", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog"
        ? page([task({ startDate: "2026-09-01T12:00:00.000Z", dueDate: "2026-11-30T12:00:00.000Z" })])
        : page([]));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /linimasa/i }));
    await screen.findByTestId("team-timeline");
    const minggu = screen.getAllByTestId("timeline-tick").length;
    vi.mocked(api.listTasks).mockClear();
    fireEvent.change(screen.getByLabelText("Zoom linimasa"), { target: { value: "day" } });
    await waitFor(() => expect(screen.getAllByTestId("timeline-tick").length).toBeGreaterThan(minggu));
    expect(api.listTasks).not.toHaveBeenCalled();
  });

  it("penyaring kolom ikut mempersempit linimasa", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog"
        ? page([task({ id: "b1", title: "Di backlog", startDate: "2026-09-10T12:00:00.000Z" })])
        : p?.status === "doing"
          ? page([task({ id: "d1", title: "Dikerjakan", status: "doing", startDate: "2026-09-10T12:00:00.000Z" })])
          : page([]));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /linimasa/i }));
    await screen.findByTestId("timeline-bar-b1");
    fireEvent.change(screen.getByLabelText("Filter kolom"), { target: { value: "doing" } });
    await waitFor(() => expect(screen.queryByTestId("timeline-bar-b1")).toBeNull());
    expect(screen.getByTestId("timeline-bar-d1")).toBeInTheDocument();
  });

  it("klik batang membuka kartunya di modal yang sama", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([dated()]) : page([]));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /linimasa/i }));
    fireEvent.click(await screen.findByTestId("timeline-bar-t1"));
    expect(await screen.findByLabelText("Judul tugas")).toHaveValue("Desain");
  });
});

/* SPEC-949 · mode ketiga. Berbeda dari mode Linimasa, mode ini MELEPAS penyaring project — jadi
   satu-satunya mode yang boleh melahirkan request saat berpindah, dan hanya saat penyaringnya
   memang sedang aktif. */
describe("TeamScreen · mode Lintas project", () => {
  const dated = () => task({ id: "t1", title: "Desain", startDate: "2026-09-10T12:00:00.000Z" });
  const projectSelect = () => screen.getByLabelText("Filter project") as HTMLSelectElement;

  it("tab Lintas project ada dan memilihnya mengganti papan dengan kanvasnya", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([dated()]) : page([]));
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("tab", { name: /lintas project/i }));
    expect(await screen.findByTestId("team-projects")).toBeInTheDocument();
    expect(screen.queryByTestId("team-board")).toBeNull();
    expect(screen.queryByTestId("team-timeline")).toBeNull();
  });

  it("penyaring project MATI di mode ini dan hidup lagi saat pindah, nilainya tak berubah", async () => {
    const { onProjectFilter } = view("p1");
    await screen.findByTestId("team-board");
    expect(projectSelect().disabled).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("team-projects");
    expect(projectSelect().disabled).toBe(true);
    // Nilainya milik App dan dipakai bersama Backlog (SPEC-146) — menulisnya di sini mengubah apa
    // yang dilihat layar LAIN.
    expect(projectSelect().value).toBe("p1");
    expect(onProjectFilter).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: /^papan$/i }));
    await screen.findByTestId("team-board");
    expect(projectSelect().disabled).toBe(false);
  });

  it("dengan penyaring project aktif, masuk ke mode ini memuat ulang TANPA projectId", async () => {
    view("p1");
    await screen.findByTestId("team-board");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    expect(vi.mocked(api.listTasks).mock.calls[0]![0]!.projectId).toBe("p1");

    vi.mocked(api.listTasks).mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("team-projects");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    for (const c of vi.mocked(api.listTasks).mock.calls) {
      expect(c[0]!.projectId).toBeUndefined();
    }
  });

  it("tanpa penyaring project aktif, berpindah ke mode ini TIDAK memuat ulang", async () => {
    view();
    await screen.findByTestId("team-board");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    vi.mocked(api.listTasks).mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("team-projects");
    expect(api.listTasks).not.toHaveBeenCalled();
  });

  it("Select zoom hidup di mode ini juga", async () => {
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("team-projects");
    expect(screen.getByLabelText("Zoom linimasa")).toBeInTheDocument();
  });

  it("buka baris project memunculkan task-nya", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([dated()]) : page([]));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("timeline-row-p:p1");
    expect(screen.queryByTestId("timeline-row-t:t1")).toBeNull();
    fireEvent.click(screen.getByTestId("expand-p1"));
    expect(await screen.findByTestId("timeline-row-t:t1")).toBeInTheDocument();
  });
});

/* Cermin `TEAM_VIEWS` ↔ cabang render. Kelas bug yang dijaga `changelog-nav.test.tsx` untuk
   `HN_NAV`: entri yang tak punya cabangnya sendiri merender permukaan mode LAIN di bawah pilnya —
   200, nol error, dan tak ada yang menyadarinya. SPEC-948 adalah entri KEDUA, yaitu saat cermin
   ini lahir; item E yang menambahkan entri ketiga harus lewat sini dengan sadar. */
describe("TeamScreen · kontrak mode tampilan", () => {
  const SURFACES = ["team-board", "team-timeline", "team-projects"];

  it("tiap mode TEAM_VIEWS merender permukaannya SENDIRI, tak ada dua yang berbagi", async () => {
    view();
    await screen.findByTestId("team-board");
    const rendered = new Map<string, string>();
    for (const v of TEAM_VIEWS) {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${v.label}$`, "i") }));
      const hit = SURFACES.filter((id) => screen.queryByTestId(id));
      expect(hit, `mode "${v.value}" tak merender satu pun permukaan yang dikenal — `
        + "tambahkan cabangnya di TeamScreen DAN testid-nya ke SURFACES").toHaveLength(1);
      rendered.set(v.value, hit[0]!);
    }
    expect(new Set(rendered.values()).size,
      `dua mode berbagi permukaan yang sama: ${JSON.stringify([...rendered])}`)
      .toBe(TEAM_VIEWS.length);
  });
});
