import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    listSpecs: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { BacklogScreen } from "../src/screens/BacklogScreen";

// SPEC-826 · field yang dirender tapi tak ikut disimpan adalah bentuk kegagalan paling senyap:
// operator mengetik, menekan Simpan, dan batasannya lenyap tanpa satu pun pesan.
// `payload` di sini sengaja bentuk LAMA (tanpa `constraints`) — itulah baris yang sudah ada di DB.
const qaSpec: any = {
  id: "SPEC-826", projectId: "p1", title: "Funnel dobel", source: "qa", stage: "brainstorming",
  priority: "tinggi", author: "dena", objective: "o", branchFrom: null, baseSha: null,
  createdAt: "2026-08-18T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [],
  autoMerge: null, sourceHistory: [],
  payload: { severity: "major", steps: "1. buka", expected: "e", actual: "a", env: "prod" },
};
const mount = (onEditSpec: any) =>
  render(<BacklogScreen backlog={[qaSpec]} projects={[{ id: "p1", name: "P1" }] as never}
    onEditSpec={onEditSpec} projectFilter="all" onProjectFilter={() => {}} />);

beforeEach(() => vi.clearAllMocks());

describe("SPEC-826 · Batasan di detail backlog qa", () => {
  it("item qa LAMA dibuka tanpa galat; Batasan lahir kosong di form edit", async () => {
    mount(vi.fn());
    fireEvent.click(await screen.findByText("Funnel dobel"));
    fireEvent.click(await screen.findByText("Edit"));
    expect((screen.getByLabelText("Batasan") as HTMLTextAreaElement).value).toBe("");
  });

  it("Simpan mengirim constraints yang diketik operator", async () => {
    const onEditSpec = vi.fn();
    mount(onEditSpec);
    fireEvent.click(await screen.findByText("Funnel dobel"));
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.change(screen.getByLabelText("Batasan"),
      { target: { value: "jangan ubah kontrak API" } });
    fireEvent.click(screen.getByText("Simpan"));
    await waitFor(() => expect(onEditSpec).toHaveBeenCalledWith(
      expect.objectContaining({ id: "SPEC-826" }),
      expect.objectContaining({ payload: expect.objectContaining({
        severity: "major", constraints: "jangan ubah kontrak API" }) })));
  });
});
