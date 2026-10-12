import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { FLOW_LABEL } from "../src/lib/labels";

const { getSchedulerState, getSchedulerQueue, putSchedulerConfig, updateProject,
  cancelSchedulerQueueItem, requeueSchedulerQueueItem, listCrons, getSettings, putSettings } = vi.hoisted(() => ({
  getSchedulerState: vi.fn(),
  getSchedulerQueue: vi.fn(),
  putSchedulerConfig: vi.fn(),
  updateProject: vi.fn(),
  cancelSchedulerQueueItem: vi.fn(),
  requeueSchedulerQueueItem: vi.fn(),
  // SPEC-646 · panel cron ikut dirender SchedulerScreen dan memuat daftarnya sendiri saat mount.
  listCrons: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 10 })),
  // Fase 3I · orkestrasi per flow dibaca dari `GET /settings` dan ditulis lewat `PUT /settings`.
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}));
vi.mock("../src/api/client", () => ({
  api: { getSchedulerState, getSchedulerQueue, putSchedulerConfig, updateProject,
    cancelSchedulerQueueItem, requeueSchedulerQueueItem, listCrons, getSettings, putSettings },
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

// Dialog konfirmasi dirender sebagai `role="dialog"`; tombol di dalamnya dicari dari situ, karena
// nama tombolnya sering sama dengan tombol pemicunya di halaman.
const inDialog = () => within(screen.getByRole("dialog"));
// Tab hub: hanya panel aktif yang terlihat bagi getByRole, jadi tiap test membuka tab yang ia uji.
const openTab = (name: RegExp) => fireEvent.click(screen.getByRole("tab", { name }));
// Chip riwayat: satu status dipilih; nama tombolnya memuat jumlah ("Gagal 1").
const pickChip = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  localStorage.clear();
  getSchedulerQueue.mockReset();
  getSchedulerQueue.mockImplementation(queueFrom(QUEUE_ROWS));
  putSchedulerConfig.mockReset();
  getSchedulerState.mockReset();
  getSettings.mockReset();
  getSettings.mockResolvedValue({ orchestration: ORCHESTRATION_DEFAULTS });
  putSettings.mockReset();
  putSettings.mockResolvedValue({});
});

describe("SchedulerScreen observabilitas (SPEC-299)", () => {
  it("tab Antre memuat antrean; sesi berjalan ada di tab Berjalan dengan penanda menunggu kamu", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    renderScreen();
    expect(await screen.findByText("Judul satu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buka terminal" })).not.toBeInTheDocument();   // tab Berjalan belum dibuka
    openTab(/^berjalan/i);
    expect(screen.getByText("Judul empat")).toBeInTheDocument();
    expect(screen.getByText(/menunggu kamu/i)).toBeInTheDocument();
  });

  it("sumber otomatis ada di Setelan, dengan keadaan terakhir dan berikutnya", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    expect(screen.getByText("Sumber otomatis")).toBeInTheDocument();
    expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Triase").length).toBeGreaterThan(0);
    expect(screen.getByText(/terakhir/)).toBeInTheDocument();
    expect(screen.getByText(/belum pernah dicek/)).toBeInTheDocument();
  });

  // Hub: tab dalam urutan Antre · Berjalan · Riwayat · Cron · Setelan (Fase 3I).
  it("urutan tab: Antre, Berjalan, Riwayat, Cron, Setelan", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    renderScreen();
    await screen.findByText("Judul satu");
    const labels = screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, "").trim());
    expect(labels).toEqual(["Antre", "Berjalan", "Riwayat", "Cron", "Setelan"]);
  });

  // Tab kosong hanya menampilkan satu baris keterangan, tanpa kartu kosong.
  it("antrean kosong tampil sebagai satu baris keterangan", async () => {
    getSchedulerState.mockResolvedValue({ ...STATE, queueCounts: { queued: 0, launched: 0, done: 0, failed: 0, canceled: 0 } });
    renderScreen();
    expect(await screen.findByText("Antrean kosong.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "antrean" })).not.toBeInTheDocument();
  });

  // Riwayat: chip hanya untuk status yang berisi; Gagal dipilih dulu karena paling perlu perhatian.
  it("Riwayat memakai chip Selesai/Gagal/Dibatalkan dan memilih Gagal lebih dulu", async () => {
    getSchedulerState.mockResolvedValue({ ...STATE, queueCounts: { ...STATE.queueCounts, canceled: 1 } });
    getSchedulerQueue.mockImplementation(queueFrom({ ...QUEUE_ROWS, canceled: [] }));
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^riwayat/i);
    expect(await screen.findByText("Judul tiga")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^gagal/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^selesai/i })).toHaveAttribute("aria-pressed", "false");
    pickChip(/^selesai/i);
    expect(await screen.findByText("Judul dua")).toBeInTheDocument();
    expect(screen.queryByText("Judul tiga")).not.toBeInTheDocument();
  });

  // Audit 1G · baris done tanpa launchedAt menampilkan alasannya, bukan 'selesai —'.
  it("baris done tanpa launchedAt menampilkan alasannya, bukan 'selesai —'", async () => {
    getSchedulerState.mockResolvedValue({ ...STATE, queueCounts: { queued: 0, launched: 0, done: 1, failed: 0, canceled: 0 } });
    getSchedulerQueue.mockImplementation(queueFrom({ done: [
      { id: "q4", specId: "SPEC-2", projectId: "a", source: "backlog", priority: "sedang", status: "done",
        sessionId: null, note: "spec sudah selesai — tak diluncurkan",
        enqueuedAt: "2026-07-22T00:00:00.000Z", launchedAt: null },
    ] }));
    renderScreen();
    await screen.findByText("Antrean kosong.");
    openTab(/^riwayat/i);
    expect(await screen.findByText(/spec sudah selesai — tak diluncurkan/)).toBeInTheDocument();
    expect(screen.queryByText(/· selesai —/)).not.toBeInTheDocument();
  });

  it("done item punya tombol Buka review deep-link /backlog/<id>", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^riwayat/i);
    pickChip(/^selesai/i);
    fireEvent.click(await screen.findByRole("button", { name: /buka review/i }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("/backlog/SPEC-2"), "_blank", "noreferrer");
    openSpy.mockRestore();
  });

  it("Buka terminal pada sesi berjalan meneruskan ID sesi", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    const onGotoTerminal = vi.fn();
    renderScreen({ onGotoTerminal });
    await screen.findByText("Judul satu");
    openTab(/^berjalan/i);
    fireEvent.click(screen.getByRole("button", { name: "Buka terminal" }));
    expect(onGotoTerminal).toHaveBeenCalledWith("spec-4");
  });

  // Audit 1G · galat memuat antrean TAMPIL sebagai galat dengan Coba lagi, bukan "Antrean kosong".
  it("galat memuat antrean tampil sebagai galat, bukan daftar kosong", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    getSchedulerQueue.mockImplementation(async (p: { status?: string } = {}) => {
      if (p.status === "queued") throw new Error("jaringan putus");
      return queueFrom(QUEUE_ROWS)(p);
    });
    renderScreen();
    expect(await screen.findByText("Gagal memuat antrean: jaringan putus")).toBeInTheDocument();
    expect(screen.queryByText("Antrean kosong.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coba lagi/i })).toBeInTheDocument();
  });

  // Audit 1G · chip Gagal & Dibatalkan yang kosong tak ditampilkan.
  it("chip Gagal dan Dibatalkan disembunyikan saat kosong", async () => {
    getSchedulerState.mockResolvedValue({ ...STATE, queueCounts: { queued: 1, launched: 0, done: 1, failed: 0, canceled: 0 } });
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^riwayat/i);
    expect(await screen.findByRole("button", { name: /^selesai/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^gagal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^dibatalkan/i })).not.toBeInTheDocument();
  });

  // Audit 1G · "Gagal" punya aksi: item dikembalikan ke antrean.
  it("baris Gagal punya aksi Antre ulang", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    requeueSchedulerQueueItem.mockResolvedValue({ ...QUEUE_ROWS.failed![0], status: "queued" });
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^riwayat/i);
    const btn = await screen.findByRole("button", { name: /antre ulang/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(requeueSchedulerQueueItem).toHaveBeenCalledWith("q3"));
  });
});

describe("SchedulerScreen kontrol (SPEC-299)", () => {
  it("Jeda minta konfirmasi dulu dan menjelaskan dampaknya; batal tak menulis apa pun", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^jeda$/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Jeda scheduler?");
    expect(inDialog().getByText(/Sesi yang sudah berjalan tidak dihentikan/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: /^batal$/i })); });
    expect(putSchedulerConfig).not.toHaveBeenCalled();
  });

  it("Jeda yang dikonfirmasi menulis paused:true", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^jeda$/i }));
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: "Jeda scheduler" })); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ paused: true })));
  });

  // Hierarki: Hentikan adalah rem darurat (danger, dipisah dari Jeda), dialognya menyebut dampak terstruktur.
  it("Hentikan minta konfirmasi dengan daftar dampak lalu menulis enabled:false", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^hentikan$/i }));
    expect(inDialog().getByText(/Antrean tetap tersimpan/)).toBeInTheDocument();
    expect(putSchedulerConfig).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: "Hentikan scheduler" })); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
  });

  // Strip status: state, kapasitas "N dari M sesi", dan kapasitas penuh dinyatakan dalam kata.
  it("strip status menampilkan state dan kapasitas sebagai bahasa biasa", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    renderScreen();
    const strip = await screen.findByRole("region", { name: "Status scheduler" });
    expect(within(strip).getByText("Berjalan")).toBeInTheDocument();
    expect(within(strip).getByText("1 dari 2 sesi")).toBeInTheDocument();
  });

  it("Simpan setelan mengirim blok config lengkap dgn perubahan maxConcurrent", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    const capInput = screen.getByLabelText(/batas sesi bersamaan/i);
    await act(async () => { fireEvent.change(capInput, { target: { value: "4" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /simpan setelan/i })); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrent: 4 })));
  });

  // Audit 1G · kolom angka boleh kosong saat diketik: tidak dipaksa ke minimum, tidak menulis apa pun.
  it("kolom angka boleh kosong saat diketik dan dijepit saat blur", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    const cap = screen.getByLabelText(/batas sesi bersamaan/i);
    fireEvent.change(cap, { target: { value: "" } });
    expect(cap).toHaveValue(null);                      // kosong, bukan dipaksa menjadi 1
    expect(putSchedulerConfig).not.toHaveBeenCalled();  // mengetik tak menyimpan
    fireEvent.change(cap, { target: { value: "0" } });
    fireEvent.blur(cap);
    expect(cap).toHaveValue(1);                         // 0 dijepit ke minimum 1
  });

  // Blur mengisi kembali nilai tersimpan bila kolom ditinggal kosong; Enter menyimpan.
  it("kosong lalu blur kembali ke nilai tersimpan; Enter menyimpan", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    const cap = screen.getByLabelText(/batas sesi bersamaan/i);
    fireEvent.change(cap, { target: { value: "" } });
    fireEvent.blur(cap);
    expect(cap).toHaveValue(2);
    fireEvent.change(cap, { target: { value: "5" } });
    await act(async () => { fireEvent.keyDown(cap, { key: "Enter" }); });
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrent: 5 })));
  });

  it("toggle izin project memanggil updateProject + onProjectChanged", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    updateProject.mockResolvedValue({ id: "a", schedulerOptIn: true });
    const onProjectChanged = vi.fn();
    renderScreen({ onProjectChanged });
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    const btn = await screen.findByRole("button", { name: /^izinkan$/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("a", { schedulerOptIn: true }));
    await waitFor(() => expect(onProjectChanged).toHaveBeenCalledWith("a"));
  });
});

describe("SchedulerScreen orkestrasi (Fase 3I · accordion di Setelan)", () => {
  it("flow orkestrasi tertutup secara default dan tersimpan saat switch-nya diubah", async () => {
    getSchedulerState.mockResolvedValue(STATE);
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    const head = await screen.findByRole("button", { name: new RegExp(`^${FLOW_LABEL.feature}`) });
    expect(head).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    const sw = await screen.findByRole("switch", { name: "Orkestrasi feature" });
    const before = ORCHESTRATION_DEFAULTS.feature.enabled;
    await act(async () => { fireEvent.click(sw); });
    await waitFor(() => expect(putSettings).toHaveBeenCalledWith(expect.objectContaining({
      orchestration: expect.objectContaining({ feature: expect.objectContaining({ enabled: !before }) }),
    })));
  });
});

describe("SchedulerScreen launch guard (SPEC-1108)", () => {
  it.each(["unsupported", "unavailable"])("shows missing load as unavailable: %s", async (loadStatus) => {
    getSchedulerState.mockResolvedValue({ ...STATE, admission: {
      enabled: true, liveCount: 6, liveAgentCount: 4, maxConcurrent: 6,
      loadPerCore: null, maxLoadPerCore: 2.5, loadStatus,
      memAvailablePct: 50, minMemAvailablePct: 15, memStatus: "available",
    } });
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    const status = await screen.findByLabelText("Status pemeriksaan peluncuran");
    expect(status).toHaveTextContent("6 dari batas 6 sesi berjalan");
    expect(status).toHaveTextContent("4 di antaranya agen");
    expect(status).toHaveTextContent(/beban cpu per inti: tidak tersedia/i);
    expect(status).not.toHaveTextContent(/beban cpu per inti: 0/i);
    expect(status).toHaveTextContent("batas 2.5");
  });

  it("saves guard knobs while scheduler and sources are disabled", async () => {
    const config = { ...STATE.config, enabled: false,
      launchGuard: { enabled: true, maxLoadPerCore: 2.5, minMemAvailablePct: 15 },
      sources: { backlog: { enabled: false, everyMin: 15 }, triase: { enabled: false, everyMin: 30 } } };
    getSchedulerState.mockResolvedValue({ ...STATE, config });
    putSchedulerConfig.mockResolvedValue(config);
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    const guard = await screen.findByRole("switch", { name: "Tahan peluncuran saat server sibuk" });
    expect(guard).toBeEnabled();
    fireEvent.click(guard);
    fireEvent.change(screen.getByLabelText("Batas beban CPU per inti"), { target: { value: "1.75" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan setelan/i }));
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false, launchGuard: { enabled: false, maxLoadPerCore: 1.75, minMemAvailablePct: 15 },
    })));
  });

  // Audit 1G · menyimpan setelan memakai `enabled`/`paused` TERBARU, bukan draft yang sudah basi:
  // setelan tak pernah membatalkan Jeda/Hentikan yang baru ditekan.
  it("menyimpan setelan tak membatalkan Jeda yang sudah berlaku", async () => {
    getSchedulerState.mockResolvedValue({ ...STATE, config: { ...STATE.config, paused: true } });
    putSchedulerConfig.mockResolvedValue(STATE.config);
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^setelan/i);
    fireEvent.change(screen.getByLabelText(/batas sesi bersamaan/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan setelan/i }));
    await waitFor(() => expect(putSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ paused: true, maxConcurrent: 3 })));
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
    cancelSchedulerQueueItem.mockResolvedValue({ ...QUEUE_ROWS.queued![0], status: "canceled" });
    renderScreen();
    const btn = await screen.findByRole("button", { name: /batalkan/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(cancelSchedulerQueueItem).toHaveBeenCalledWith("q1"));
  });

  it("Riwayat Dibatalkan merender alasannya dan tombol Antre lagi mengembalikannya", async () => {
    // SPEC-523 · barisnya datang dari GET /scheduler/queue?status=canceled, bukan dari `state`.
    getSchedulerState.mockResolvedValue({ ...STATE, queueCounts: { ...STATE.queueCounts, canceled: 1, failed: 0 } });
    getSchedulerQueue.mockImplementation(queueFrom({ ...QUEUE_ROWS, canceled: [canceledRow] }));
    requeueSchedulerQueueItem.mockResolvedValue({ ...canceledRow, status: "queued", note: null });
    renderScreen();
    await screen.findByText("Judul satu");
    openTab(/^riwayat/i);
    pickChip(/^dibatalkan/i);
    expect(await screen.findByText(/dibatalkan operator: salah project/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /antre lagi/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(requeueSchedulerQueueItem).toHaveBeenCalledWith("q5"));
  });

  // Kendala spec: item bersesi aktif tak dibunuh. Penolakan 409 membawa satu-satunya kalimat yang
  // berguna ("sesinya sudah berjalan — tutup dari Terminal"); menampilkan "gagal" saja
  // menyembunyikannya dan operator tak tahu harus ke mana.
  it("penolakan 409 menampilkan pesan server apa adanya", async () => {
    getSchedulerState.mockResolvedValue(STATE);
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
