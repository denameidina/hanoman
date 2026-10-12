// ADR-0212 · ProjectsScreen mengirim sort=attention (dan attention=true untuk chip) ke server, dan
// menampilkan urutan yang dikembalikan server APA ADANYA (tanpa pengurutan ulang di klien).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectsScreen } from "./ProjectsScreen";

const listProjects = vi.fn(async (..._a: unknown[]) => ({ items: [] as unknown[], total: 0, page: 1, pageSize: 20 }));

vi.mock("../api/client", () => ({
  api: {
    listProjects: (...a: unknown[]) => listProjects(...a),
    listDeviceTokens: async () => [],
  },
}));

const view = (id: string, name: string, docStatus: "ok" | "drift" | "broken", running = false) => ({
  id, name, desc: "", kind: "existing", stack: "", docStatus, coverage: docStatus === "ok" ? 100 : 40,
  backlog: 0, topStage: "spec", repoDir: null, binding: null, gitRemote: null, createdAt: "2026-08-01T00:00:00.000Z",
  helpEnabled: false, schedulerOptIn: false, leadOptIn: false, handledBy: [], autoMerge: null,
  session: running ? { status: "running", phase: "dev", flow: null } : { status: "idle", phase: null, flow: null },
  activity: "idle", commit: "",
}) as never;

// Urutan yang sengaja BUKAN urutan perhatian: tes ini membuktikan klien tak menyusun ulang.
const SERVER_ORDER = [
  view("ok-a", "alfa", "ok"),
  view("br-a", "broken a", "broken"),
  view("dr-a", "drift a", "drift"),
];
const ALL = [view("ok-a", "alfa", "ok"), view("br-a", "broken a", "broken"), view("dr-a", "drift a", "drift", true)];

const rowNames = (container: HTMLElement) =>
  [...container.querySelectorAll(".hn-prj-name")].map((el) => el.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch { /* jsdom selalu punya localStorage; jaga-jaga */ }
  listProjects.mockImplementation(async () => ({ items: SERVER_ORDER, total: 3, page: 1, pageSize: 20 }));
});

const props = { projects: ALL, pageSize: 20, onOpen: vi.fn(), search: "", onClearSearch: vi.fn() };

describe("ProjectsScreen · urutan perhatian dari server (ADR-0212)", () => {
  it("tampilan default meminta sort=attention dan tanpa attention=…", async () => {
    render(<ProjectsScreen {...props} projects={ALL} />);
    await waitFor(() => expect(listProjects).toHaveBeenCalled());
    const arg = listProjects.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({ sort: "attention", page: 1, limit: 20 });
    expect(arg.attention).toBeUndefined();
  });

  it("baris tampil persis urutan balasan server (tak disusun ulang di klien)", async () => {
    const { container } = render(<ProjectsScreen {...props} projects={ALL} />);
    await waitFor(() => expect(rowNames(container)).toEqual(["alfa", "broken a", "drift a"]));
  });

  it("chip 'Perlu perhatian' meminta sort=attention DAN attention=true ke server", async () => {
    render(<ProjectsScreen {...props} projects={ALL} />);
    await waitFor(() => expect(listProjects).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Perlu perhatian/ }));
    await waitFor(() => {
      const last = listProjects.mock.calls.at(-1)![0] as Record<string, unknown>;
      expect(last).toMatchObject({ sort: "attention", attention: true });
    });
  });

  it("chip 'Sesi berjalan' tetap dari daftar penuh App dan tak memanggil API daftar", async () => {
    const { container } = render(<ProjectsScreen {...props} projects={ALL} />);
    await waitFor(() => expect(listProjects).toHaveBeenCalled());
    listProjects.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Sesi berjalan/ }));
    await waitFor(() => expect(rowNames(container)).toEqual(["drift a"]));
    expect(listProjects).not.toHaveBeenCalled();
  });
});
