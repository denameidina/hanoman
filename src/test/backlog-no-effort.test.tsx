import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    listSpecs: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { NewSpecModal } from "../src/App";
import { SOURCE_META, sourceMeta } from "../src/screens/source-meta";
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const projects = [{ id: "p1", name: "P1" }] as any;
beforeEach(() => vi.clearAllMocks());

const spec = {
  id: "SPEC-825", projectId: "p1", title: "Ganti label tombol Simpan", source: "no_effort",
  stage: "executing", priority: "rendah", author: "No effort · dena",
  objective: "Tombol Simpan berbunyi Terapkan", branchFrom: null, baseSha: "abc", headSha: null,
  createdAt: "2026-08-18T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [],
  autoMerge: null, sourceHistory: [],
  payload: { goal: "Tombol Simpan berbunyi Terapkan", done: "", constraints: "hanya copy", priority: "rendah" },
} as unknown as Spec;

// Fallback SOURCE_META diam: tanpa entri, item no_effort memakai lencana "feature brief" dan tak
// ada satu pun error yang menyanggahnya (ADR-0109 poin 5, kasus `help`).
describe("SPEC-825 · lencana no_effort", () => {
  it("punya entri sendiri, bukan jatuh ke fallback brief", () => {
    expect(SOURCE_META.no_effort).toBeTruthy();
    expect(sourceMeta("no_effort").label).toBe("Tanpa effort");
    expect(sourceMeta("no_effort").label).not.toBe(SOURCE_META.brief!.label);
  });
});

describe("SPEC-825 · daftar backlog", () => {
  const props = { backlog: [spec], projects, projectFilter: "all", onProjectFilter: () => {} } as any;

  it("punya tab filter sendiri", async () => {
    render(<BacklogScreen {...props} />);
    await waitFor(() => expect(screen.getAllByText("Tanpa effort").length).toBeGreaterThan(0));
  });

  it("detail merender field bentuk goal, bukan konteks/outcome", async () => {
    render(<BacklogScreen {...props} initialDetailId="SPEC-825" />);
    // "Selesai bila" & "Batasan" hanya dimiliki bentuk goal; "Goal" sendiri ambigu — ia juga
    // label tab filter di layar yang sama.
    await waitFor(() => expect(screen.getByText("Selesai bila")).toBeTruthy());
    expect(screen.getByText("Batasan")).toBeTruthy();
    expect(screen.getAllByText("Tombol Simpan berbunyi Terapkan").length).toBeGreaterThan(0);
    expect(screen.queryByText("Konteks")).toBeNull();
    expect(screen.queryByText("Outcome")).toBeNull();
  });
});

describe("SPEC-825 · NewSpecModal tab Tanpa effort", () => {
  it("mengirim payload bentuk goal, bukan payload brief", async () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Tanpa effort"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Ganti label Simpan" } });
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Tombol berbunyi Terapkan" } });
    fireEvent.click(screen.getByText("Buat task → sesi satu fase"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      kind: "no_effort", title: "Ganti label Simpan", goal: "Tombol berbunyi Terapkan",
    })));
  });

  // Objective spec diturunkan dari `goal` — sama seperti tab Goal (deriveSpecFields).
  it("goal kosong tak bisa disubmit", () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Tanpa effort"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "t" } });
    fireEvent.click(screen.getByText("Buat task → sesi satu fase"));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
