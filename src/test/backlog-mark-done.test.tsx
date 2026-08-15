import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec = {
  id: "SPEC-804", projectId: "p1", title: "Judul", source: "brief", stage: "planned",
  priority: "sedang", author: "dena", objective: "obj", payload: {}, branchFrom: null,
  baseSha: null, createdAt: "2026-08-15T00:00:00.000Z", startedAt: null,
  dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [], manualDone: null,
} as unknown as Spec;

const screenWith = (onMarkDone: any, backlog: Spec[] = [spec], detailId?: string) =>
  render(<BacklogScreen backlog={backlog} projects={[{ id: "p1", name: "p1" } as any]}
    projectFilter="all" onProjectFilter={() => {}} onMarkDone={onMarkDone}
    initialDetailId={detailId} />);

describe("SPEC-804 · tandai selesai dari dashboard", () => {
  it("aksi ada di baris daftar untuk item belum selesai, hilang untuk item done", () => {
    const { unmount } = screenWith(vi.fn());
    expect(screen.getAllByLabelText("Tandai selesai").length).toBeGreaterThan(0);
    unmount();
    screenWith(vi.fn(), [{ ...spec, stage: "done" } as Spec]);
    expect(screen.queryByLabelText("Tandai selesai")).toBeNull();
  });

  it("dialog meminta konfirmasi dan mengirim alasan", async () => {
    const onMarkDone = vi.fn().mockResolvedValue({ ...spec, stage: "done" });
    screenWith(onMarkDone);
    fireEvent.click(screen.getAllByLabelText("Tandai selesai")[0]!);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Alasan singkat (opsional)"),
      { target: { value: "sudah ter-merge lewat PR #12" } });
    fireEvent.click(dialog.getByRole("button", { name: "Tandai selesai" }));
    await waitFor(() =>
      expect(onMarkDone).toHaveBeenCalledWith(spec, "sudah ter-merge lewat PR #12", false));
  });

  it("409 confirm-required memunculkan peringatan sesi hidup lalu kirim ulang dengan confirm", async () => {
    const onMarkDone = vi.fn()
      .mockResolvedValueOnce({ needConfirm: true, sessionId: "spec-804" })
      .mockResolvedValueOnce({ ...spec, stage: "done" });
    screenWith(onMarkDone);
    fireEvent.click(screen.getAllByLabelText("Tandai selesai")[0]!);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Tandai selesai" }));
    expect(await screen.findByTestId("mark-done-live")).toBeTruthy();
    expect(screen.getByTestId("mark-done-live").textContent).toContain("spec-804");
    fireEvent.click(dialog.getByRole("button", { name: /sesi tetap berjalan/i }));
    await waitFor(() => expect(onMarkDone).toHaveBeenLastCalledWith(spec, "", true));
  });

  it("detail item menampilkan jejak penandaan manual", () => {
    const marked = { ...spec, stage: "done",
      manualDone: { at: "2026-08-15T04:00:00.000Z", by: "dena@x", reason: "sudah tercakup SPEC-799" } } as unknown as Spec;
    screenWith(vi.fn(), [marked], "SPEC-804");
    const trail = screen.getByTestId("manual-done-trail");
    expect(trail.textContent).toContain("dena@x");
    expect(trail.textContent).toContain("sudah tercakup SPEC-799");
  });
});
