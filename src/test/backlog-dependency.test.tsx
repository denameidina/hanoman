import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const startSession = vi.fn(async (_b: Record<string, unknown>) => ({ id: "spec-9" }));
vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),

    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    getSettings: vi.fn(async () => ({
      model: "claude-opus-5", effort: "xhigh", agent: "claude",
      goal: { enabled: false, condition: "" }, verifyScope: "changed",
    })),
    getCodexVersion: vi.fn(async () => ({ version: null })),
    startSession: (b: Record<string, unknown>) => startSession(b),
  },
  ApiError: class extends Error {},
}));

import { NewSpecModal } from "../src/App";

const projects = [{ id: "p1", name: "P1" }] as any;
const specs: any[] = [
  { id: "SPEC-1", projectId: "p1", title: "Fondasi", source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "", payload: null, branchFrom: null, baseSha: null,
    createdAt: "2026-07-31T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [] },
  { id: "SPEC-2", projectId: "p2", title: "Project lain", source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "", payload: null, branchFrom: null, baseSha: null,
    createdAt: "2026-07-31T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [] },
];
beforeEach(() => vi.clearAllMocks());

// `Checkbox` design system BUKAN <input type=checkbox>: ia <label> (pembawa aria-label) yang
// membungkus <span> kotak — dan onClick hidup di span itu, bukan di label. Mengklik label = no-op,
// jadi test yang mengklik label bisa "lulus" karena tak terjadi apa-apa (pelajaran SPEC-299/360).
const pick = (name: string) => fireEvent.click(screen.getByLabelText(name).firstElementChild!);

// SPEC-447 · ADR-0093 · dependency adalah properti ITEM, bukan properti bentuk payload — jadi
// picker-nya hidup di luar cabang brief/qa/audit/goal.
describe("NewSpecModal · picker dependency (SPEC-447)", () => {
  it("hanya menawarkan backlog dari project yang dipilih", async () => {
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1"
      onCreate={() => {}} specs={specs} />);
    await waitFor(() => expect(screen.getByLabelText("Bergantung pada SPEC-1")).toBeTruthy());
    expect(screen.queryByLabelText("Bergantung pada SPEC-2")).toBeNull();
  });

  it("mengirim dependsOn yang dicentang", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1"
      onCreate={onCreate} specs={specs} />);
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Turunan" } });
    pick("Bergantung pada SPEC-1");
    fireEvent.click(screen.getByText("Buat brief → brainstorm"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dependsOn: ["SPEC-1"] })));
  });

  it("tanpa centang, dependsOn kosong", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1"
      onCreate={onCreate} specs={specs} />);
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Bebas" } });
    fireEvent.click(screen.getByText("Buat brief → brainstorm"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dependsOn: [] })));
  });
});

import { BacklogScreen } from "../src/screens/BacklogScreen";

const blocked: any = {
  id: "SPEC-9", projectId: "p1", title: "Turunan", source: "brief", stage: "brainstorming",
  priority: "sedang", author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null,
  createdAt: "2026-07-31T00:00:00.000Z", startedAt: null,
  dependsOn: ["SPEC-1"], blockedBy: [{ id: "SPEC-1", reason: "unmerged" }],
};
const free: any = { ...blocked, id: "SPEC-8", dependsOn: [], blockedBy: [] };

describe("BacklogScreen · badge Terblokir (SPEC-447)", () => {
  it("menandai item yang dependency-nya belum siap", async () => {
    render(<BacklogScreen backlog={[blocked]} projects={projects} projectFilter="all"
      onProjectFilter={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Terblokir").length).toBeGreaterThan(0));
  });
  it("item tanpa dependency tak diberi badge", async () => {
    render(<BacklogScreen backlog={[free]} projects={projects} projectFilter="all"
      onProjectFilter={() => {}} />);
    await waitFor(() => expect(screen.getByText("Turunan")).toBeTruthy());
    expect(screen.queryByText("Terblokir")).toBeNull();
  });
  it("detail menyebut siapa yang ditunggu dan alasannya", async () => {
    render(<BacklogScreen backlog={[blocked]} projects={projects} projectFilter="all"
      onProjectFilter={() => {}} />);
    fireEvent.click(await screen.findByText("Turunan"));
    expect(await screen.findByText("SPEC-1")).toBeTruthy();
    expect(screen.getAllByText("belum ter-merge").length).toBeGreaterThan(0);
  });
});

import { StartSessionModal } from "../src/App";

describe("StartSessionModal · dependency (SPEC-447)", () => {
  it("item terblokir: tombol jadi 'Mulai tetap' dan mengirim force", async () => {
    render(<StartSessionModal open spec={blocked} onClose={() => {}} onStarted={() => {}} />);
    expect(screen.getByTestId("dep-blocked-note")).toHaveTextContent(/melewati cap sesi dan pemeriksaan beban host/i);
    fireEvent.click(await screen.findByText("Mulai tetap"));
    await waitFor(() => expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-9", force: true })));
  });

  it("item bebas: tombol tetap 'Mulai' dan force tak pernah terkirim", async () => {
    render(<StartSessionModal open spec={free} onClose={() => {}} onStarted={() => {}} />);
    fireEvent.click(await screen.findByText("Mulai"));
    await waitFor(() => expect(startSession).toHaveBeenCalled());
    expect(startSession.mock.calls[0]![0]).not.toHaveProperty("force");
  });
});
