import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SchedulerCrons } from "./SchedulerCrons";

const cron = (over: Record<string, unknown> = {}) => ({
  id: "c1", projectId: "p1", name: "Cek error pagi", expr: "0 7 * * *",
  prompt: "Periksa error produksi.", agent: null, model: null, effort: null, enabled: true,
  nextRunAt: "2026-08-12T00:00:00.000Z", lastRunAt: "2026-08-11T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z", ...over,
});

const listCrons = vi.fn(async (..._a: unknown[]) => ({ items: [cron()], total: 1, page: 1, pageSize: 10 }));
const listCronRuns = vi.fn(async (..._a: unknown[]) => ({
  items: [{
    id: "r1", cronId: "c1", projectId: "p1", dueAt: "2026-08-11T00:00:00.000Z",
    startedAt: null, status: "skipped", sessionId: null, note: "cap penuh — tak ada slot sesi",
    manual: false, createdAt: "2026-08-11T00:00:00.000Z",
  }],
  total: 1, page: 1, pageSize: 10,
}));
const listCronReports = vi.fn(async (..._a: unknown[]) => ({ items: [], total: 0, page: 1, pageSize: 10 }));
const createCron = vi.fn(async (..._a: unknown[]) => cron({ id: "c2" }));
const runCronNow = vi.fn(async (..._a: unknown[]) => ({ id: "r2" }));
const updateProject = vi.fn(async (..._a: unknown[]) => ({}));
const deleteCron = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("../api/client", () => ({
  api: {
    listCrons: (...a: unknown[]) => listCrons(...a),
    listCronRuns: (...a: unknown[]) => listCronRuns(...a),
    listCronReports: (...a: unknown[]) => listCronReports(...a),
    createCron: (...a: unknown[]) => createCron(...a),
    patchCron: vi.fn(async () => cron()),
    deleteCron: (...a: unknown[]) => deleteCron(...a),
    runCronNow: (...a: unknown[]) => runCronNow(...a),
    updateProject: (...a: unknown[]) => updateProject(...a),
  },
}));

const projects = [{ id: "p1", name: "P1", schedulerOptIn: true }] as never;
const props = { projects, onProjectChanged: vi.fn(), onToast: vi.fn() };

beforeEach(() => { vi.clearAllMocks(); });

// Fase 3I · setiap aksi cron ada di menu ⋯ barisnya (tabel/kartu), bukan tombol sebaris.
const openRowMenu = (name = "Cek error pagi") => fireEvent.click(screen.getByRole("button", { name: `Aksi untuk cron ${name}` }));
const menuItem = (name: RegExp | string) => fireEvent.click(screen.getByRole("menuitem", { name }));

describe("SchedulerCrons", () => {
  it("menampilkan cron dengan jadwal terbaca manusia", async () => {
    render(<SchedulerCrons {...props} />);
    expect(await screen.findByText("Cek error pagi")).toBeTruthy();
    expect(screen.getByText(/setiap hari 07:00/)).toBeTruthy();
  });

  it("form baru menampilkan preview 'jalan berikutnya' dari preset", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    expect(await screen.findByLabelText("Nama cron")).toBeTruthy();
    expect(screen.getByTestId("cron-next-preview").textContent).toMatch(/\d{2}[.:]\d{2}/);
  });

  it("mengubah preset ke lanjutan memperlihatkan kolom cron expression", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    fireEvent.change(await screen.findByLabelText("Preset jadwal"), { target: { value: "lanjutan" } });
    expect(screen.getByLabelText("Ekspresi cron")).toBeTruthy();
  });

  it("menyimpan cron baru lewat api.createCron dengan expr hasil preset", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    fireEvent.change(await screen.findByLabelText("Nama cron"), { target: { value: "Audit docs" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Audit docs." } });
    fireEvent.change(screen.getByLabelText("Jam"), { target: { value: "09:30" } });
    fireEvent.click(screen.getByRole("button", { name: /^Simpan$/ }));
    await waitFor(() => expect(createCron).toHaveBeenCalled());
    expect(createCron.mock.calls[0]![0]).toMatchObject({ name: "Audit docs", expr: "30 9 * * *", project: "p1" });
  });

  it("menu ⋯ berisi Ubah, Jalankan sekarang, Riwayat, dan Hapus", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    openRowMenu();
    const dialog = screen.getByRole("dialog", { name: "Cek error pagi" });
    for (const name of ["Ubah", "Jalankan sekarang", "Riwayat", "Hapus"]) {
      expect(within(dialog).getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("menu Jalankan sekarang memanggil api.runCronNow", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    openRowMenu();
    menuItem("Jalankan sekarang");
    await waitFor(() => expect(runCronNow).toHaveBeenCalledWith("c1"));
  });

  it("riwayat run menampilkan hasil beserta alasannya", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    openRowMenu();
    menuItem("Riwayat");
    expect(await screen.findByText(/cap penuh/)).toBeTruthy();
  });

  it("project belum opt-in: peringatan + tombol opt-in inline", async () => {
    render(<SchedulerCrons {...props} projects={[{ id: "p1", name: "P1", schedulerOptIn: false }] as never} />);
    await screen.findByText("Cek error pagi");
    expect(screen.getByText(/belum diizinkan/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Aktifkan scheduler di project ini/ }));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("p1", { schedulerOptIn: true }));
  });

  // Audit 1G · hapus cron = hard delete, jadi minta konfirmasi lebih dulu dan menyebut dampaknya.
  it("hapus cron meminta konfirmasi dulu dan baru menghapus setelah disetujui", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    openRowMenu();
    menuItem("Hapus");
    expect(screen.getByRole("dialog")).toHaveTextContent("Hapus cron ini?");
    expect(screen.getByRole("dialog")).toHaveTextContent("tidak bisa dibatalkan");
    expect(deleteCron).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hapus cron" }));
    await waitFor(() => expect(deleteCron).toHaveBeenCalledWith("c1"));
  });

  // Audit 1G · galat memuat daftar TAMPIL sebagai galat dengan Coba lagi, bukan "Belum ada cron".
  it("galat memuat daftar cron tampil sebagai galat, bukan daftar kosong", async () => {
    listCrons.mockRejectedValueOnce(new Error("404"));
    render(<SchedulerCrons {...props} />);
    expect(await screen.findByText("Gagal memuat daftar cron: 404")).toBeTruthy();
    expect(screen.queryByText(/Belum ada cron/)).toBeNull();
    expect(screen.getByRole("button", { name: /coba lagi/i })).toBeTruthy();
  });

  // Fase 3I · menu Riwayat membuka riwayat run di bawah baris, dan labelnya berganti menjadi sembunyikan.
  it("menu Riwayat membuka riwayat dan labelnya berubah menjadi Sembunyikan", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    openRowMenu();
    menuItem("Riwayat");
    expect(await screen.findByText(/cap penuh/)).toBeTruthy();
    openRowMenu();
    expect(screen.getByRole("menuitem", { name: "Sembunyikan riwayat" })).toBeInTheDocument();
  });

  // Fase 3I · jam server ditampilkan dalam zonanya, dan zona itu disebut terang-terangan.
  it("jam dari server ditampilkan dalam zona server, dan zonanya disebut", async () => {
    render(<SchedulerCrons {...props} timeZone="Asia/Jakarta" />);
    await screen.findByText("Cek error pagi");
    expect(screen.getByText("Asia/Jakarta")).toBeInTheDocument();
    // 2026-08-12T00:00Z = 07.00 WIB; kolom "Berikutnya" memakainya.
    expect(screen.getAllByText(/07\.00/).length).toBeGreaterThan(0);
  });

  // ADR-0212 · keterbatasan lama (preview hanya bila zona browser = zona server) sudah dicabut:
  // preview selalu dihitung dalam zona server, dan jam yang ditampilkan memakai zona yang sama.
  it("preview tampil di form ketika zona server berbeda dari zona browser", async () => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const other = browser === "Asia/Jakarta" ? "UTC" : "Asia/Jakarta";
    render(<SchedulerCrons {...props} timeZone={other} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    const preview = await screen.findByTestId("cron-next-preview");
    expect(preview.textContent).toMatch(/^Perkiraan jalan berikutnya/);
    expect(preview.className).not.toMatch(/preview-warn/);
  });

  // Fase 3I · form memakai dua tab; pilihan lanjutan hanya di tab Lanjutan.
  it("form cron memiliki tab Dasar dan Lanjutan", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    expect(await screen.findByRole("tab", { name: /^Dasar/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^Lanjutan/ })).toBeInTheDocument();
  });

  // Audit 1G · kolom jam boleh kosong saat diketik; dijepit ke nilai sah saat blur.
  it("kolom 'Tiap berapa jam' boleh kosong saat diketik dan kembali ke nilai sah saat blur", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
    fireEvent.change(await screen.findByLabelText("Preset jadwal"), { target: { value: "tiap-n-jam" } });
    const jam = screen.getByLabelText("Tiap berapa jam");
    fireEvent.change(jam, { target: { value: "" } });
    expect(jam).toHaveValue(null);
    fireEvent.change(jam, { target: { value: "99" } });
    fireEvent.blur(jam);
    expect(jam).toHaveValue(23);
  });
});

// ADR-0212 · preview "jalan berikutnya" memakai zona SERVER, bukan zona browser.
describe("SchedulerCrons · preview memakai zona server (ADR-0212)", () => {
  it("preview dihitung dalam serverTimeZone walau zona browser berbeda", async () => {
    // 2026-08-11 03:00Z. Harian 07:00 WIB (Asia/Jakarta) berikutnya = 12 Agu 2026 07.00 WIB.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-11T03:00:00Z"));
    try {
      render(<SchedulerCrons {...props} timeZone="Asia/Jakarta" />);
      await screen.findByText("Cek error pagi");
      fireEvent.click(screen.getByRole("button", { name: /Cron baru/i }));
      await screen.findByLabelText("Nama cron");
      const text = screen.getByTestId("cron-next-preview").textContent ?? "";
      expect(text).toMatch(/12 Agu 2026/);
      expect(text).toMatch(/07[.:]00/);
      expect(screen.getByTestId("cron-next-preview").className).not.toMatch(/preview-warn/);
    } finally {
      vi.useRealTimers();
    }
  });
});
