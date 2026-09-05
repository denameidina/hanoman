import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSchedulerState, getSchedulerQueue, putSchedulerConfig, updateProject,
  cancelSchedulerQueueItem, requeueSchedulerQueueItem, listCrons } = vi.hoisted(() => ({
  getSchedulerState: vi.fn(),
  getSchedulerQueue: vi.fn(),
  putSchedulerConfig: vi.fn(),
  updateProject: vi.fn(),
  cancelSchedulerQueueItem: vi.fn(),
  requeueSchedulerQueueItem: vi.fn(),
  // SPEC-646 · panel cron ikut dirender SchedulerScreen dan memuat daftarnya sendiri saat mount.
  listCrons: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 10 })),
}));
vi.mock("../src/api/client", () => ({
  api: { getSchedulerState, getSchedulerQueue, putSchedulerConfig, updateProject,
    cancelSchedulerQueueItem, requeueSchedulerQueueItem, listCrons },
  ApiError: class extends Error {},
}));

import { SchedulerScreen } from "../src/screens/SchedulerScreen";

const STATE = {
  config: { enabled: true, paused: false, maxConcurrent: 2, autonomy: "butuh-keputusan",
    sources: { backlog: { enabled: true, everyMin: 15 }, triase: { enabled: false, everyMin: 30 } } },
  cap: 2, liveCount: 1,
  sources: [
    { id: "backlog", enabled: true, everyMin: 15, lastRunAt: "2026-07-22T00:00:00.000Z", nextRunAt: "2026-07-22T00:15:00.000Z" },
    { id: "triase", enabled: false, everyMin: 30, lastRunAt: null, nextRunAt: null },
  ],
  // SPEC-523 · state hanya membawa hitungan; barisnya datang dari GET /scheduler/queue.
  queueCounts: { queued: 1, launched: 0, done: 1, failed: 1, canceled: 0 },
  sessions: [
    { id: "spec-4", projectId: "a", specId: "SPEC-4", flow: "feature", branch: "hanoman/spec-4", decision: true, exited: false },
  ],
};
// SPEC-523 · baris antrean per status, dilayani endpoint daftar berhalaman.
const QUEUE_ROWS: Record<string, Array<Record<string, unknown>>> = {
  queued: [{ id: "q1", specId: "SPEC-1", projectId: "a", source: "backlog", priority: "tinggi", status: "queued", sessionId: null, note: null, enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: null }],
  done: [{ id: "q2", specId: "SPEC-2", projectId: "a", source: "triase", priority: "tinggi", status: "done", sessionId: "spec-2", note: null, enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: "2026-07-22T00:01:00.000Z" }],
  failed: [{ id: "q3", specId: "SPEC-3", projectId: "a", source: "triase", priority: "sedang", status: "failed", sessionId: "spec-3", note: "sesi berakhir sebelum done", enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: "2026-07-22T00:01:00.000Z" }],
};
const queueFrom = (rows: Record<string, Array<Record<string, unknown>>>) =>
  async (p: { status?: string } = {}) => {
    const items = rows[p.status ?? ""] ?? [];
    return { items, total: items.length, page: 1, pageSize: 10 };
  };

const projects = [{ id: "a", name: "Alpha", schedulerOptIn: false }] as unknown as Parameters<typeof SchedulerScreen>[0]["projects"];
const backlog = [
  { id: "SPEC-1", title: "Judul satu" }, { id: "SPEC-2", title: "Judul dua" },
  { id: "SPEC-3", title: "Judul tiga" }, { id: "SPEC-4", title: "Judul empat" },
] as unknown as Parameters<typeof SchedulerScreen>[0]["backlog"];

function renderScreen(overrides: Partial<Parameters<typeof SchedulerScreen>[0]> = {}) {
  return render(<SchedulerScreen projects={projects} backlog={backlog}
    onProjectChanged={vi.fn()} onToast={vi.fn()} onGotoTerminal={vi.fn()} {...overrides} />);
}

describe("SchedulerScreen observabilitas (SPEC-299)", () => {
  it("menampilkan status per-source, antrean, sesi berjalan, done, dan gagal+alasan", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    getSchedulerQueue.mockImplementation(queueFrom(QUEUE_ROWS));
    renderScreen();
    // status per-source (id source muncul ≥1×)
    expect(await screen.findByText("Status per source")).toBeInTheDocument();
    expect(screen.getAllByText("backlog").length).toBeGreaterThan(0);
    expect(screen.getAllByText("triase").length).toBeGreaterThan(0);
    // antrean (queued) → judul spec ter-resolve. SPEC-523 · barisnya datang dari permintaan
    // KEDUA (GET /scheduler/queue), jadi ditunggu — bukan dibaca sinkron sesudah state mendarat.
    expect(await screen.findByText("Judul satu")).toBeInTheDocument();
    // sesi berjalan + indikator menunggu keputusan
    expect(screen.getByText("Judul empat")).toBeInTheDocument();
    expect(screen.getByText(/menunggu keputusan/i)).toBeInTheDocument();
    // done + gagal + alasan
    expect(await screen.findByText("Judul dua")).toBeInTheDocument();
    expect(await screen.findByText("Judul tiga")).toBeInTheDocument();
    expect(screen.getByText(/sesi berakhir sebelum done/i)).toBeInTheDocument();
  });

  // SPEC-431 · baris yang ditutup gerbang "spec sudah selesai" tak pernah punya `launchedAt`, dan
  // dulu terbaca "selesai —" seolah scheduler-lah yang menyelesaikannya — salah baca yang persis
  // searah dengan bug yang sedang diperbaiki.
  it("baris done tanpa launchedAt menampilkan alasannya, bukan 'selesai —'", async () => {
    getSchedulerState.mockResolvedValue({ ...STATE, queueCounts: { queued: 0, launched: 0, done: 1, failed: 0, canceled: 0 } });
    getSchedulerQueue.mockImplementation(queueFrom({ done: [
      { id: "q4", specId: "SPEC-2", projectId: "a", source: "backlog", priority: "sedang", status: "done",
        sessionId: null, note: "spec sudah selesai — tak diluncurkan",
        enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: null },
    ] }));
    renderScreen();
    expect(await screen.findByText(/spec sudah selesai — tak diluncurkan/)).toBeInTheDocument();
    expect(screen.queryByText(/· selesai —/)).not.toBeInTheDocument();
  });

  it("done item punya tombol Buka review deep-link /backlog/<id>", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    getSchedulerQueue.mockImplementation(queueFrom(QUEUE_ROWS));
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderScreen();
    const btn = await screen.findByRole("button", { name: /buka review/i });
    fireEvent.click(btn);
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("/backlog/SPEC-2"), "_blank", "noreferrer");
    openSpy.mockRestore();
  });

  it("Buka terminal pada sesi berjalan meneruskan ID sesi", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    getSchedulerQueue.mockImplementation(queueFrom(QUEUE_ROWS));
    const onGotoTerminal = vi.fn();
    renderScreen({ onGotoTerminal });

    fireEvent.click(await screen.findByRole("button", { name: "Buka terminal" }));

    expect(onGotoTerminal).toHaveBeenCalledWith("spec-4");
  });
});

describe("SchedulerScreen kontrol (SPEC-299)", () => {
  beforeEach(() => { getSchedulerQueue.mockImplementation(queueFrom(QUEUE_ROWS)); });
  it("tombol Pause menulis paused:true via putSchedulerConfig", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    const btn = await screen.findByRole("button", { name: /^pause$/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ paused: true })));
  });

  it("tombol Stop menulis enabled:false", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    const btn = await screen.findByRole("button", { name: /^stop$/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
  });

  it("Simpan setelan mengirim blok config lengkap dgn perubahan maxConcurrent", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    await screen.findByText("Status per source");
    const capInput = screen.getByLabelText(/cap concurrent/i);
    await act(async () => { fireEvent.change(capInput, { target: { value: "4" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /simpan setelan/i })); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrent: 4 })));
  });

  it("toggle opt-in project memanggil updateProject + onProjectChanged", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    updateProject.mockResolvedValue({ id: "a", schedulerOptIn: true });
    const onProjectChanged = vi.fn();
    renderScreen({ onProjectChanged });
    const btn = await screen.findByRole("button", { name: /opt-in/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("a", { schedulerOptIn: true }));
    await waitFor(() => expect(onProjectChanged).toHaveBeenCalledWith("a"));
  });
});

describe("SchedulerScreen launch guard (SPEC-1108)", () => {
  beforeEach(() => { getSchedulerQueue.mockImplementation(queueFrom(QUEUE_ROWS)); });

  it.each(["unsupported", "unavailable"])("shows missing load as unavailable: %s", async (loadStatus) => {
    getSchedulerState.mockResolvedValue({ ...STATE, admission: {
      enabled: true, liveCount: 6, liveAgentCount: 4, maxConcurrent: 6,
      loadPerCore: null, maxLoadPerCore: 2.5, loadStatus,
    } });
    renderScreen();
    const status = await screen.findByLabelText("Status gerbang peluncuran");
    expect(status).toHaveTextContent("6 sesi hidup");
    expect(status).toHaveTextContent("4 agen");
    expect(status).toHaveTextContent("cap 6");
    expect(status).toHaveTextContent(/load per core: tidak tersedia/i);
    expect(status).not.toHaveTextContent(/load per core: 0/);
    expect(status).toHaveTextContent("ambang 2.5");
  });

  it("saves guard knobs while scheduler and sources are disabled", async () => {
    const config = { ...STATE.config, enabled: false,
      launchGuard: { enabled: true, maxLoadPerCore: 2.5 },
      sources: { backlog: { enabled: false, everyMin: 15 }, triase: { enabled: false, everyMin: 30 } } };
    getSchedulerState.mockResolvedValue({ ...STATE, config });
    putSchedulerConfig.mockResolvedValue(config);
    renderScreen();
    const guard = await screen.findByRole("switch", { name: "Gerbang peluncuran" });
    expect(guard).toBeEnabled();
    fireEvent.click(guard);
    fireEvent.change(screen.getByLabelText("Ambang load per core"), { target: { value: "1.75" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan setelan/i }));
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false, launchGuard: { enabled: false, maxLoadPerCore: 1.75 },
    })));
  });
});

describe("SchedulerScreen pembatalan antrean (SPEC-522)", () => {
  const canceledRow = {
    id: "q5", specId: "SPEC-5", projectId: "a", source: "backlog", priority: "sedang",
    status: "canceled", sessionId: null, note: "dibatalkan operator: salah project",
    enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: null,
  };

  it("tombol Batalkan pada baris antrean memanggil cancelSchedulerQueueItem", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    getSchedulerQueue.mockImplementation(queueFrom(QUEUE_ROWS));
    cancelSchedulerQueueItem.mockResolvedValue({ ...QUEUE_ROWS.queued![0], status: "canceled" });
    renderScreen();
    const btn = await screen.findByRole("button", { name: /batalkan/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(cancelSchedulerQueueItem).toHaveBeenCalledWith("q1"));
  });

  it("seksi Dibatalkan merender alasannya dan tombol Antre lagi mengembalikannya", async () => {
    // SPEC-523 · barisnya datang dari GET /scheduler/queue?status=canceled, bukan dari `state`.
    getSchedulerState.mockResolvedValue({ ...STATE, queueCounts: { ...STATE.queueCounts, canceled: 1 } });
    getSchedulerQueue.mockImplementation(queueFrom({ ...QUEUE_ROWS, canceled: [canceledRow] }));
    requeueSchedulerQueueItem.mockResolvedValue({ ...canceledRow, status: "queued", note: null });
    renderScreen();
    expect(await screen.findByText("Dibatalkan · 1")).toBeInTheDocument();
    expect(screen.getByText(/dibatalkan operator: salah project/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /antre lagi/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(requeueSchedulerQueueItem).toHaveBeenCalledWith("q5"));
  });

  // Kendala spec: item bersesi aktif tak dibunuh. Penolakan 409 membawa satu-satunya kalimat yang
  // berguna ("sesinya sudah berjalan — tutup dari Terminal"); menampilkan "gagal" saja
  // menyembunyikannya dan operator tak tahu harus ke mana.
  it("penolakan 409 menampilkan pesan server apa adanya", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    getSchedulerQueue.mockImplementation(queueFrom(QUEUE_ROWS));
    cancelSchedulerQueueItem.mockRejectedValue(Object.assign(new Error("409"), {
      detail: { error: "tak bisa membatalkan: sesinya sudah berjalan — tutup dari Terminal bila memang tak diperlukan", status: "launched" },
    }));
    const onToast = vi.fn();
    renderScreen({ onToast });
    const btn = await screen.findByRole("button", { name: /batalkan/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("sesinya sudah berjalan"), "err", "x-circle"));
  });
});
