import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { listCrons, listCronReports } = vi.hoisted(() => ({ listCrons: vi.fn(), listCronReports: vi.fn() }));
vi.mock("../src/api/client", () => ({
  api: { listCrons, listCronReports },
  ApiError: class extends Error {},
}));

import { SchedulerCrons } from "../src/screens/SchedulerCrons";

const projects = [
  { id: "a", name: "Alpha", schedulerOptIn: true },
  { id: "b", name: "Beta", schedulerOptIn: false },
] as unknown as Parameters<typeof SchedulerCrons>[0]["projects"];
const cron = (id: string, projectId: string, name: string) => ({
  id, projectId, name, expr: "0 7 * * *", prompt: "p", enabled: true, agent: null, model: null, effort: null,
  lastRunAt: null, nextRunAt: null,
});

beforeEach(() => {
  localStorage.clear();
  listCrons.mockReset();
  listCronReports.mockReset();
  listCronReports.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
});

describe("SchedulerCrons · default Semua project", () => {
  it("memuat tanpa projectId dan mengelompokkan cron per project", async () => {
    listCrons.mockResolvedValue({
      items: [cron("c1", "b", "Cron Beta"), cron("c2", "a", "Cron Alpha")], total: 2, page: 1, pageSize: 500,
    });
    render(<SchedulerCrons projects={projects} onProjectChanged={vi.fn()} onToast={vi.fn()} />);
    await screen.findByText("Cron Alpha");
    expect(listCrons).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }));
    expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe("");
    const heads = screen.getAllByRole("columnheader", { name: /1 cron/ });
    expect(heads.map((h) => h.textContent)).toEqual(["Alpha1 cron", "Beta1 cronbelum diizinkan"]);
    expect(screen.getByText("belum diizinkan")).toBeTruthy();
  });

  it("memaginasi daftar saat lebih dari satu halaman", async () => {
    const items = Array.from({ length: 12 }, (_, i) => cron(`c${i}`, "a", `Cron ${i}`));
    listCrons.mockResolvedValue({ items, total: 12, page: 1, pageSize: 500 });
    render(<SchedulerCrons projects={projects} onProjectChanged={vi.fn()} onToast={vi.fn()} />);
    await screen.findByText("Cron 0");
    expect(screen.queryByText("Cron 11")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /berikut|next|›|»/i }));
    await screen.findByText("Cron 11");
  });
});
