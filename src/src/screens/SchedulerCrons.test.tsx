import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
const createCron = vi.fn(async (..._a: unknown[]) => cron({ id: "c2" }));
const runCronNow = vi.fn(async (..._a: unknown[]) => ({ id: "r2" }));
const updateProject = vi.fn(async (..._a: unknown[]) => ({}));

vi.mock("../api/client", () => ({
  api: {
    listCrons: (...a: unknown[]) => listCrons(...a),
    listCronRuns: (...a: unknown[]) => listCronRuns(...a),
    createCron: (...a: unknown[]) => createCron(...a),
    patchCron: vi.fn(async () => cron()),
    deleteCron: vi.fn(async () => undefined),
    runCronNow: (...a: unknown[]) => runCronNow(...a),
    updateProject: (...a: unknown[]) => updateProject(...a),
  },
}));

const projects = [{ id: "p1", name: "P1", schedulerOptIn: true }] as never;
const props = { projects, onProjectChanged: vi.fn(), onToast: vi.fn() };

beforeEach(() => { vi.clearAllMocks(); });

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
    expect(screen.getByLabelText("Cron expression")).toBeTruthy();
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

  it("tombol jalankan sekarang memanggil api.runCronNow", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Jalankan sekarang/i }));
    await waitFor(() => expect(runCronNow).toHaveBeenCalledWith("c1"));
  });

  it("riwayat run menampilkan hasil beserta alasannya", async () => {
    render(<SchedulerCrons {...props} />);
    await screen.findByText("Cek error pagi");
    fireEvent.click(screen.getByRole("button", { name: /Riwayat/i }));
    expect(await screen.findByText(/cap penuh/)).toBeTruthy();
  });

  it("project belum opt-in: peringatan + tombol opt-in inline", async () => {
    render(<SchedulerCrons {...props} projects={[{ id: "p1", name: "P1", schedulerOptIn: false }] as never} />);
    await screen.findByText("Cek error pagi");
    expect(screen.getByText(/belum di-opt-in/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Opt-in$/ }));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("p1", { schedulerOptIn: true }));
  });
});
